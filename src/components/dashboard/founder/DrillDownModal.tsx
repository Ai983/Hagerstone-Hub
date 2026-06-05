import { useEffect, useRef } from 'react'
import { X, Download } from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend, PointElement, LineElement, Filler,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { exportToCSV } from './exportUtils'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend, PointElement, LineElement, Filler,
)

export interface DrillColumn {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  format?: (v: unknown) => string
}

export interface DrillChart {
  type: 'bar' | 'doughnut'
  labels: string[]
  datasets: { label?: string; data: number[]; backgroundColor: string | string[]; borderRadius?: number }[]
  tooltipFmt?: (v: number) => string
}

export interface DrillConfig {
  title: string
  subtitle?: string
  chart?: DrillChart
  columns: DrillColumn[]
  rows: Record<string, unknown>[]
  loading?: boolean
}

interface Props {
  config: DrillConfig | null
  onClose: () => void
}

const inr = (n: unknown) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n ?? 0))

export function DrillDownModal({ config, onClose }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!config) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [config, onClose])

  if (!config) return null

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }

  const handleExport = () => {
    exportToCSV(
      config.title.replace(/\s+/g, '-').toLowerCase(),
      config.rows,
      config.columns.map(c => ({ key: c.key, label: c.label })),
    )
  }

  const chartData = config.chart
    ? {
        labels: config.chart.labels,
        datasets: config.chart.datasets.map(ds => ({
          ...ds,
          borderWidth: 0,
          hoverOffset: config.chart!.type === 'doughnut' ? 8 : undefined,
        })),
      }
    : null

  const chartOpts =
    config.chart?.type === 'doughnut'
      ? {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '55%',
          plugins: {
            legend: { position: 'right' as const, labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx: { parsed: number; label: string }) =>
                  config.chart?.tooltipFmt
                    ? `${ctx.label}: ${config.chart.tooltipFmt(ctx.parsed)}`
                    : `${ctx.label}: ${ctx.parsed}`,
              },
            },
          },
        }
      : {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y' as const,
          scales: {
            x: {
              beginAtZero: true,
              ticks: {
                font: { size: 10 },
                callback: config.chart?.tooltipFmt
                  ? (v: unknown) => config.chart!.tooltipFmt!(Number(v))
                  : undefined,
              },
              grid: { color: '#f3f4f6' },
            },
            y: { ticks: { font: { size: 10 } } },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index' as const,
              intersect: false,
              callbacks: {
                label: (ctx: { parsed: { y?: number; x?: number }; dataset: { label?: string } }) => {
                  const val = ctx.parsed.x ?? ctx.parsed.y ?? 0
                  return config.chart?.tooltipFmt
                    ? `${ctx.dataset.label ?? ''}: ${config.chart.tooltipFmt(val)}`
                    : `${ctx.dataset.label ?? ''}: ${val}`
                },
              },
            },
          },
        }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="relative bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-3xl sm:rounded-2xl flex flex-col"
        style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.25)' }}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-stone-100">
          <div>
            <h2 className="font-semibold text-stone-800 text-base leading-tight">{config.title}</h2>
            {config.subtitle && <p className="text-xs text-stone-400 mt-0.5">{config.subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 border border-stone-200 rounded-lg px-2.5 py-1.5 hover:bg-stone-50"
            >
              <Download size={12} /> CSV
            </button>
            <button
              onClick={onClose}
              className="text-stone-400 hover:text-stone-700 rounded-lg p-1.5 hover:bg-stone-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Loading */}
          {config.loading && (
            <div className="space-y-3 py-2">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-8 bg-stone-100 rounded-lg animate-pulse" style={{ width: `${100 - i * 8}%` }} />)}
            </div>
          )}

          {/* Error state */}
          {!config.loading && config.title === 'Error loading data' && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-700">
              <div className="font-semibold mb-1">Failed to load data</div>
              <div className="text-xs text-rose-500 font-mono break-all">{config.subtitle}</div>
            </div>
          )}

          {!config.loading && config.title !== 'Error loading data' && (
            <>
              {/* Mini chart */}
              {chartData && (
                <div style={{ height: config.chart!.type === 'doughnut' ? 180 : Math.min(200, config.chart!.labels.length * 36 + 40) }}>
                  {config.chart!.type === 'doughnut'
                    ? <Doughnut data={chartData} options={chartOpts as Parameters<typeof Doughnut>[0]['options']} />
                    : <Bar data={chartData} options={chartOpts as Parameters<typeof Bar>[0]['options']} />}
                </div>
              )}

              {/* Data table */}
              {config.rows.length === 0 ? (
                <div className="py-8 text-center text-stone-400 text-sm">No records found 📭</div>
              ) : (
                <>
                  <div className="text-xs text-stone-400">{config.rows.length} record{config.rows.length !== 1 ? 's' : ''}</div>
                  <div className="overflow-x-auto rounded-xl border border-stone-100">
                    <table className="w-full text-sm">
                      <thead className="bg-stone-50 text-stone-500 text-left">
                        <tr>
                          {config.columns.map(col => (
                            <th
                              key={col.key}
                              className={`px-3 py-2.5 font-medium text-xs uppercase tracking-wide whitespace-nowrap
                                ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {config.rows.map((row, ri) => (
                          <tr key={ri} className="border-t border-stone-100 hover:bg-amber-50/20">
                            {config.columns.map(col => {
                              const raw = row[col.key]
                              const val = col.format ? col.format(raw) : String(raw ?? '—')
                              return (
                                <td
                                  key={col.key}
                                  className={`px-3 py-2.5 text-stone-700 whitespace-nowrap
                                    ${col.align === 'right' ? 'text-right tabular-nums' : col.align === 'center' ? 'text-center' : ''}`}
                                >
                                  {val}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── utility builders ─────────────────────────────────────────────────────────
export const fmt = {
  inr,
  date: (v: unknown) =>
    v ? new Date(String(v)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—',
  dateTime: (v: unknown) =>
    v ? new Date(String(v)).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
  status: (v: unknown) => String(v ?? '—').replace(/_/g, ' '),
  str: (v: unknown) => String(v ?? '—'),
  num: (v: unknown) => Number(v ?? 0).toLocaleString('en-IN'),
}

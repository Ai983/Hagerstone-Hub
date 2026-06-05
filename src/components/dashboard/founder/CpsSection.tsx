import { Download, AlertTriangle } from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import type { CpsSummary } from './types'
import { inr, num, exportToCSV } from './exportUtils'
import { DrillDownModal } from './DrillDownModal'
import { useDrillDown, fetchPoDrill, fetchPrDrill } from './useDrillDown'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const BRAND = ['#92400e', '#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d']
const PR_STATUS_COLOR: Record<string, string> = {
  pending: '#9ca3af', rfq_created: '#f59e0b', po_issued: '#10b981',
  delivered: '#059669', cancelled: '#dc2626', validated: '#6366f1',
}

const CLICKABLE_HINT = 'text-[10px] text-stone-400 mt-1.5 text-center'

function Panel({ title, children, onExport }: { title: string; children: React.ReactNode; onExport?: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-100" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <div className="px-4 py-3 flex items-center justify-between border-b border-stone-100">
        <h3 className="font-medium text-stone-700 text-sm">{title}</h3>
        {onExport && (
          <button onClick={onExport} className="text-stone-400 hover:text-stone-600 p-1 rounded">
            <Download size={13} />
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function StatCard({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl p-3 border ${alert ? 'bg-rose-50 border-rose-200' : 'bg-stone-50 border-stone-100'}`}>
      <div className={`text-xs uppercase tracking-wide ${alert ? 'text-rose-500' : 'text-stone-400'}`}>{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${alert ? 'text-rose-700' : 'text-stone-800'}`}>{value}</div>
      {sub && <div className="text-xs text-stone-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function EmptyState() {
  return <div className="py-8 text-center text-stone-400 text-sm">Is period mein data nahi 📊</div>
}

interface Props {
  data: CpsSummary | null
  loading: boolean
  period: string
  project: string | null
}

export function CpsSection({ data, loading, period, project }: Props) {
  const { drillConfig, openDrill, closeDrill } = useDrillDown()

  const handleExport = (name: string, rows: Record<string, unknown>[], cols: { key: string; label: string }[]) => {
    exportToCSV(`cps-${name}-${period}`, rows, cols)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">🛒 Procurement</h2>
        <div className="grid lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="bg-white rounded-2xl border border-stone-100 h-40 animate-pulse" />)}
        </div>
      </div>
    )
  }

  const prPipeline = data?.pr_pipeline ?? []
  const prChartData = {
    labels: prPipeline.map(p => p.status.replace(/_/g, ' ')),
    datasets: [{
      label: 'PRs',
      data: prPipeline.map(p => p.count),
      backgroundColor: prPipeline.map(p => PR_STATUS_COLOR[p.status] ?? '#9ca3af'),
      borderRadius: 6,
    }],
  }

  const committedLabels = (data?.committed_by_project ?? []).map(p => p.project?.length > 20 ? p.project.slice(0, 18) + '…' : p.project)
  const committedData = {
    labels: committedLabels,
    datasets: [{
      label: 'Committed',
      data: (data?.committed_by_project ?? []).map(p => p.amount),
      backgroundColor: BRAND,
      borderRadius: 4,
    }],
  }

  const tooltipINR = {
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        callbacks: { label: (ctx: { parsed: { y?: number; x?: number }; dataset: { label?: string } }) => `${ctx.dataset.label ?? ''}: ${inr(ctx.parsed.y ?? ctx.parsed.x)}` },
      },
    },
  }

  const tooltipCount = {
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        callbacks: { label: (ctx: { parsed: { y?: number; x?: number }; dataset: { label?: string } }) => `${ctx.dataset.label ?? ''}: ${ctx.parsed.y ?? ctx.parsed.x}` },
      },
    },
  }

  return (
    <>
      <DrillDownModal config={drillConfig} onClose={closeDrill} />

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
          🛒 Procurement
          <button
            onClick={() => data && handleExport('top-vendors',
              data.top_vendors as unknown as Record<string, unknown>[],
              [{ key: 'name', label: 'Vendor' }, { key: 'amount', label: 'PO Value (INR)' }]
            )}
            className="ml-auto flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 border border-stone-200 rounded px-2 py-1"
          >
            <Download size={11} /> Export CPS CSV
          </button>
        </h2>

        {/* Headline stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            className="text-left"
            onClick={() => openDrill(() => fetchPoDrill(period, { project: project ?? undefined }))}
          >
            <StatCard label="Open POs" value={num(data?.open_pos?.count)} sub={inr(data?.open_pos?.total_value)} />
          </button>
          <StatCard label="PR→PO Avg" value={data?.pr_to_po_avg_days != null ? `${data.pr_to_po_avg_days}d` : '—'} sub="cycle time" />
          <button
            className="text-left"
            onClick={() => openDrill(() => fetchPoDrill(period, { project: project ?? undefined }))}
          >
            <StatCard label="Pending Dispatch" value={num(data?.pending_finance_dispatch)} alert={(data?.pending_finance_dispatch ?? 0) > 0} sub="to finance" />
          </button>
          <StatCard label="Stock Stale" value={num(data?.stock_stale_count)} alert={(data?.stock_stale_count ?? 0) > 0} sub=">24h no movement" />
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* PR Pipeline — click bar → PR list for that status */}
          <Panel title="PR Pipeline by Status" onExport={() => data && handleExport('pr-pipeline',
            data.pr_pipeline as unknown as Record<string, unknown>[],
            [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }]
          )}>
            {!prPipeline.length ? <EmptyState /> : (
              <>
                <div style={{ height: 200 }} className="cursor-pointer">
                  <Bar
                    data={prChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      ...tooltipCount,
                      scales: {
                        y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                        x: { ticks: { font: { size: 10 } } },
                      },
                      onClick: (_evt, elements) => {
                        if (!elements.length) return
                        const st = prPipeline[elements[0].index]?.status
                        if (!st) return
                        openDrill(() => fetchPrDrill(period, { status: st, project: project ?? undefined }))
                      },
                    } as Parameters<typeof Bar>[0]['options']}
                  />
                </div>
                <p className={CLICKABLE_HINT}>Click a bar to see requisitions in that status</p>
              </>
            )}
          </Panel>

          {/* Committed by Project — click bar → PO list */}
          <Panel title="Committed Spend by Project" onExport={() => data && handleExport('committed-by-project',
            data.committed_by_project as unknown as Record<string, unknown>[],
            [{ key: 'project', label: 'Project' }, { key: 'amount', label: 'Amount (INR)' }]
          )}>
            {!data?.committed_by_project?.length ? <EmptyState /> : (
              <>
                <div style={{ height: 200 }} className="cursor-pointer">
                  <Bar
                    data={committedData}
                    options={{
                      ...tooltipINR,
                      responsive: true,
                      maintainAspectRatio: false,
                      indexAxis: 'y' as const,
                      interaction: { mode: 'index', intersect: false },
                      scales: {
                        x: { ticks: { callback: (v) => `₹${(+v / 1000).toFixed(0)}K`, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                        y: { ticks: { font: { size: 10 } } },
                      },
                      onClick: (_evt, elements) => {
                        if (!elements.length) return
                        const proj = data.committed_by_project[elements[0].index]?.project
                        if (!proj) return
                        openDrill(() => fetchPoDrill(period, { project: proj }))
                      },
                    } as Parameters<typeof Bar>[0]['options']}
                  />
                </div>
                <p className={CLICKABLE_HINT}>Click a project bar to see its purchase orders</p>
              </>
            )}
          </Panel>

          {/* Vendor Intelligence */}
          <Panel title="Vendor Intelligence">
            {!data ? <EmptyState /> : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Active Vendors" value={num(data.vendor_stats?.active_count)} />
                  <StatCard label="New This Period" value={num(data.vendor_stats?.new_this_period)} />
                </div>
                <div>
                  <div className="text-xs font-medium text-stone-500 mb-2">Top 5 by PO Value</div>
                  <div className="space-y-1.5">
                    {(data.top_vendors ?? []).map((v, i) => (
                      <button
                        key={v.name ?? i}
                        className="w-full flex items-center gap-3 hover:bg-amber-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors group"
                        onClick={() => {
                          // "—" is our null-display fallback; don't filter by it
                          const vendorFilter = (v.name && v.name !== '—') ? v.name : undefined
                          openDrill(() => fetchPoDrill(period, { vendor: vendorFilter, project: project ?? undefined }))
                        }}
                      >
                        <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-xs flex items-center justify-center font-semibold shrink-0">{i + 1}</span>
                        <span className="text-sm text-stone-700 flex-1 text-left truncate">{v.name ?? '—'}</span>
                        <span className="text-sm font-medium text-stone-800 tabular-nums">{inr(v.amount)}</span>
                        <span className="text-stone-300 group-hover:text-stone-500 text-xs">→</span>
                      </button>
                    ))}
                    {!data.top_vendors?.length && <div className="text-xs text-stone-400">No vendor data</div>}
                  </div>
                  {data.top_vendors?.length ? <p className={CLICKABLE_HINT}>Click a vendor to see their POs</p> : null}
                </div>
              </div>
            )}
          </Panel>

          {/* RFQ / Quote Stats + Stale Stock */}
          <Panel title="RFQ & Quotes · Stale Stock">
            {!data ? <EmptyState /> : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Quotes Total" value={num(data.quote_stats?.total)} />
                  <StatCard label="Reviewed" value={num(data.quote_stats?.reviewed)} />
                  <StatCard label="Pending" value={num(data.quote_stats?.pending)} alert={(data.quote_stats?.pending ?? 0) > 0} />
                </div>
                {(data.stale_stock_projects ?? []).length > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600 mb-2">
                      <AlertTriangle size={11} /> Stale Stock Projects ({data.stock_stale_count})
                    </div>
                    {data.stale_stock_projects.map((s) => (
                      <div key={s.project} className="flex justify-between text-xs py-1 border-b border-stone-50 last:border-0">
                        <span className="text-stone-600 truncate">{s.project}</span>
                        <span className="text-rose-500 tabular-nums shrink-0 ml-2">{s.hours_stale}h ago</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}

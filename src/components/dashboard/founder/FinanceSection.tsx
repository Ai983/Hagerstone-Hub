import { Download } from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import type { FinanceSummary } from './types'
import { inr, exportToCSV } from './exportUtils'
import { DrillDownModal } from './DrillDownModal'
import { useDrillDown, fetchExpenseDrill } from './useDrillDown'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
)

const BRAND = ['#92400e', '#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a']
const STATUS_COLOR: Record<string, string> = {
  approved: '#16a34a', verified: '#059669', manual_review: '#d97706',
  blocked: '#dc2626', pending: '#9ca3af', rejected: '#ef4444',
}

const BASE_OPTS = { responsive: true, maintainAspectRatio: false }

const CLICKABLE_CLS = 'cursor-pointer'
const CLICKABLE_HINT = 'text-[10px] text-stone-400 mt-1 text-center'

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

function StatTrio({ items }: { items: { label: string; value: string; alert?: boolean }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className={`rounded-xl p-3 border ${item.alert ? 'bg-rose-50 border-rose-200' : 'bg-stone-50 border-stone-100'}`}>
          <div className={`text-xs uppercase tracking-wide ${item.alert ? 'text-rose-500' : 'text-stone-400'}`}>{item.label}</div>
          <div className={`text-lg font-semibold mt-0.5 ${item.alert ? 'text-rose-700' : 'text-stone-800'}`}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return <div className="py-8 text-center text-stone-400 text-sm">Is period mein data nahi 📊</div>
}

interface Props {
  data: FinanceSummary | null
  loading: boolean
  period: string
  site: string | null
  employeeId: string | null
}

export function FinanceSection({ data, loading, period, site, employeeId }: Props) {
  const { drillConfig, openDrill, closeDrill } = useDrillDown()

  const handleExport = (name: string, rows: Record<string, unknown>[], cols: { key: string; label: string }[]) => {
    exportToCSV(`finance-${name}-${period}`, rows, cols)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">💰 Finance</h2>
        <div className="grid lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="bg-white rounded-2xl border border-stone-100 h-48 animate-pulse" />)}
        </div>
      </div>
    )
  }

  // ── Spend Trend ──
  const spendTrendData = {
    labels: (data?.spend_trend ?? []).map(d => d.bucket.slice(5)),
    datasets: [{
      label: 'Spend',
      data: (data?.spend_trend ?? []).map(d => d.amount),
      borderColor: '#92400e',
      backgroundColor: 'rgba(146,64,14,0.08)',
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 7,
      pointBackgroundColor: '#92400e',
      fill: true,
      tension: 0.3,
    }],
  }

  // ── Spend by Category ──
  const categoryLabels = (data?.spend_by_category ?? []).map(d => d.category ?? 'Other')
  const categoryData = {
    labels: categoryLabels,
    datasets: [{
      data: (data?.spend_by_category ?? []).map(d => d.amount),
      backgroundColor: BRAND,
      borderWidth: 2,
      borderColor: '#fff',
      hoverOffset: 12,
    }],
  }

  // ── Spend by Site (horizontal bar) ──
  const siteLabels = (data?.spend_by_site ?? []).map(d => d.site?.length > 22 ? d.site.slice(0, 20) + '…' : d.site)
  const siteData = {
    labels: siteLabels,
    datasets: [{
      label: 'Spend',
      data: (data?.spend_by_site ?? []).map(d => d.amount),
      backgroundColor: (data?.spend_by_site ?? []).map((_, i) =>
        ['#92400e','#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#fffbeb','#e7e5e4','#d6d3d1'][i] ?? '#d6d3d1'
      ),
      borderRadius: 5,
    }],
  }

  const tooltipINR = {
    plugins: {
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        callbacks: { label: (ctx: { parsed: { y?: number; x?: number }; dataset: { label?: string } }) => `${ctx.dataset.label ?? ''}: ${inr(ctx.parsed.y ?? ctx.parsed.x)}` },
      },
      legend: { display: false },
    },
  }

  return (
    <>
      <DrillDownModal config={drillConfig} onClose={closeDrill} />

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
          💰 Finance
          <button
            onClick={() => data && handleExport('spend-by-site',
              data.spend_by_site as unknown as Record<string, unknown>[],
              [{ key: 'site', label: 'Site' }, { key: 'amount', label: 'Amount (INR)' }]
            )}
            className="ml-auto flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 border border-stone-200 rounded px-2 py-1"
          >
            <Download size={11} /> Export Finance CSV
          </button>
        </h2>

        {/* Vendor Payments trio */}
        {data?.vendor_payments && (
          <StatTrio items={[
            { label: 'Payments Overdue', value: inr(data.vendor_payments.overdue_amount), alert: data.vendor_payments.overdue_amount > 0 },
            { label: 'Due in 7 Days', value: inr(data.vendor_payments.due_soon_7d) },
            { label: 'Paid This Period', value: inr(data.vendor_payments.paid_amount) },
          ]} />
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Spend Trend — click a point to see that day's expenses */}
          <Panel title="Spend Trend" onExport={() => data && handleExport('spend-trend',
            data.spend_trend as unknown as Record<string, unknown>[],
            [{ key: 'bucket', label: 'Date' }, { key: 'amount', label: 'Amount (INR)' }]
          )}>
            {!data?.spend_trend?.length ? <EmptyState /> : (
              <>
                <div style={{ height: 200 }} className={CLICKABLE_CLS}>
                  <Line
                    data={spendTrendData}
                    options={{
                      ...BASE_OPTS,
                      ...tooltipINR,
                      interaction: { mode: 'nearest', intersect: false },
                      scales: {
                        y: { ticks: { callback: (v) => `₹${(+v / 1000).toFixed(0)}K`, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                        x: { ticks: { font: { size: 10 } } },
                      },
                      onClick: (_evt, elements) => {
                        if (!elements.length) return
                        const idx = elements[0].index
                        const bucket = data.spend_trend[idx]?.bucket
                        if (!bucket) return
                        openDrill(() => fetchExpenseDrill(period, { site: site ?? undefined, employeeId: employeeId ?? undefined }))
                      },
                    } as Parameters<typeof Line>[0]['options']}
                  />
                </div>
                <p className={CLICKABLE_HINT}>Click a data point to drill into expenses</p>
              </>
            )}
          </Panel>

          {/* Spend by Category — click slice → category drill */}
          <Panel title="Spend by Category" onExport={() => data && handleExport('spend-by-category',
            data.spend_by_category as unknown as Record<string, unknown>[],
            [{ key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount (INR)' }]
          )}>
            {!data?.spend_by_category?.length ? <EmptyState /> : (
              <>
                <div style={{ height: 200 }} className={CLICKABLE_CLS}>
                  <Doughnut
                    data={categoryData}
                    options={{
                      ...BASE_OPTS,
                      cutout: '58%',
                      plugins: {
                        legend: { display: true, position: 'right', labels: { boxWidth: 10, font: { size: 10 } } },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${inr(ctx.parsed)}` } },
                      },
                      onClick: (_evt, elements) => {
                        if (!elements.length) return
                        const cat = data.spend_by_category[elements[0].index]?.category ?? 'Other'
                        openDrill(() => fetchExpenseDrill(period, { category: cat, site: site ?? undefined }))
                      },
                    } as Parameters<typeof Doughnut>[0]['options']}
                  />
                </div>
                <p className={CLICKABLE_HINT}>Click a slice to see expenses in that category</p>
              </>
            )}
          </Panel>

          {/* Spend by Site — click bar → site drill */}
          <Panel title="Spend by Site (Top 10)" onExport={() => data && handleExport('spend-by-site',
            data.spend_by_site as unknown as Record<string, unknown>[],
            [{ key: 'site', label: 'Site' }, { key: 'amount', label: 'Amount (INR)' }]
          )}>
            {!data?.spend_by_site?.length ? <EmptyState /> : (
              <>
                <div style={{ height: 220 }} className={CLICKABLE_CLS}>
                  <Bar
                    data={siteData}
                    options={{
                      ...BASE_OPTS,
                      ...tooltipINR,
                      indexAxis: 'y' as const,
                      interaction: { mode: 'index', intersect: false },
                      scales: {
                        x: { ticks: { callback: (v) => `₹${(+v / 1000).toFixed(0)}K`, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                        y: { ticks: { font: { size: 10 } } },
                      },
                      onClick: (_evt, elements) => {
                        if (!elements.length) return
                        const s = data.spend_by_site[elements[0].index]?.site
                        if (!s) return
                        openDrill(() => fetchExpenseDrill(period, { site: s }))
                      },
                    } as Parameters<typeof Bar>[0]['options']}
                  />
                </div>
                <p className={CLICKABLE_HINT}>Click a bar to drill into that site's expenses</p>
              </>
            )}
          </Panel>

          {/* Imprest Funnel */}
          <Panel title="Imprest Flow">
            {!data?.imprest ? <EmptyState /> : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Requested', value: inr(data.imprest.total_requested), color: 'bg-amber-50 border-amber-200' },
                    { label: 'Approved', value: inr(data.imprest.total_approved), color: 'bg-green-50 border-green-200' },
                    { label: 'Paid Out', value: inr(data.imprest.total_paid), color: 'bg-blue-50 border-blue-200' },
                    { label: 'Outstanding', value: inr(data.imprest.outstanding), color: data.imprest.outstanding > 0 ? 'bg-rose-50 border-rose-200' : 'bg-stone-50 border-stone-100' },
                  ].map(item => (
                    <div key={item.label} className={`rounded-lg p-2.5 border ${item.color}`}>
                      <div className="text-xs text-stone-500">{item.label}</div>
                      <div className="font-semibold text-stone-800 text-sm">{item.value}</div>
                    </div>
                  ))}
                </div>
                {data.approval_avg_days !== null && (
                  <div className="text-xs text-stone-500 text-center">
                    Avg approval turnaround: <strong className="text-stone-700">{data.approval_avg_days} days</strong>
                    {data.imprest.blocked_count > 0 && (
                      <span className="ml-2 text-rose-500">· {data.imprest.blocked_count} blocked</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* Expense Status Mix + Top Spenders */}
        <div className="grid lg:grid-cols-2 gap-4">
          {data?.expense_status_mix && data.expense_status_mix.length > 0 && (
            <Panel title="Expense Status Mix">
              <div className="flex flex-wrap gap-2">
                {data.expense_status_mix.map((s) => (
                  <div key={s.status} className="flex items-center gap-1.5 bg-stone-50 rounded-full px-3 py-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s.status] ?? '#9ca3af' }} />
                    <span className="text-xs text-stone-600 capitalize">{s.status.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-semibold text-stone-800">{s.count}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Top 5 Spenders" onExport={() => data && handleExport('top-spenders',
            data.top_spenders as unknown as Record<string, unknown>[],
            [{ key: 'name', label: 'Employee' }, { key: 'amount', label: 'Amount (INR)' }]
          )}>
            {!data?.top_spenders?.length ? <EmptyState /> : (
              <div className="space-y-2">
                {data.top_spenders.map((s, i) => (
                  <button
                    key={s.name}
                    className="w-full flex items-center gap-3 hover:bg-amber-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors group"
                    onClick={() => openDrill(() => fetchExpenseDrill(period, { site: site ?? undefined }))}
                  >
                    <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-xs flex items-center justify-center font-semibold shrink-0">{i + 1}</span>
                    <span className="text-sm text-stone-700 flex-1 text-left truncate">{s.name}</span>
                    <span className="text-sm font-medium text-stone-800 tabular-nums">{inr(s.amount)}</span>
                    <span className="text-stone-300 group-hover:text-stone-500 text-xs">→</span>
                  </button>
                ))}
                <p className={CLICKABLE_HINT}>Click a person to see their expenses</p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { HeadlineKpi } from './types'
import { inr, num } from './exportUtils'

interface Props {
  data: HeadlineKpi | null
  loading: boolean
}

function trend(current: number, prev: number) {
  if (!prev) return null
  const pct = ((current - prev) / prev) * 100
  return pct
}

function TrendBadge({ current, prev }: { current: number; prev: number }) {
  const pct = trend(current, prev)
  if (pct === null) return null
  const up = pct > 0
  const neutral = Math.abs(pct) < 0.5
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${
      neutral ? 'text-stone-400' : up ? 'text-rose-500' : 'text-emerald-600'
    }`}>
      {neutral ? <Minus size={10} /> : up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

interface CardProps {
  label: string
  value: string
  sub?: string
  highlight?: boolean
  loading: boolean
  trend?: React.ReactNode
  alert?: boolean
}

function KpiCard({ label, value, sub, highlight, loading, trend: trendNode, alert }: CardProps) {
  return (
    <div className={`rounded-2xl p-4 border transition-all ${
      alert
        ? 'bg-rose-50 border-rose-200'
        : highlight
        ? 'bg-amber-800 border-amber-800'
        : 'bg-white border-stone-100'
    }`} style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <div className={`text-xs uppercase tracking-wide truncate ${
        alert ? 'text-rose-500' : highlight ? 'text-amber-100' : 'text-stone-400'
      }`}>{label}</div>
      <div className={`text-xl font-semibold mt-1 ${
        alert ? 'text-rose-700' : highlight ? 'text-white' : 'text-stone-800'
      }`}>
        {loading ? <span className="animate-pulse text-stone-300">—</span> : value}
      </div>
      {(trendNode || sub) && (
        <div className="mt-1 flex items-center gap-2">
          {trendNode}
          {sub && <span className={`text-xs ${highlight ? 'text-amber-200' : 'text-stone-400'}`}>{sub}</span>}
        </div>
      )}
    </div>
  )
}

export function HeadlineKpis({ data, loading }: Props) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Company Snapshot</h2>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Total Spend"
          value={inr(data?.total_spend)}
          loading={loading}
          trend={data && <TrendBadge current={data.total_spend} prev={data.prev_spend} />}
          sub="vs prev period"
        />
        <KpiCard
          label="Committed PO Value"
          value={inr(data?.committed_po_value)}
          loading={loading}
        />
        <KpiCard
          label="Imprest Outstanding"
          value={inr(data?.imprest_outstanding)}
          loading={loading}
        />
        <KpiCard
          label="Payments Due 30d"
          value={inr(data?.payments_due_30d)}
          loading={loading}
          alert={(data?.payments_overdue ?? 0) > 0}
          sub={data?.payments_overdue ? `${inr(data.payments_overdue)} overdue` : undefined}
        />
        <KpiCard
          label="Pending Approvals"
          value={num(data?.pending_approvals)}
          loading={loading}
          highlight={(data?.pending_approvals ?? 0) > 0}
        />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <KpiCard label="Active Employees" value={num(data?.active_employees)} loading={loading} />
        <KpiCard label="Due in 7 Days" value={inr(data?.payments_due_7d)} loading={loading} />
        <KpiCard label="Imprest Blocked" value={num(data?.imprest_blocked_count)} loading={loading} alert={(data?.imprest_blocked_count ?? 0) > 0} />
        <KpiCard label="Payments Overdue" value={inr(data?.payments_overdue)} loading={loading} alert={(data?.payments_overdue ?? 0) > 0} />
      </div>
    </div>
  )
}

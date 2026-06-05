import { Download } from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import type { DelegationSummary } from './types'
import { num, pct, exportToCSV } from './exportUtils'
import { DrillDownModal } from './DrillDownModal'
import { useDrillDown, fetchTaskDrill } from './useDrillDown'

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, Tooltip, Legend, Filler,
)

const CLICKABLE_HINT = 'text-[10px] text-stone-400 mt-1 text-center'

// Status colours — matches del_tasks actual statuses
const S = {
  completed:  { bg: '#16a34a', light: '#dcfce7', text: 'text-green-700',  label: 'Completed'   },
  under_review:{ bg: '#f59e0b', light: '#fef3c7', text: 'text-amber-600',  label: 'Under Review' },
  submitted:  { bg: '#6366f1', light: '#ede9fe', text: 'text-indigo-600', label: 'Submitted'    },
  assigned:   { bg: '#94a3b8', light: '#f1f5f9', text: 'text-slate-500',  label: 'Assigned'     },
}

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

function EmptyState({ msg = 'No data for this period' }: { msg?: string }) {
  return <div className="py-10 text-center text-stone-400 text-sm">{msg} 📊</div>
}

interface Props {
  data: DelegationSummary | null
  loading: boolean
  period: string
}

export function DelegationAnalyticsSection({ data, loading, period }: Props) {
  const { drillConfig, openDrill, closeDrill } = useDrillDown()

  const handleExport = (name: string, rows: Record<string, unknown>[], cols: { key: string; label: string }[]) => {
    exportToCSV(`delegation-${name}-${period}`, rows, cols)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">📋 Delegation Analytics</h2>
        <div className="grid lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="bg-white rounded-2xl border border-stone-100 h-44 animate-pulse" />)}
        </div>
      </div>
    )
  }

  const summary = data?.task_summary
  const byPerson = data?.by_person ?? []
  const byTeam   = data?.by_team   ?? []
  const trend    = data?.task_trend ?? []
  const topPerfs = data?.top_performers ?? []

  // ── Status Donut ───────────────────────────────────────────────────────────
  const statusKeys = ['completed', 'under_review', 'submitted', 'assigned'] as const
  const statusCounts = summary
    ? statusKeys.map(k => summary[k] ?? 0)
    : [0, 0, 0, 0]
  const donutData = {
    labels: statusKeys.map(k => S[k].label),
    datasets: [{
      data: statusCounts,
      backgroundColor: statusKeys.map(k => S[k].bg),
      borderWidth: 0,
      hoverOffset: 6,
    }],
  }

  // ── Completion Trend ───────────────────────────────────────────────────────
  const trendLabels = trend.map(t => t.bucket.slice(5))  // MM-DD
  const trendData = {
    labels: trendLabels,
    datasets: [
      {
        label: 'Total',
        data: trend.map(t => t.total),
        borderColor: '#cbd5e1',
        borderWidth: 1.5,
        pointRadius: 2,
        fill: false,
        tension: 0.3,
      },
      {
        label: 'Completed',
        data: trend.map(t => t.completed),
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.10)',
        borderWidth: 2.5,
        pointRadius: 3,
        fill: true,
        tension: 0.3,
      },
    ],
  }

  // ── Team Stacked Bar ───────────────────────────────────────────────────────
  const teamLabels = byTeam.map(t => t.role_group)
  const teamChartData = {
    labels: teamLabels,
    datasets: [
      { label: 'Completed',   data: byTeam.map(t => t.completed),                                           backgroundColor: S.completed.bg,   borderRadius: 0 },
      { label: 'Under Review',data: byTeam.map(t => (t.total - t.completed)),                              backgroundColor: S.under_review.bg, borderRadius: 0 },
    ],
  }

  // ── Person bar (completion rate) ───────────────────────────────────────────
  const top10 = byPerson.slice(0, 10)
  const personBarData = {
    labels: top10.map(p => p.name.split(' ')[0]),  // first name only
    datasets: [{
      label: 'Completion %',
      data: top10.map(p => p.completion_pct ?? 0),
      backgroundColor: top10.map(p => {
        const r = p.completion_pct ?? 0
        return r >= 80 ? '#16a34a' : r >= 50 ? '#f59e0b' : '#dc2626'
      }),
      borderRadius: 6,
    }],
  }

  const chartOpts = { responsive: true, maintainAspectRatio: false }

  return (
    <>
    <DrillDownModal config={drillConfig} onClose={closeDrill} />
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-stone-700">📋 Delegation Analytics</h2>
        <button
          onClick={() => byPerson.length && handleExport('by-person', byPerson as unknown as Record<string, unknown>[], [
            { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' },
            { key: 'total', label: 'Total Tasks' }, { key: 'completed', label: 'Completed' },
            { key: 'under_review', label: 'Under Review' }, { key: 'submitted', label: 'Submitted' },
            { key: 'assigned', label: 'Assigned' }, { key: 'completion_pct', label: 'Completion %' },
            { key: 'total_points', label: 'Points' },
          ])}
          className="ml-auto flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 border border-stone-200 rounded px-2 py-1"
        >
          <Download size={11} /> Export CSV
        </button>
      </div>

      {/* ── Hero KPI cards ──────────────────────────────────────────────────── */}
      {summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
            <div className="text-xs text-stone-400 uppercase tracking-wide">Total Tasks</div>
            <div className="text-2xl font-bold text-stone-800 mt-0.5">{num(summary.total)}</div>
          </div>
          {statusKeys.map(k => (
            <button
              key={k}
              className="rounded-xl border p-3 text-left hover:scale-[1.02] transition-transform"
              style={{ background: S[k].light, borderColor: S[k].bg + '33' }}
              onClick={() => openDrill(() => fetchTaskDrill(period, { status: k }))}
            >
              <div className="text-xs uppercase tracking-wide" style={{ color: S[k].bg }}>{S[k].label}</div>
              <div className="text-2xl font-bold mt-0.5" style={{ color: S[k].bg }}>{num(summary[k] ?? 0)}</div>
              <div className="text-[10px] mt-0.5" style={{ color: S[k].bg + 'aa' }}>tap to see tasks →</div>
            </button>
          ))}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs text-emerald-600 uppercase tracking-wide">Done Rate</div>
            <div className="text-2xl font-bold text-emerald-700 mt-0.5">{pct(summary.completion_rate)}</div>
          </div>
        </div>
      ) : (
        <EmptyState msg="No delegation tasks found for this period" />
      )}

      {/* ── Row 1: Status Donut + Completion Trend ─────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Status ring */}
        <Panel title="Task Status Breakdown">
          {!summary || summary.total === 0 ? <EmptyState /> : (
            <>
              <div className="flex items-center gap-4">
                <div style={{ width: 180, height: 180, flexShrink: 0 }} className="cursor-pointer">
                  <Doughnut
                    data={donutData}
                    options={{
                      ...chartOpts,
                      cutout: '62%',
                      plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed} tasks (${pct((ctx.parsed / (summary.total || 1)) * 100)})` } },
                      },
                      onClick: (_evt, elements) => {
                        if (!elements.length) return
                        const k = statusKeys[elements[0].index]
                        if (k) openDrill(() => fetchTaskDrill(period, { status: k }))
                      },
                    } as Parameters<typeof Doughnut>[0]['options']}
                  />
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  {statusKeys.map((k, i) => {
                    const count = statusCounts[i]
                    const pctVal = summary.total ? Math.round(count / summary.total * 100) : 0
                    return (
                      <button
                        key={k}
                        className="flex items-center gap-2 hover:bg-stone-50 rounded-lg px-1 py-0.5 -mx-1 transition-colors"
                        onClick={() => openDrill(() => fetchTaskDrill(period, { status: k }))}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: S[k].bg }} />
                        <span className="text-xs text-stone-600 flex-1 text-left">{S[k].label}</span>
                        <span className="text-xs font-semibold text-stone-800 tabular-nums">{count}</span>
                        <span className="text-xs text-stone-400 tabular-nums w-9 text-right">{pctVal}%</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className={CLICKABLE_HINT}>Click a slice or row to drill into those tasks</p>
            </>
          )}
        </Panel>

        {/* Completion trend */}
        <Panel title="Weekly Completion Trend">
          {!trend.length ? <EmptyState /> : (
            <>
              <div style={{ height: 180 }} className="cursor-pointer">
                <Line
                  data={trendData}
                  options={{
                    ...chartOpts,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                      y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                      x: { ticks: { font: { size: 10 } } },
                    },
                    plugins: {
                      legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
                      tooltip: { mode: 'index', intersect: false },
                    },
                    onClick: () => openDrill(() => fetchTaskDrill(period, {})),
                  } as Parameters<typeof Line>[0]['options']}
                />
              </div>
              <p className={CLICKABLE_HINT}>Click to see all tasks this period</p>
            </>
          )}
        </Panel>
      </div>

      {/* ── Row 2: Team Stacked + Person Completion Bars ───────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">

        {/* Team stacked */}
        <Panel title="Tasks by Team">
          {!byTeam.length ? <EmptyState /> : (
            <>
              <div style={{ height: 200 }} className="cursor-pointer">
                <Bar
                  data={teamChartData}
                  options={{
                    ...chartOpts,
                    scales: {
                      x: { stacked: true, ticks: { font: { size: 10 } } },
                      y: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
                    },
                    plugins: {
                      legend: { display: true, position: 'top', labels: { boxWidth: 10, font: { size: 10 } } },
                      tooltip: { mode: 'index', intersect: false },
                    },
                    onClick: (_evt, elements) => {
                      if (!elements.length) return
                      const team = byTeam[elements[0].index]?.role_group
                      if (team) openDrill(() => fetchTaskDrill(period, { roleGroup: team }))
                    },
                  } as Parameters<typeof Bar>[0]['options']}
                />
              </div>
              <p className={CLICKABLE_HINT}>Click a team bar to see its tasks</p>
            </>
          )}
        </Panel>

        {/* Person completion % bar */}
        <Panel title="Completion Rate by Person (Top 10)">
          {!top10.length ? <EmptyState /> : (
            <>
              <div style={{ height: 200 }} className="cursor-pointer">
                <Bar
                  data={personBarData}
                  options={{
                    ...chartOpts,
                    indexAxis: 'y' as const,
                    scales: {
                      x: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%`, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                      y: { ticks: { font: { size: 10 } } },
                    },
                    plugins: {
                      legend: { display: false },
                      tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x}% completion` } },
                    },
                    onClick: (_evt, elements) => {
                      if (!elements.length) return
                      const person = top10[elements[0].index]
                      if (person?.auth_user_id) openDrill(() => fetchTaskDrill(period, { personId: person.auth_user_id }))
                    },
                  } as Parameters<typeof Bar>[0]['options']}
                />
              </div>
              <p className={CLICKABLE_HINT}>Click a person bar to see all their tasks</p>
            </>
          )}
        </Panel>
      </div>

      {/* ── Person Detail Table ─────────────────────────────────────────────── */}
      <Panel title="Person-level Task Status" onExport={() => byPerson.length && handleExport('by-person',
        byPerson as unknown as Record<string, unknown>[],
        [
          { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' },
          { key: 'total', label: 'Total' }, { key: 'completed', label: 'Completed' },
          { key: 'under_review', label: 'Under Review' }, { key: 'submitted', label: 'Submitted' },
          { key: 'assigned', label: 'Assigned' }, { key: 'completion_pct', label: 'Completion %' },
          { key: 'total_points', label: 'Points' },
        ]
      )}>
        {!byPerson.length ? <EmptyState /> : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-stone-400 text-left border-b border-stone-100">
                  <tr>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide">Person</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide text-center">Total</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide text-center" style={{ color: S.completed.bg }}>Done</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide text-center" style={{ color: S.under_review.bg }}>Review</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide text-center" style={{ color: S.submitted.bg }}>Submit</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide text-center" style={{ color: S.assigned.bg }}>Assigned</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide" style={{ minWidth: 100 }}>Progress</th>
                    <th className="pb-2.5 font-medium text-xs uppercase tracking-wide text-right">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {byPerson.map((p) => {
                    const rate = p.completion_pct ?? 0
                    const barColor = rate >= 80 ? S.completed.bg : rate >= 50 ? S.under_review.bg : '#dc2626'
                    return (
                      <tr
                        key={p.auth_user_id}
                        className="border-t border-stone-50 hover:bg-amber-50/30 cursor-pointer"
                        onClick={() => openDrill(() => fetchTaskDrill(period, { personId: p.auth_user_id }))}
                      >
                        <td className="py-2.5">
                          <div className="font-medium text-stone-800">{p.name}</div>
                          <div className="text-xs text-stone-400 capitalize">{p.role}</div>
                        </td>
                        <td className="py-2.5 text-center tabular-nums font-medium">{p.total}</td>
                        <td className="py-2.5 text-center tabular-nums font-semibold text-green-700">{p.completed}</td>
                        <td className="py-2.5 text-center tabular-nums text-amber-600">{p.under_review}</td>
                        <td className="py-2.5 text-center tabular-nums text-indigo-500">{p.submitted}</td>
                        <td className="py-2.5 text-center tabular-nums text-slate-400">{p.assigned}</td>
                        <td className="py-2.5" style={{ minWidth: 100 }}>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-stone-100 rounded-full h-1.5 overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, rate)}%`, background: barColor }} />
                            </div>
                            <span className="text-xs tabular-nums w-8 text-right font-medium" style={{ color: barColor }}>{rate}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right tabular-nums font-bold text-amber-700">{p.total_points}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {byPerson.map((p) => {
                const rate = p.completion_pct ?? 0
                const barColor = rate >= 80 ? S.completed.bg : rate >= 50 ? S.under_review.bg : '#dc2626'
                return (
                  <div key={p.auth_user_id} className="rounded-xl border border-stone-100 p-3 bg-stone-50">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium text-stone-800 text-sm">{p.name}</div>
                        <div className="text-xs text-stone-400 capitalize">{p.role}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-stone-400">Done Rate</div>
                        <div className="font-bold text-base" style={{ color: barColor }}>{rate}%</div>
                      </div>
                    </div>
                    {/* Mini progress bar */}
                    <div className="bg-stone-200 rounded-full h-1.5 mb-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, rate)}%`, background: barColor }} />
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-xs text-center">
                      <div><span className="text-stone-400 block text-[10px]">Total</span><span className="font-semibold">{p.total}</span></div>
                      <div><span className="block text-[10px]" style={{ color: S.completed.bg }}>Done</span><span className="font-semibold text-green-700">{p.completed}</span></div>
                      <div><span className="block text-[10px]" style={{ color: S.under_review.bg }}>Review</span><span className="font-semibold text-amber-600">{p.under_review}</span></div>
                      <div><span className="block text-[10px]" style={{ color: S.submitted.bg }}>Submit</span><span className="font-semibold text-indigo-500">{p.submitted}</span></div>
                      <div><span className="text-amber-700 block text-[10px]">Pts</span><span className="font-bold text-amber-700">{p.total_points}</span></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Panel>

      {/* ── Top Performers ──────────────────────────────────────────────────── */}
      {topPerfs.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-100 p-4" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">🏆 Top Performers (Points)</h3>
          <div className="flex flex-wrap gap-2">
            {topPerfs.map((p, i) => (
              <div key={p.name} className={`flex items-center gap-2 rounded-full px-3.5 py-2 border ${
                i === 0 ? 'bg-amber-800 border-amber-700' : i === 1 ? 'bg-stone-700 border-stone-600' : i === 2 ? 'bg-amber-600 border-amber-500' : 'bg-stone-50 border-stone-200'
              }`}>
                <span className={`text-sm font-black ${i < 3 ? 'text-white/80' : 'text-amber-600'}`}>#{i + 1}</span>
                <span className={`text-sm font-semibold ${i < 3 ? 'text-white' : 'text-stone-700'}`}>{p.name}</span>
                <span className={`text-xs font-bold tabular-nums ${i < 3 ? 'text-white/70' : 'text-stone-400'}`}>{p.points}pts</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </>
  )
}

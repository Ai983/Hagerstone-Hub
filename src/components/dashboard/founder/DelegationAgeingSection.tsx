import { useEffect, useMemo, useState } from 'react'
import { Download, AlertTriangle, Clock, ChevronUp, ChevronDown, ShieldCheck } from 'lucide-react'
import type { DelegationAgeing, DelAgeingItem, DelAgeBand } from './types'
import { num, exportToCSV } from './exportUtils'

interface Props {
  data: DelegationAgeing | null
  loading: boolean
}

// ── Ageing severity bands ────────────────────────────────────────────────────
// Deliberately NOT the imprest/PR scale (0-7 / 8-15 / 16-30 / 31-60 / 60+):
// delegation runs on a daily clock, so a task 15 days past its deadline is
// critical here, not "fresh". Keys match public.founder_delegation_ageing().
const BAND_ORDER: DelAgeBand[] = ['due', '1-2', '3-7', '8-14', '15+']
const BAND: Record<DelAgeBand, { bg: string; text: string; label: string }> = {
  'due':  { bg: '#1B9E8A', text: '#0E6E5C', label: 'Not yet due' },
  '1-2':  { bg: '#E0B43A', text: '#8A6A12', label: '1–2d late · Watch' },
  '3-7':  { bg: '#E07B2E', text: '#B5521F', label: '3–7d late · Overdue' },
  '8-14': { bg: '#C24A30', text: '#9A2F1A', label: '8–14d late · Stale' },
  '15+':  { bg: '#7E241A', text: '#7E241A', label: '15d+ late · Critical' },
}

// Same colour language as src/lib/urgency.ts so the founder view and the
// delegation sheet read as one system.
const URGENCY: Record<string, { label: string; color: string }> = {
  very_urgent: { label: 'Very Urgent', color: '#C24A30' },
  urgent:      { label: 'Urgent',      color: '#E07B2E' },
  normal:      { label: 'Normal',      color: '#1B9E8A' },
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-stone-100 ${className}`} style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      {children}
    </div>
  )
}

function bandOf(days: number): DelAgeBand {
  return days === 0 ? 'due' : days <= 2 ? '1-2' : days <= 7 ? '3-7' : days <= 14 ? '8-14' : '15+'
}

function LateChip({ days }: { days: number }) {
  const c = BAND[bandOf(days)]
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums text-white" style={{ background: c.bg }}>
      {days === 0 ? 'on time' : `${days}d late`}
    </span>
  )
}

function AgeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white rounded-xl border border-stone-100 px-3 py-2 text-[11px]"
      style={{ boxShadow: '0 2px 10px rgba(146,64,14,0.05)' }}>
      <span className="font-semibold text-stone-500 uppercase tracking-wide">Ageing key — days past the deadline:</span>
      {BAND_ORDER.map((b) => (
        <span key={b} className="inline-flex items-center gap-1.5 text-stone-600">
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: BAND[b].bg }} />
          {BAND[b].label}
        </span>
      ))}
    </div>
  )
}

// ── KPI strip ────────────────────────────────────────────────────────────────
function Kpis({ k }: { k: DelegationAgeing['kpis'] }) {
  const cards = [
    { label: 'Open delegated tasks', val: num(k.open_count), sub: `${k.overdue_count} past their deadline` },
    { label: 'Oldest overdue', val: k.oldest_days === 0 ? 'none' : `${k.oldest_days}d`, sub: `${k.oldest_ref ?? '—'} · with ${k.oldest_owner ?? '—'}`, accent: k.oldest_days > 0 },
    { label: 'Ageing breach', val: num(k.breach_gt2), sub: `>2d  |  ${k.breach_gt7} >7d  |  ${k.breach_gt14} >14d` },
    { label: 'Waiting on head verify', val: num(k.awaiting_verify), sub: 'submitted — points not awarded yet' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-2xl p-3 sm:p-4 border bg-white min-w-0 border-stone-100 ${c.accent ? 'border-t-[3px] border-t-rose-700' : 'border-t-[3px] border-t-stone-700'}`}
          style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
          <div className="text-[10.5px] uppercase tracking-wide text-stone-400 font-semibold leading-tight min-h-[28px]">{c.label}</div>
          <div className="text-2xl font-bold text-stone-800 tabular-nums mt-1.5 leading-none break-words">{c.val}</div>
          <div className="text-[11px] text-stone-400 mt-1.5 leading-snug break-words">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── Who is sitting on work ────────────────────────────────────────────────────
function ByOwner({ groups }: { groups: DelegationAgeing['by_owner'] }) {
  const maxCount = Math.max(...groups.map((g) => g.count), 1)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {groups.map((g) => {
        const isBottleneck = (g.overdue ?? 0) > 0 && (g.overdue ?? 0) === Math.max(...groups.map((x) => x.overdue ?? 0))
        const total = BAND_ORDER.reduce((acc, b) => acc + g.bands[b], 0)
        return (
          <Card key={g.owner} className={`p-3.5 ${isBottleneck ? 'ring-1 ring-rose-300' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-stone-700 leading-tight">{g.owner}</span>
              <span className={`text-xl font-bold tabular-nums shrink-0 ${isBottleneck ? 'text-rose-600' : 'text-stone-800'}`}>{g.count}</span>
            </div>
            <div className="h-2 rounded-full bg-stone-100 overflow-hidden mt-2">
              <div className="h-full rounded-full" style={{ width: `${(g.count / maxCount) * 100}%`, background: isBottleneck ? '#C24A30' : '#44403c' }} />
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 bg-stone-100 gap-px">
              {BAND_ORDER.map((b) => g.bands[b] > 0 && (
                <span key={b} title={`${g.bands[b]} in ${BAND[b].label}`} style={{ width: `${(g.bands[b] / Math.max(total, 1)) * 100}%`, background: BAND[b].bg }} />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[11.5px] text-stone-500">
              <span>{g.overdue ?? 0} late · oldest <b className="text-stone-700">{g.oldest}d</b></span>
              {(g.very_urgent ?? 0) > 0 && (
                <span className="font-semibold" style={{ color: URGENCY.very_urgent.color }}>
                  <AlertTriangle size={11} className="inline mr-0.5 -mt-0.5" />{g.very_urgent} very urgent
                </span>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Ageing-by-stage matrix ────────────────────────────────────────────────────
function StageMatrix({ groups }: { groups: DelegationAgeing['by_stage'] }) {
  const totals = BAND_ORDER.map((b) => groups.reduce((acc, s) => acc + s.bands[b], 0))
  const grand = totals.reduce((a, b) => a + b, 0)
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-white" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Stage</th>
            {BAND_ORDER.map((b) => (
              <th key={b} className="px-2 py-2.5 text-center text-[11px] font-semibold text-white" style={{ background: BAND[b].bg }}>
                {b === 'due' ? 'on time' : `${b}d`}
              </th>
            ))}
            <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-400">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((s) => (
            <tr key={s.stage_key} className="border-t border-stone-100">
              <td className="px-3 py-2.5">
                <div className="font-semibold text-stone-700 text-[13px] leading-tight flex items-center gap-1.5">
                  {s.awaiting_verify && <ShieldCheck size={12} className="text-amber-700 shrink-0" />}
                  {s.label}
                </div>
              </td>
              {BAND_ORDER.map((b) => (
                <td key={b} className="px-2 py-2.5 text-center">
                  {s.bands[b] > 0
                    ? <span className="inline-block min-w-[26px] px-2 py-0.5 rounded text-[13px] font-semibold text-white tabular-nums" style={{ background: BAND[b].bg }}>{s.bands[b]}</span>
                    : <span className="text-stone-200">·</span>}
                </td>
              ))}
              <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-stone-700 bg-stone-50">{s.count}</td>
            </tr>
          ))}
          <tr className="bg-stone-800 text-white font-semibold">
            <td className="px-3 py-2.5">All open</td>
            {totals.map((t, i) => <td key={i} className="px-2 py-2.5 text-center tabular-nums">{t}</td>)}
            <td className="px-3 py-2.5 text-center tabular-nums">{grand}</td>
          </tr>
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-stone-400 border-t border-stone-100">
        <ShieldCheck size={11} className="inline mr-1 -mt-0.5 text-amber-700" />
        marked stages are blocked on a verifying head, not on the assignee.
      </p>
    </div>
  )
}

// ── Who delegated it ─────────────────────────────────────────────────────────
function ByDelegator({ rows }: { rows: DelegationAgeing['by_delegator'] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((d) => (
        <Card key={d.delegator} className="px-3.5 py-2.5 min-w-[160px]">
          <div className="text-[13px] font-semibold text-stone-700">{d.delegator}</div>
          <div className="text-[11.5px] text-stone-500 mt-1 tabular-nums">
            {d.count} open · <b className={d.overdue > 0 ? 'text-rose-600' : 'text-stone-700'}>{d.overdue} late</b>
            {d.oldest > 0 && <> · oldest {d.oldest}d</>}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Open tasks: filter + search + sortable table (mobile cards) ───────────────
type SortKey = 'late' | 'owner'
function OpenTasks({ items }: { items: DelAgeingItem[] }) {
  const [ownerF, setOwnerF] = useState<string>('all')
  const [bandF, setBandF] = useState<string>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'late', dir: -1 })
  const [showAll, setShowAll] = useState(false)
  const PAGE = 10

  const owners = useMemo(() => Array.from(new Set(items.map((i) => i.owner))).sort(), [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = items.filter((it) =>
      (ownerF === 'all' || it.owner === ownerF) &&
      (bandF === 'all' || it.band === bandF) &&
      (needle === '' ||
        it.ref.toLowerCase().includes(needle) ||
        it.delegator.toLowerCase().includes(needle) ||
        (it.project ?? '').toLowerCase().includes(needle)),
    )
    const pick = (x: DelAgeingItem) => (sort.key === 'late' ? x.overdue_days : x.owner)
    return [...rows].sort((a, b) => {
      const pa = pick(a), pb = pick(b)
      if (typeof pa === 'string' && typeof pb === 'string') return pa.localeCompare(pb) * sort.dir
      return ((pa as number) - (pb as number)) * sort.dir
    })
  }, [items, ownerF, bandF, q, sort])

  useEffect(() => { setShowAll(false) }, [ownerF, bandF, q])
  const visible = showAll ? filtered : filtered.slice(0, PAGE)

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: -1 }))

  const handleExport = () =>
    exportToCSV('delegation-ageing', filtered as unknown as Record<string, unknown>[], [
      { key: 'ref', label: 'Task' }, { key: 'owner', label: 'Assignee' },
      { key: 'delegator', label: 'Delegated by' }, { key: 'on_behalf_of', label: 'On behalf of' },
      { key: 'stage_label', label: 'Stage' }, { key: 'role_group', label: 'Team' },
      { key: 'urgency', label: 'Urgency' }, { key: 'project', label: 'Project' },
      { key: 'task_date', label: 'Deadline' }, { key: 'overdue_days', label: 'Days late' },
      { key: 'age_days', label: 'Days since assigned' },
    ])

  const bandCount = (b: DelAgeBand) => items.filter((i) => i.band === b).length
  const SortArrow = ({ k }: { k: SortKey }) =>
    sort.key === k ? (sort.dir === 1 ? <ChevronUp size={11} className="inline" /> : <ChevronDown size={11} className="inline" />) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold mr-1">Assignee</span>
          <button onClick={() => setOwnerF('all')} className={`text-xs px-2.5 py-1 rounded-full border ${ownerF === 'all' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
            All ({items.length})
          </button>
          {owners.map((o) => (
            <button key={o} onClick={() => setOwnerF(o)}
              className={`text-xs px-2.5 py-1 rounded-full border ${ownerF === o ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
              {o} ({items.filter((i) => i.owner === o).length})
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold mr-1">Lateness</span>
          <button onClick={() => setBandF('all')} className={`text-xs px-2.5 py-1 rounded-full border ${bandF === 'all' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
            Any
          </button>
          {BAND_ORDER.map((b) => bandCount(b) > 0 && (
            <button key={b} onClick={() => setBandF(b)}
              className="text-xs px-2.5 py-1 rounded-full border"
              style={bandF === b
                ? { background: BAND[b].bg, color: '#fff', borderColor: BAND[b].bg }
                : { background: '#fff', color: BAND[b].text, borderColor: BAND[b].bg }}>
              {b === 'due' ? 'on time' : `${b}d`} ({bandCount(b)})
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search task, delegator or project…"
            className="text-sm px-3 py-2 border border-stone-200 rounded-lg w-full sm:w-72 focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] text-stone-400 tabular-nums">Showing {visible.length} of {filtered.length}</span>
            <button onClick={handleExport} className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 border border-stone-200 rounded-lg px-2.5 py-1.5 hover:bg-stone-50">
              <Download size={12} /> CSV
            </button>
          </div>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-stone-100 bg-white" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-stone-50 text-stone-400">
            <tr className="text-left">
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Task</th>
              <th onClick={() => toggleSort('owner')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-stone-600">Assignee <SortArrow k="owner" /></th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Stage</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Delegated by</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Urgency</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Deadline</th>
              <th onClick={() => toggleSort('late')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right cursor-pointer select-none hover:text-stone-600">Late by <SortArrow k="late" /></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr key={it.task_id} className="border-t border-stone-100 hover:bg-amber-50/40">
                <td className="px-3 py-2 text-[12px] text-stone-700 max-w-[240px] truncate" title={it.ref}>{it.ref}</td>
                <td className="px-3 py-2 text-[12px] font-medium text-stone-700 whitespace-nowrap">{it.owner}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600">
                  {it.awaiting_verify && <ShieldCheck size={11} className="inline mr-1 -mt-0.5 text-amber-700" />}
                  {it.stage_label}
                </td>
                <td className="px-3 py-2 text-[12px] text-stone-600 whitespace-nowrap">
                  {it.delegator}
                  {it.on_behalf_of && <span className="text-stone-400"> · for {it.on_behalf_of}</span>}
                </td>
                <td className="px-3 py-2">
                  {it.urgency && (
                    <span className="text-[11px] font-semibold" style={{ color: URGENCY[it.urgency].color }}>
                      {it.urgency === 'very_urgent' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                      {URGENCY[it.urgency].label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[12px] text-stone-600 whitespace-nowrap tabular-nums">
                  {it.task_date}{it.due_time ? ` · ${it.due_time.slice(0, 5)}` : ''}
                </td>
                <td className="px-3 py-2 text-right"><LateChip days={it.overdue_days} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-400 text-sm">No tasks match these filters 📭</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {visible.map((it) => (
          <Card key={it.task_id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-stone-700 truncate">{it.ref}</div>
                <div className="text-[12px] text-stone-500 mt-0.5">{it.stage_label}</div>
              </div>
              <LateChip days={it.overdue_days} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5 text-[12px]">
              <div><span className="text-stone-400 block text-[10px] uppercase">Assignee</span><span className="text-stone-700 font-medium">{it.owner}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Urgency</span>
                <span className="text-stone-700">{it.urgency ? URGENCY[it.urgency].label : '—'}</span>
              </div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Delegated by</span><span className="text-stone-700">{it.delegator}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Deadline</span><span className="text-stone-700 tabular-nums">{it.task_date}</span></div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="py-8 text-center text-stone-400 text-sm">No tasks match these filters 📭</div>}
      </div>

      {filtered.length > PAGE && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl py-2.5 transition-colors"
        >
          {showAll ? <>Show less <ChevronUp size={14} /></> : <>Show all {filtered.length} tasks <ChevronDown size={14} /></>}
        </button>
      )}
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────────────────
export function DelegationAgeingSection({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">⏳ Delegation Ageing</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="bg-white rounded-2xl border border-stone-100 h-24 animate-pulse" />)}
        </div>
        <div className="bg-white rounded-2xl border border-stone-100 h-64 animate-pulse" />
      </div>
    )
  }
  if (!data || data.kpis.open_count === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">⏳ Delegation Ageing</h2>
        <Card className="p-8 text-center text-stone-400 text-sm">No delegated tasks open 🎉</Card>
      </div>
    )
  }

  const asOf = new Date(data.as_of).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
          <Clock size={15} className="text-amber-700" /> Delegation Ageing
        </h2>
        <span className="text-[11px] text-stone-400 hidden sm:inline">every open delegated task, clocked from its deadline · live</span>
        <span className="ml-auto text-[11px] text-stone-400">as of {asOf}</span>
      </div>

      <Kpis k={data.kpis} />

      <AgeLegend />

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-1">Who it's sitting with</h3>
        <p className="text-[11px] text-stone-400 mb-3">
          The <b className="text-stone-500">dark bar</b> = open task count vs the busiest person;
          the <b className="text-stone-500">coloured bar</b> = lateness mix (colours per the key above).
        </p>
        <ByOwner groups={data.by_owner} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Ageing by stage</h3>
        <StageMatrix groups={data.by_stage} />
      </div>

      {data.by_delegator.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Who delegated it</h3>
          <ByDelegator rows={data.by_delegator} />
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">All open tasks ({data.items.length})</h3>
        <OpenTasks items={data.items} />
      </div>
    </div>
  )
}

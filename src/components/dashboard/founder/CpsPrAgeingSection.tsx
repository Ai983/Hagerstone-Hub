import { useEffect, useMemo, useState } from 'react'
import { Download, AlertTriangle, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import type { CpsPrAgeing, CpsPrAgeingItem, AgeBand } from './types'
import { num, exportToCSV } from './exportUtils'

interface Props {
  data: CpsPrAgeing | null
  loading: boolean
}

// ── Ageing severity bands — same key as the Imprest & Finance report ──
const BAND_ORDER: AgeBand[] = ['0-7', '8-15', '16-30', '31-60', '60+']
const BAND: Record<AgeBand, { bg: string; text: string; label: string }> = {
  '0-7':   { bg: '#1B9E8A', text: '#0E6E5C', label: '0–7d · Fresh' },
  '8-15':  { bg: '#E0B43A', text: '#8A6A12', label: '8–15d · Watch' },
  '16-30': { bg: '#E07B2E', text: '#B5521F', label: '16–30d · Overdue' },
  '31-60': { bg: '#C24A30', text: '#9A2F1A', label: '31–60d · Stale' },
  '60+':   { bg: '#7E241A', text: '#7E241A', label: '60+d · Critical' },
}
const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#C24A30', high: '#E07B2E', normal: '#78716c', low: '#a8a29e',
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-stone-100 ${className}`} style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      {children}
    </div>
  )
}

function AgeChip({ days }: { days: number }) {
  const band: AgeBand = days <= 7 ? '0-7' : days <= 15 ? '8-15' : days <= 30 ? '16-30' : days <= 60 ? '31-60' : '60+'
  const c = BAND[band]
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums text-white" style={{ background: c.bg }}>
      {days}d
    </span>
  )
}

function AgeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white rounded-xl border border-stone-100 px-3 py-2 text-[11px]"
      style={{ boxShadow: '0 2px 10px rgba(146,64,14,0.05)' }}>
      <span className="font-semibold text-stone-500 uppercase tracking-wide">Ageing key — how long a PR has waited:</span>
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
function Kpis({ k }: { k: CpsPrAgeing['kpis'] }) {
  const cards = [
    { label: 'PRs stuck pre-PO', val: num(k.stuck_count), sub: 'pending review + RFQ awaiting quotes' },
    { label: 'Oldest stuck PR', val: `${k.oldest_days}d`, sub: `${k.oldest_ref ?? '—'} · with ${k.oldest_owner ?? '—'}`, accent: true },
    { label: 'Ageing breach', val: num(k.breach_gt7), sub: `>7d  |  ${k.breach_gt15} >15d  |  ${k.breach_gt30} >30d` },
    { label: 'Biggest pile-up', val: num(k.top_owner_count), sub: k.top_owner ?? '—' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-2xl p-3 sm:p-4 border bg-white min-w-0 ${c.accent ? 'border-t-[3px] border-t-rose-700 border-stone-100' : 'border-t-[3px] border-t-stone-700 border-stone-100'}`}
          style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
          <div className="text-[10.5px] uppercase tracking-wide text-stone-400 font-semibold leading-tight min-h-[28px]">{c.label}</div>
          <div className="text-2xl font-bold text-stone-800 tabular-nums mt-1.5 leading-none break-words">{c.val}</div>
          <div className="text-[11px] text-stone-400 mt-1.5 leading-snug break-words">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── Where it's stuck — by procurement head (the headline view) ────────────────
function ByOwner({ groups }: { groups: CpsPrAgeing['by_owner'] }) {
  const maxCount = Math.max(...groups.map((g) => g.count), 1)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {groups.map((g) => {
        const isBottleneck = g.count === maxCount && g.count > 0
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
                <span key={b} title={`${g.bands[b]} in ${b}d`} style={{ width: `${(g.bands[b] / Math.max(total, 1)) * 100}%`, background: BAND[b].bg }} />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[11.5px] text-stone-500">
              <span>oldest <b className="text-stone-700">{g.oldest}d</b></span>
              <span>avg {g.avg}d</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Ageing-by-stage matrix ─────────────────────────────────────────────────────
function StageMatrix({ groups }: { groups: CpsPrAgeing['by_stage'] }) {
  const totals = BAND_ORDER.map((b) => groups.reduce((acc, s) => acc + s.bands[b], 0))
  const grand = totals.reduce((a, b) => a + b, 0)
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-white" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Stage</th>
            {BAND_ORDER.map((b) => (
              <th key={b} className="px-2 py-2.5 text-center text-[11px] font-semibold text-white" style={{ background: BAND[b].bg }}>{b}d</th>
            ))}
            <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-400">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((s) => (
            <tr key={s.stage_key} className="border-t border-stone-100">
              <td className="px-3 py-2.5">
                <div className="font-semibold text-stone-700 text-[13px] leading-tight">{s.label}</div>
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
            <td className="px-3 py-2.5">All stuck</td>
            {totals.map((t, i) => <td key={i} className="px-2 py-2.5 text-center tabular-nums">{t}</td>)}
            <td className="px-3 py-2.5 text-center tabular-nums">{grand}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Stuck PRs: filter + search + sortable table (mobile cards) ────────────────
type SortKey = 'age' | 'owner'
function StuckPrs({ items }: { items: CpsPrAgeingItem[] }) {
  const [ownerF, setOwnerF] = useState<string>('all')
  const [bandF, setBandF] = useState<string>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'age', dir: -1 })
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
        (it.project ?? '').toLowerCase().includes(needle) ||
        (it.requester ?? '').toLowerCase().includes(needle)),
    )
    const pick = (x: CpsPrAgeingItem) => (sort.key === 'age' ? x.age_days : x.owner)
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
    exportToCSV('cps-pr-ageing', filtered as unknown as Record<string, unknown>[], [
      { key: 'ref', label: 'PR' }, { key: 'owner', label: 'Stuck with (procurement head)' },
      { key: 'stage_key', label: 'Stage' }, { key: 'project', label: 'Project' }, { key: 'site', label: 'Site' },
      { key: 'priority', label: 'Priority' }, { key: 'requester', label: 'Requester' },
      { key: 'created_at', label: 'Raised' }, { key: 'age_days', label: 'Waiting (days)' },
    ])

  const bandCount = (b: AgeBand) => items.filter((i) => i.band === b).length
  const SortArrow = ({ k }: { k: SortKey }) =>
    sort.key === k ? (sort.dir === 1 ? <ChevronUp size={11} className="inline" /> : <ChevronDown size={11} className="inline" />) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold mr-1">Stuck with</span>
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
          <span className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold mr-1">Age</span>
          <button onClick={() => setBandF('all')} className={`text-xs px-2.5 py-1 rounded-full border ${bandF === 'all' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
            Any age
          </button>
          {BAND_ORDER.map((b) => bandCount(b) > 0 && (
            <button key={b} onClick={() => setBandF(b)}
              className="text-xs px-2.5 py-1 rounded-full border"
              style={bandF === b
                ? { background: BAND[b].bg, color: '#fff', borderColor: BAND[b].bg }
                : { background: '#fff', color: BAND[b].text, borderColor: BAND[b].bg }}>
              {b}d ({bandCount(b)})
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search PR, project or requester…"
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
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">PR</th>
              <th onClick={() => toggleSort('owner')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-stone-600">Stuck with <SortArrow k="owner" /></th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Stage</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Project / site</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Requester</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Priority</th>
              <th onClick={() => toggleSort('age')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right cursor-pointer select-none hover:text-stone-600">Waiting <SortArrow k="age" /></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr key={it.ref} className="border-t border-stone-100 hover:bg-amber-50/40">
                <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap text-stone-700">{it.ref}</td>
                <td className="px-3 py-2 text-[12px] font-medium text-stone-700 whitespace-nowrap">{it.owner}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600">{it.stage_label}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600 max-w-[220px] truncate">{it.project ?? '—'}{it.site ? ` · ${it.site}` : ''}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600">{it.requester ?? '—'}</td>
                <td className="px-3 py-2">
                  {it.priority && (
                    <span className="text-[11px] font-semibold" style={{ color: PRIORITY_COLOR[it.priority] ?? '#78716c' }}>
                      {it.priority === 'urgent' && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                      {it.priority}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right"><AgeChip days={it.age_days} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-stone-400 text-sm">No PRs match these filters 📭</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {visible.map((it) => (
          <Card key={it.ref} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-[12px] text-stone-700">{it.ref}</div>
                <div className="text-[12px] text-stone-500 mt-0.5">{it.stage_label}</div>
              </div>
              <AgeChip days={it.age_days} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5 text-[12px]">
              <div><span className="text-stone-400 block text-[10px] uppercase">Stuck with</span><span className="text-stone-700 font-medium">{it.owner}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Priority</span><span className="text-stone-700">{it.priority ?? '—'}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Project</span><span className="text-stone-700 truncate">{it.project ?? '—'}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Requester</span><span className="text-stone-700">{it.requester ?? '—'}</span></div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="py-8 text-center text-stone-400 text-sm">No PRs match these filters 📭</div>}
      </div>

      {filtered.length > PAGE && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl py-2.5 transition-colors"
        >
          {showAll ? <>Show less <ChevronUp size={14} /></> : <>Show all {filtered.length} PRs <ChevronDown size={14} /></>}
        </button>
      )}
    </div>
  )
}

// ── Section ────────────────────────────────────────────────────────────────────
export function CpsPrAgeingSection({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">⏳ CPS PR Ageing</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="bg-white rounded-2xl border border-stone-100 h-24 animate-pulse" />)}
        </div>
        <div className="bg-white rounded-2xl border border-stone-100 h-64 animate-pulse" />
      </div>
    )
  }
  if (!data || data.kpis.stuck_count === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">⏳ CPS PR Ageing</h2>
        <Card className="p-8 text-center text-stone-400 text-sm">No PRs stuck pre-PO 🎉</Card>
      </div>
    )
  }

  const asOf = new Date(data.as_of).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
          <Clock size={15} className="text-amber-700" /> CPS PR Ageing
        </h2>
        <span className="text-[11px] text-stone-400 hidden sm:inline">every PR not yet turned into a PO · live</span>
        <span className="ml-auto text-[11px] text-stone-400">as of {asOf}</span>
      </div>

      <Kpis k={data.kpis} />

      <AgeLegend />

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-1">Where it's stuck — by procurement head</h3>
        <p className="text-[11px] text-stone-400 mb-3">
          The <b className="text-stone-500">dark bar</b> = PR count vs the busiest head;
          the <b className="text-stone-500">coloured bar</b> = age mix (colours per the key above).
        </p>
        <ByOwner groups={data.by_owner} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Ageing by stage</h3>
        <StageMatrix groups={data.by_stage} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">All stuck PRs ({data.items.length})</h3>
        <StuckPrs items={data.items} />
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Download, AlertTriangle, Clock, ChevronUp, ChevronDown, Info, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  ImprestAgeing, ImprestAgeingItem, AgeBand, PoPaymentRow, ConcentrationRow,
} from './types'
import { inr, num, exportToCSV } from './exportUtils'
import { downloadImprestAgeingPdf } from './exportImprestAgeingPdf'

interface Props {
  data: ImprestAgeing | null
  loading: boolean
  site: string | null
}

// ── Ageing severity bands — mirrors the report's 0-7 / 8-15 / 16-30 / 31-60 / 60+ ──
const BAND_ORDER: AgeBand[] = ['0-7', '8-15', '16-30', '31-60', '60+']
const BAND: Record<AgeBand, { bg: string; text: string; soft: string; label: string }> = {
  '0-7':   { bg: '#1B9E8A', text: '#0E6E5C', soft: '#E9F6F2', label: '0–7d · Fresh' },
  '8-15':  { bg: '#E0B43A', text: '#8A6A12', soft: '#FFF6E0', label: '8–15d · Watch' },
  '16-30': { bg: '#E07B2E', text: '#B5521F', soft: '#FCEEE6', label: '16–30d · Overdue' },
  '31-60': { bg: '#C24A30', text: '#9A2F1A', soft: '#FBEAE4', label: '31–60d · Stale' },
  '60+':   { bg: '#7E241A', text: '#7E241A', soft: '#F4E0DC', label: '60+d · Critical' },
}

// Compact ₹ lakh formatter for headline KPIs (e.g. ₹6.17 L)
const inrLakh = (n: number) => {
  const v = Number(n ?? 0)
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)} L`
  return inr(v)
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

// ── KPI strip ────────────────────────────────────────────────────────────────
function Kpis({ k }: { k: ImprestAgeing['kpis'] }) {
  const cards = [
    { label: 'Imprests stuck in pipeline', val: num(k.stuck_count), sub: `${k.stuck_count - k.flagged_count} genuinely open · ${k.flagged_count} flagged` },
    { label: 'Gross value tied up', val: inrLakh(k.gross_value), sub: 'requested amount, all stuck items' },
    { label: 'Approved & awaiting payout', val: inrLakh(k.approved_awaiting_payout), sub: 'net cash cleared but not yet paid' },
    { label: 'Oldest stuck item', val: `${k.oldest_days}d`, sub: `${k.oldest_ref ?? '—'} · ${k.oldest_site ?? '—'}`, accent: true },
    { label: 'Ageing breach', val: num(k.breach_gt7), sub: `>7d  |  ${k.breach_gt30} >30d  |  ${k.breach_gt60} >60d` },
    { label: 'Primary bottleneck', val: num(k.bottleneck_count), sub: k.bottleneck_stage ?? '—' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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

// ── Stage pipeline ───────────────────────────────────────────────────────────
function Pipeline({ stages }: { stages: ImprestAgeing['pipeline'] }) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {stages.map((s) => {
        const isBottleneck = s.count === maxCount && s.count > 0
        const total = BAND_ORDER.reduce((acc, b) => acc + s.bands[b], 0)
        return (
          <Card key={s.stage_key} className={`p-3.5 ${isBottleneck ? 'ring-1 ring-rose-300' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-stone-700 leading-tight">{s.label}</span>
              <span className={`text-xl font-bold tabular-nums shrink-0 ${isBottleneck ? 'text-rose-600' : 'text-stone-800'}`}>{s.count}</span>
            </div>
            <div className="text-[11px] text-stone-400 mt-0.5 mb-2.5 truncate">{s.owner}</div>
            <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(s.count / maxCount) * 100}%`, background: isBottleneck ? '#C24A30' : '#44403c' }} />
            </div>
            {/* Age-band spread */}
            <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 bg-stone-100 gap-px">
              {BAND_ORDER.map((b) => s.bands[b] > 0 && (
                <span key={b} title={`${s.bands[b]} in ${b}d`} style={{ width: `${(s.bands[b] / Math.max(total, 1)) * 100}%`, background: BAND[b].bg }} />
              ))}
            </div>
            <div className="flex justify-between mt-2 text-[11.5px] text-stone-500">
              <span className="font-semibold text-stone-700 tabular-nums">{inr(s.value)}</span>
              <span>oldest {s.oldest}d · avg {s.avg}d</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Ageing-by-stage matrix ─────────────────────────────────────────────────────
function Matrix({ stages }: { stages: ImprestAgeing['pipeline'] }) {
  const totals = BAND_ORDER.map((b) => stages.reduce((acc, s) => acc + s.bands[b], 0))
  const grand = totals.reduce((a, b) => a + b, 0)
  const grandVal = stages.reduce((a, s) => a + s.value, 0)
  return (
    <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-white" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Stage &amp; owner</th>
            {BAND_ORDER.map((b) => (
              <th key={b} className="px-2 py-2.5 text-center text-[11px] font-semibold text-white" style={{ background: BAND[b].bg }}>{b}d</th>
            ))}
            <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-400">Total</th>
            <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-stone-400">Value</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s) => (
            <tr key={s.stage_key} className="border-t border-stone-100">
              <td className="px-3 py-2.5">
                <div className="font-semibold text-stone-700 text-[13px] leading-tight">{s.label}</div>
                <div className="text-[11px] text-stone-400">{s.owner}</div>
              </td>
              {BAND_ORDER.map((b) => (
                <td key={b} className="px-2 py-2.5 text-center">
                  {s.bands[b] > 0
                    ? <span className="inline-block min-w-[26px] px-2 py-0.5 rounded text-[13px] font-semibold text-white tabular-nums" style={{ background: BAND[b].bg }}>{s.bands[b]}</span>
                    : <span className="text-stone-200">·</span>}
                </td>
              ))}
              <td className="px-3 py-2.5 text-center font-semibold tabular-nums text-stone-700 bg-stone-50">{s.count}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-stone-600 text-[12px]">{inr(s.value)}</td>
            </tr>
          ))}
          <tr className="bg-stone-800 text-white font-semibold">
            <td className="px-3 py-2.5">All stuck</td>
            {totals.map((t, i) => <td key={i} className="px-2 py-2.5 text-center tabular-nums">{t}</td>)}
            <td className="px-3 py-2.5 text-center tabular-nums">{grand}</td>
            <td className="px-3 py-2.5 text-right tabular-nums">{inr(grandVal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Stuck items: filter + search + sortable table (mobile cards) ───────────────
type SortKey = 'age' | 'amt' | 'stage'
function StuckItems({ items, stages, site }: { items: ImprestAgeingItem[]; stages: ImprestAgeing['pipeline']; site: string | null }) {
  const [stageF, setStageF] = useState<string>('all')
  const [bandF, setBandF] = useState<string>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'age', dir: -1 })
  const [showAll, setShowAll] = useState(false)
  const PAGE = 10

  const stageLabel = useMemo(() => {
    const m = new Map<string, string>()
    stages.forEach((s) => m.set(s.stage_key, s.label))
    return m
  }, [stages])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = items.filter((it) =>
      (stageF === 'all' || it.stage_key === stageF) &&
      (bandF === 'all' || it.band === bandF) &&
      (needle === '' ||
        it.ref.toLowerCase().includes(needle) ||
        (it.site ?? '').toLowerCase().includes(needle) ||
        it.requester.toLowerCase().includes(needle)),
    )
    const pick = (x: ImprestAgeingItem) =>
      sort.key === 'age' ? x.age_days : sort.key === 'stage' ? x.days_at_stage : x.amount
    return [...rows].sort((a, b) => (pick(a) - pick(b)) * sort.dir)
  }, [items, stageF, bandF, q, sort])

  // Collapse back to the first page whenever the filter/search changes.
  useEffect(() => { setShowAll(false) }, [stageF, bandF, q])
  const visible = showAll ? filtered : filtered.slice(0, PAGE)

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: -1 }))

  const handleExport = () =>
    exportToCSV(`imprest-ageing${site ? `-${site}` : ''}`, filtered as unknown as Record<string, unknown>[], [
      { key: 'ref', label: 'Ref' }, { key: 'stage_key', label: 'Stage' }, { key: 'owner', label: 'With (current owner)' },
      { key: 'site', label: 'Site' }, { key: 'requester', label: 'Requester' }, { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Requested (INR)' }, { key: 'net_payable', label: 'Net payable (INR)' },
      { key: 'submitted_at', label: 'Submitted' }, { key: 'days_at_stage', label: 'Days at stage' },
      { key: 'age_days', label: 'Waiting (days)' },
    ])

  const bandCount = (b: AgeBand) => items.filter((i) => i.band === b).length

  const SortArrow = ({ k }: { k: SortKey }) =>
    sort.key === k ? (sort.dir === 1 ? <ChevronUp size={11} className="inline" /> : <ChevronDown size={11} className="inline" />) : null

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-stone-400 font-semibold mr-1">Stage</span>
          <button onClick={() => setStageF('all')} className={`text-xs px-2.5 py-1 rounded-full border ${stageF === 'all' ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
            All ({items.length})
          </button>
          {stages.filter((s) => s.count > 0).map((s) => (
            <button key={s.stage_key} onClick={() => setStageF(s.stage_key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${stageF === s.stage_key ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
              {s.label.replace(/^Stage \d+ · |^Director · |^Finance-approved · |^Founder.* · /,'')} ({s.count})
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
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search ref, site or requester…"
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
        <table className="w-full text-sm min-w-[1040px]">
          <thead className="bg-stone-50 text-stone-400">
            <tr className="text-left">
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Ref</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Stage</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">With</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Site</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Requester</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Category</th>
              <th onClick={() => toggleSort('amt')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right cursor-pointer select-none hover:text-stone-600">Requested <SortArrow k="amt" /></th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Net payable</th>
              <th onClick={() => toggleSort('stage')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right cursor-pointer select-none hover:text-stone-600">At stage <SortArrow k="stage" /></th>
              <th onClick={() => toggleSort('age')} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right cursor-pointer select-none hover:text-stone-600">Waiting <SortArrow k="age" /></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr key={it.ref} className="border-t border-stone-100 hover:bg-amber-50/40">
                <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap text-stone-700">
                  {it.ref}
                  {it.flag && <AlertTriangle size={11} className="inline ml-1 text-rose-500" />}
                </td>
                <td className="px-3 py-2 text-[12px] text-stone-600">{stageLabel.get(it.stage_key) ?? it.stage_key}</td>
                <td className="px-3 py-2 text-[12px] font-medium text-stone-700 whitespace-nowrap">{it.owner}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600">{it.site ?? '—'}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600">{it.requester}</td>
                <td className="px-3 py-2 text-[12px] text-stone-400">{it.category ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-stone-700">{inr(it.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-stone-500">{it.net_payable === null ? <span className="text-stone-300">—</span> : inr(it.net_payable)}</td>
                <td className="px-3 py-2 text-right"><AgeChip days={it.days_at_stage} /></td>
                <td className="px-3 py-2 text-right"><AgeChip days={it.age_days} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-stone-400 text-sm">No items match these filters 📭</td></tr>
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
                <div className="font-mono text-[12px] text-stone-700 flex items-center gap-1">
                  {it.ref}
                  {it.flag && <AlertTriangle size={11} className="text-rose-500 shrink-0" />}
                </div>
                <div className="text-[12px] text-stone-500 mt-0.5">{stageLabel.get(it.stage_key) ?? it.stage_key}</div>
              </div>
              <AgeChip days={it.age_days} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2.5 text-[12px]">
              <div><span className="text-stone-400 block text-[10px] uppercase">With</span><span className="text-stone-700 font-medium">{it.owner}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">At stage</span><span className="font-semibold text-stone-800">{it.days_at_stage}d <span className="text-stone-400 font-normal">({it.age_days}d total)</span></span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Site</span><span className="text-stone-700">{it.site ?? '—'}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Requester</span><span className="text-stone-700">{it.requester}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Requested</span><span className="text-stone-800 font-semibold tabular-nums">{inr(it.amount)}</span></div>
              <div><span className="text-stone-400 block text-[10px] uppercase">Net payable</span><span className="text-stone-600 tabular-nums">{it.net_payable === null ? '—' : inr(it.net_payable)}</span></div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="py-8 text-center text-stone-400 text-sm">No items match these filters 📭</div>}
      </div>

      {/* Show more / less toggle — keep the list compact by default */}
      {filtered.length > PAGE && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl py-2.5 transition-colors"
        >
          {showAll
            ? <>Show less <ChevronUp size={14} /></>
            : <>Show all {filtered.length} items <ChevronDown size={14} /></>}
        </button>
      )}
    </div>
  )
}

// ── Concentration cards ────────────────────────────────────────────────────────
function ConcentrationCard({ title, rows }: { title: string; rows: ConcentrationRow[] }) {
  return (
    <Card className="p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700 mb-2.5">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[320px]">
          <thead>
            <tr className="text-stone-400 text-left border-b border-stone-100">
              <th className="py-1.5 pr-2 font-medium text-[10.5px] uppercase tracking-wide">Name</th>
              <th className="py-1.5 px-1 font-medium text-[10.5px] uppercase tracking-wide text-right">Items</th>
              <th className="py-1.5 px-1 font-medium text-[10.5px] uppercase tracking-wide text-right">&gt;30d</th>
              <th className="py-1.5 px-1 font-medium text-[10.5px] uppercase tracking-wide text-right">Gross</th>
              <th className="py-1.5 pl-1 font-medium text-[10.5px] uppercase tracking-wide text-right">Oldest</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.name} className="border-b border-stone-50 last:border-0">
                <td className="py-1.5 pr-2 text-stone-700 max-w-[180px] truncate">{r.name}</td>
                <td className="py-1.5 px-1 text-right tabular-nums text-stone-600">{r.items}</td>
                <td className="py-1.5 px-1 text-right tabular-nums text-stone-500">{r.gt30 || '·'}</td>
                <td className="py-1.5 px-1 text-right tabular-nums font-medium text-stone-700">{inr(r.gross)}</td>
                <td className="py-1.5 pl-1 text-right"><AgeChip days={r.oldest} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-stone-400">No data</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── PO payments ────────────────────────────────────────────────────────────────
function PoPayments({ rows }: { rows: PoPaymentRow[] }) {
  const live = rows.filter((r) => !r.is_test)
  const totalOut = live.reduce((a, r) => a + r.outstanding, 0)
  const gt30 = live.filter((r) => r.age_days > 30).length
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-white" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-stone-50 text-stone-400">
            <tr className="text-left">
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">PO ref</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Supplier</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Project</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Status</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">PO value</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Paid</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Outstanding</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-right">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ref} className={`border-t border-stone-100 hover:bg-amber-50/40 ${r.is_test ? 'opacity-50 italic' : ''}`}>
                <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap text-stone-700">{r.ref}</td>
                <td className="px-3 py-2 text-[12px] text-stone-600">{r.supplier ?? '—'}</td>
                <td className="px-3 py-2 text-[11.5px] text-stone-400 max-w-[220px] truncate">{r.project ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={r.status === 'partially_paid' ? { background: '#FFF6E0', color: '#8A6A12' } : { background: '#FCEEE6', color: '#B5521F' }}>
                    {r.status === 'partially_paid' ? 'Partially paid' : 'Pending payment'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-stone-700">{inr(r.po_value)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[12.5px] text-stone-500">{r.paid ? inr(r.paid) : <span className="text-stone-300">—</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[12.5px] font-semibold text-rose-600">{inr(r.outstanding)}</td>
                <td className="px-3 py-2 text-right"><AgeChip days={r.age_days} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-stone-400">
        {live.length} live unsettled PO{live.length !== 1 ? 's' : ''} carrying <b className="text-stone-600">{inr(totalOut)}</b> outstanding; {gt30} &gt;30 days old.
        {rows.some((r) => r.is_test) && ' Test/dummy POs are greyed and excluded from totals.'}
      </p>
    </div>
  )
}

// ── Integrity caveats ──────────────────────────────────────────────────────────
function Integrity({ g }: { g: ImprestAgeing['integrity'] }) {
  if (!g.paid_not_closed.length && !g.rejected_in_pipeline.length && !g.zero_net_count) return null
  return (
    <div className="bg-white rounded-2xl border border-stone-100 border-l-4 border-l-rose-500 p-4" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700 mb-2 flex items-center gap-1.5"><Info size={14} className="text-rose-500" /> Data integrity &amp; caveats</h3>
      <ul className="space-y-2 text-[13px] text-stone-600 list-disc pl-5">
        {g.paid_not_closed.length > 0 && (
          <li><b className="text-stone-800">{g.paid_not_closed.length} marked paid but stage not closed</b> — {g.paid_not_closed.join(', ')}. Excluded from cash-at-risk; they inflate the open count without representing pending cash.</li>
        )}
        {g.rejected_in_pipeline.length > 0 && (
          <li><b className="text-stone-800">{g.rejected_in_pipeline.length} rejected but still in the pipeline</b> — {g.rejected_in_pipeline.join(', ')}. Should be closed or re-routed.</li>
        )}
        {g.zero_net_count > 0 && (
          <li><b className="text-stone-800">{g.zero_net_count} approved items have ₹0 net payable</b> — fully offset against the requester's earlier unpaid balance. Nothing left to disburse, but the stage was never closed, so they keep showing as open.</li>
        )}
      </ul>
      <p className="text-[11.5px] text-stone-400 mt-3">Ageing is computed from submission timestamps (not <code className="font-mono">updated_at</code>, which was collapsed by a bulk back-data update). Bands: 0–7 fresh · 8–15 watch · 16–30 overdue · 31–60 stale · 60+ critical.</p>
    </div>
  )
}

// ── Download (full PDF report) ─────────────────────────────────────────────────
function DownloadButton({ data }: { data: ImprestAgeing }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    try {
      setBusy(true)
      await downloadImprestAgeingPdf(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF export failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button onClick={run} disabled={busy}
      className="flex items-center gap-1 text-xs text-stone-500 hover:text-amber-800 border border-stone-200 hover:border-amber-300 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50">
      {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Download PDF
    </button>
  )
}

// ── Section ────────────────────────────────────────────────────────────────────
export function ImprestAgeingSection({ data, loading, site }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">⏳ Imprest &amp; Finance Ageing</h2>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="bg-white rounded-2xl border border-stone-100 h-24 animate-pulse" />)}
        </div>
        <div className="bg-white rounded-2xl border border-stone-100 h-64 animate-pulse" />
      </div>
    )
  }
  if (!data || data.kpis.stuck_count === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-stone-700">⏳ Imprest &amp; Finance Ageing</h2>
        <Card className="p-8 text-center text-stone-400 text-sm">Nothing stuck in the pipeline 🎉</Card>
      </div>
    )
  }

  const asOf = new Date(data.as_of).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
          <Clock size={15} className="text-amber-700" /> Imprest &amp; Finance Ageing
        </h2>
        <span className="text-[11px] text-stone-400 hidden sm:inline">every in-flight imprest &amp; PO not yet paid · live</span>
        <span className="ml-auto text-[11px] text-stone-400">as of {asOf}</span>
        <DownloadButton data={data} />
      </div>

      <Kpis k={data.kpis} />

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Where it's stuck — imprest pipeline</h3>
        <Pipeline stages={data.pipeline} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Ageing by stage</h3>
        <Matrix stages={data.pipeline} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">All stuck imprests ({data.items.length})</h3>
        <StuckItems items={data.items} stages={data.pipeline} site={site} />
      </div>

      <div>
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">Concentration — where value &amp; age cluster</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ConcentrationCard title="By site / project" rows={data.concentration_site} />
          <ConcentrationCard title="By expense category" rows={data.concentration_category} />
        </div>
      </div>

      {data.po_payments.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-3">PO payments — vendor settlements not yet cleared</h3>
          <PoPayments rows={data.po_payments} />
        </div>
      )}

      <Integrity g={data.integrity} />
    </div>
  )
}

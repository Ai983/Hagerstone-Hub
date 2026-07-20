import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Rocket, Loader2, Search, X } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../ui/table'
import { Button } from '../ui/button'
import { DispatchRow } from './DispatchRow'
import { TrackedRow, trackedStatus } from './TrackedRow'
import { resolveDraft } from './dispatch'
import { useDraftTasks, useTrackedTasks, dispatchDraft, type GieDraftTask, type GieTrackedTask } from '../../lib/gie'
import type { Employee } from '../../types'

type Readiness = 'all' | 'ready' | 'needs'

type Tab = 'dispatch' | 'active' | 'completed' | 'overdue'

// Fixed widths so the 10 columns always fit one screen (no horizontal scroll).
const COLS: { label: string; w: string }[] = [
  { label: '', w: 'w-7' },
  { label: 'Date', w: 'w-[84px]' },
  { label: 'Group', w: 'w-[88px]' },
  { label: 'By', w: 'w-[84px]' },
  { label: 'Assigned to', w: 'w-[15%]' },
  { label: 'Task details', w: 'w-[26%]' },
  { label: 'Complete by', w: 'w-[112px]' },
  { label: 'Points', w: 'w-[78px]' },
  { label: 'Reminders', w: 'w-[68px]' },
  { label: 'Action', w: 'w-[104px]' },
]

export function TaskTable({
  groupId, employees, empNameById, assignedByAuthUid,
}: {
  groupId: string | null
  employees: Employee[]
  empNameById: Record<string, string>
  assignedByAuthUid: string
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('dispatch')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkRunning, setBulkRunning] = useState(false)

  // ── Filters (apply across the active tab) ──────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterBy, setFilterBy] = useState('')       // 'Assigned by' name
  const [filterTo, setFilterTo] = useState('')       // assignee employees.id
  const [filterReady, setFilterReady] = useState<Readiness>('all')  // dispatch tab only
  const filtersActive = !!(search.trim() || filterBy || filterTo || filterReady !== 'all')
  const clearFilters = () => { setSearch(''); setFilterBy(''); setFilterTo(''); setFilterReady('all') }

  const { data: rawDrafts = [], isLoading: draftsLoading } = useDraftTasks(groupId)
  const { data: tracked = [], isLoading: trackedLoading } = useTrackedTasks()

  // Leadership echoes (fromMe) double-insert identical drafts — collapse by
  // normalized title within a group so the operator (and bulk dispatch) see one.
  const drafts = useMemo(() => {
    const seen = new Set<string>()
    const out: GieDraftTask[] = []
    for (const d of rawDrafts) {                  // newest-first from the query
      const k = `${d.group_id ?? ''}|${(d.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(d)
    }
    return out
  }, [rawDrafts])

  // Tracked tasks are fetched org-wide; filter to the selected group client-side.
  // Cancelled tasks (deleted from Command Center) are excluded entirely.
  const groupTracked = useMemo(
    () => tracked.filter((t) => t.status !== 'cancelled' && (!groupId || t.group_id === groupId)),
    [tracked, groupId],
  )
  const active = useMemo(() => groupTracked.filter((t) => trackedStatus(t) === 'active'), [groupTracked])
  const completed = useMemo(() => groupTracked.filter((t) => trackedStatus(t) === 'completed'), [groupTracked])
  const overdue = useMemo(
    () => groupTracked.filter((t) => ['overdue', 'penalty'].includes(trackedStatus(t))),
    [groupTracked],
  )

  // Option lists for the dropdowns — drawn from everything in view so they're stable across tabs.
  const byOptions = useMemo(() => {
    const s = new Set<string>()
    for (const d of drafts) { const v = d.assigned_by_name ?? d.on_behalf_of; if (v) s.add(v) }
    for (const t of groupTracked) { if (t.on_behalf_of) s.add(t.on_behalf_of) }
    return [...s].sort()
  }, [drafts, groupTracked])

  const toOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of drafts) { const id = d.suggested_assignee_employee_id; if (id) m.set(id, empNameById[id] ?? '—') }
    for (const t of groupTracked) { const id = t.tracking?.assignee_employee_id; if (id) m.set(id, empNameById[id] ?? '—') }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [drafts, groupTracked, empNameById])

  // ── Apply filters ──────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase()
  const filteredDrafts = useMemo(() => drafts.filter((d) => {
    if (q && !(`${d.title ?? ''} ${d.description ?? ''}`.toLowerCase().includes(q))) return false
    if (filterBy && (d.assigned_by_name ?? d.on_behalf_of ?? '') !== filterBy) return false
    if (filterTo && (d.suggested_assignee_employee_id ?? '') !== filterTo) return false
    if (filterReady !== 'all') {
      const ready = resolveDraft(d, employees).ready
      if (filterReady === 'ready' && !ready) return false
      if (filterReady === 'needs' && ready) return false
    }
    return true
  }), [drafts, q, filterBy, filterTo, filterReady, employees])

  const filterTracked = (rows: GieTrackedTask[]) => rows.filter((t) => {
    const toId = t.tracking?.assignee_employee_id ?? ''
    const name = toId ? (empNameById[toId] ?? '') : ''
    if (q && !(`${t.title ?? ''} ${name}`.toLowerCase().includes(q))) return false
    if (filterBy && (t.on_behalf_of ?? '') !== filterBy) return false
    if (filterTo && toId !== filterTo) return false
    return true
  })

  // Ready rows currently visible (respect the active filters) — drives bulk dispatch.
  const readyDrafts = useMemo(
    () => filteredDrafts.filter((d) => resolveDraft(d, employees).ready),
    [filteredDrafts, employees],
  )

  const toggleSelect = (id: string, next: boolean) =>
    setSelected((prev) => {
      const s = new Set(prev)
      if (next) s.add(id); else s.delete(id)
      return s
    })

  async function dispatchAllReady() {
    const targets: GieDraftTask[] = selected.size
      ? readyDrafts.filter((d) => selected.has(d.id))
      : readyDrafts
    if (targets.length === 0) { toast.info('No Ready rows to dispatch'); return }
    if (!confirm(`Dispatch ${targets.length} ready task${targets.length > 1 ? 's' : ''}?`)) return

    setBulkRunning(true)
    let ok = 0, fail = 0
    for (const d of targets) {
      const r = resolveDraft(d, employees)
      if (!r.ready || !r.build) { fail++; continue }
      try {
        await dispatchDraft(r.build(assignedByAuthUid))
        ok++
      } catch {
        fail++   // never stop the batch on one failure
      }
      await new Promise((res) => setTimeout(res, 400))   // gentle pacing for WhatsApp sends
    }
    setBulkRunning(false)
    setSelected(new Set())
    qc.invalidateQueries({ queryKey: ['gie_drafts'] })
    qc.invalidateQueries({ queryKey: ['gie_tracking'] })
    toast[fail ? 'warning' : 'success'](`Dispatched ${ok}${fail ? ` · ${fail} failed` : ''}`)
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'dispatch', label: 'Needs Dispatch', count: drafts.length },
    { key: 'active', label: 'Active', count: active.length },
    { key: 'completed', label: 'Completed', count: completed.length },
    { key: 'overdue', label: 'Overdue / Penalty', count: overdue.length },
  ]

  const loading = tab === 'dispatch' ? draftsLoading : trackedLoading

  return (
    <section className="rounded-2xl bg-white/70 backdrop-blur-sm border border-amber-100 p-3 sm:p-4"
      style={{ boxShadow: '0 4px 20px rgba(146,64,14,0.07)' }}>
      {/* Tabs + bulk action */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                tab === t.key ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`ml-1.5 ${tab === t.key ? 'text-amber-100' : 'text-stone-400'}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'dispatch' && readyDrafts.length > 0 && (
          <Button
            size="sm"
            disabled={bulkRunning}
            onClick={dispatchAllReady}
            className="h-8 bg-amber-700 hover:bg-amber-800 text-white text-xs"
          >
            {bulkRunning ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Rocket size={13} className="mr-1" />}
            {selected.size ? `Dispatch ${selected.size} selected` : `Dispatch all Ready (${readyDrafts.length})`}
          </Button>
        )}
      </div>

      {/* Filter bar — search + Assigned by + Assigned to (+ readiness on the dispatch tab) */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search task or person…"
            className="w-full h-8 rounded-lg border border-input pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          />
        </div>

        <select
          value={filterBy}
          onChange={(e) => setFilterBy(e.target.value)}
          className="h-8 rounded-lg border border-input px-2 text-xs text-stone-700 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          title="Filter by who assigned it"
        >
          <option value="">All assigners</option>
          {byOptions.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

        <select
          value={filterTo}
          onChange={(e) => setFilterTo(e.target.value)}
          className="h-8 rounded-lg border border-input px-2 text-xs text-stone-700 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          title="Filter by assignee"
        >
          <option value="">All assignees</option>
          {toOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        {tab === 'dispatch' && (
          <select
            value={filterReady}
            onChange={(e) => setFilterReady(e.target.value as Readiness)}
            className="h-8 rounded-lg border border-input px-2 text-xs text-stone-700 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            title="Filter by readiness"
          >
            <option value="all">All states</option>
            <option value="ready">Ready to send</option>
            <option value="needs">Needs info</option>
          </select>
        )}

        {filtersActive && (
          <button onClick={clearFilters}
            className="h-8 inline-flex items-center gap-1 rounded-lg px-2 text-xs text-stone-500 hover:text-red-600 hover:bg-stone-100">
            <X size={13} /> Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
      <Table className="table-fixed w-full min-w-[880px]">
        <TableHeader>
          <TableRow>
            {COLS.map((c, i) => (
              <TableHead key={i} className={`h-9 px-2 text-[11px] uppercase tracking-wide text-stone-400 ${c.w}`}>{c.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={10} className="p-8 text-center text-xs text-stone-400">Loading…</TableCell></TableRow>
          ) : tab === 'dispatch' ? (
            drafts.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="p-8 text-center text-xs text-stone-400">
                No tasks waiting to dispatch. New leadership @mentions land here.
              </TableCell></TableRow>
            ) : filteredDrafts.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="p-8 text-center text-xs text-stone-400">
                No rows match your filters. <button onClick={clearFilters} className="text-amber-700 underline">Clear filters</button>
              </TableCell></TableRow>
            ) : (
              filteredDrafts.map((d) => (
                <DispatchRow
                  key={d.id}
                  draft={d}
                  employees={employees}
                  assignedByAuthUid={assignedByAuthUid}
                  selected={selected.has(d.id)}
                  onToggleSelect={toggleSelect}
                />
              ))
            )
          ) : (
            (() => {
              const base = tab === 'active' ? active : tab === 'completed' ? completed : overdue
              const rows = filterTracked(base)
              if (rows.length === 0) {
                return <TableRow><TableCell colSpan={10} className="p-8 text-center text-xs text-stone-400">
                  {base.length === 0 ? 'Nothing here.' : <>No rows match your filters. <button onClick={clearFilters} className="text-amber-700 underline">Clear filters</button></>}
                </TableCell></TableRow>
              }
              return rows.map((t) => <TrackedRow key={t.id} task={t} empNameById={empNameById} />)
            })()
          )}
        </TableBody>
      </Table>
      </div>
    </section>
  )
}

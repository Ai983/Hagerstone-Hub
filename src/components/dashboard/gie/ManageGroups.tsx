import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Settings2, Plus, Power, Search, X, Loader2, RefreshCw } from 'lucide-react'
import {
  useGieGroupsOverview, setGroupActive, addGroup, fetchMaytapiGroups,
  type GieGroupOverview, type MaytapiGroup,
} from '../../../lib/gie'

/** Founder/admin/del_super panel to add / remove / toggle Command Center groups. */
export function ManageGroups() {
  const qc = useQueryClient()
  const { data: groups = [], isLoading } = useGieGroupsOverview()
  const [busy, setBusy] = useState<string | null>(null)   // provider_group_id being mutated
  const [adderOpen, setAdderOpen] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['gie_groups_overview'] })
    qc.invalidateQueries({ queryKey: ['gie_groups'] })
  }

  async function toggle(g: GieGroupOverview) {
    setBusy(g.provider_group_id)
    try {
      await setGroupActive(g.provider_group_id, !g.is_active)
      invalidate()
      toast.success(g.is_active ? `Removed “${g.name}”` : `Activated “${g.name}”`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update group')
    } finally {
      setBusy(null)
    }
  }

  const sorted = [...groups].sort((a, b) =>
    Number(b.is_active) - Number(a.is_active) || (a.name ?? '').localeCompare(b.name ?? ''))
  const activeCount = groups.filter((g) => g.is_active).length

  return (
    <details className="rounded-2xl bg-white/60 border border-amber-100 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-700 flex items-center gap-2">
        <Settings2 size={15} className="text-amber-700" /> Manage Groups
        <span className="text-xs font-normal text-stone-400">({activeCount} active / {groups.length} total)</span>
      </summary>

      <div className="mt-3 space-y-3">
        <div className="flex justify-between items-center">
          <p className="text-xs text-stone-500">Deactivating removes a group from the Command Center and stops capture — history is kept and it can be re-added.</p>
          <button
            type="button"
            onClick={() => setAdderOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 bg-amber-700 text-white hover:bg-amber-800"
          >
            <Plus size={13} /> Add from WhatsApp
          </button>
        </div>

        {isLoading ? (
          <div className="h-24 rounded-xl bg-stone-50 animate-pulse border border-stone-100" />
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-xl border border-stone-100 divide-y divide-stone-100">
            {sorted.map((g) => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${g.is_active ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                <span className={`flex-1 truncate ${g.is_active ? 'text-stone-700' : 'text-stone-400'}`}>
                  {g.name ?? g.provider_group_id}
                  {g.is_test && <span className="ml-1 text-[9px] uppercase text-stone-400">test</span>}
                </span>
                {g.msgs_7d > 0 && <span className="text-[10px] text-stone-400 shrink-0">{g.msgs_7d} msg/7d</span>}
                {g.pending_drafts > 0 && (
                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 rounded-full px-1.5 py-0.5 shrink-0">
                    {g.pending_drafts} draft{g.pending_drafts > 1 ? 's' : ''}
                  </span>
                )}
                <button
                  type="button"
                  disabled={busy === g.provider_group_id}
                  onClick={() => toggle(g)}
                  className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 border font-medium transition-colors disabled:opacity-50 ${
                    g.is_active
                      ? 'border-stone-200 text-stone-500 hover:border-rose-300 hover:text-rose-600'
                      : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  {busy === g.provider_group_id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Power size={12} />}
                  {g.is_active ? 'Remove' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {adderOpen && <AddGroupModal onClose={() => setAdderOpen(false)} onAdded={invalidate} />}
    </details>
  )
}

/** Modal: pull the live Maytapi group list and add the ones not yet onboarded. */
function AddGroupModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState<MaytapiGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try {
      setGroups(await fetchMaytapiGroups())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load WhatsApp groups')
    } finally {
      setLoading(false)
    }
  }
  // Load once on mount.
  useEffect(() => { void load() }, [])

  const q = search.trim().toLowerCase()
  const candidates = groups
    .filter((g) => !g.onboarded && (g.name ?? '').trim())
    .filter((g) => (q ? (g.name ?? '').toLowerCase().includes(q) : true))
    .sort((a, b) => (b.participants ?? 0) - (a.participants ?? 0))

  function toggleSel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function addSelected() {
    if (selected.size === 0) return
    setAdding(true)
    const byId = new Map(groups.map((g) => [g.id, g]))
    let ok = 0
    try {
      for (const id of selected) {
        try { await addGroup(id, byId.get(id)?.name ?? null); ok++ }
        catch { /* skip individual failures, report at end */ }
      }
      toast.success(`Added ${ok} group${ok === 1 ? '' : 's'}`)
      onAdded()
      onClose()
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl bg-white shadow-xl border border-stone-100"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-700">Add groups from WhatsApp</h3>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600"><X size={16} /></button>
        </div>

        <div className="p-3 border-b border-stone-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups the bot is in…"
              className="w-full rounded-full border border-stone-200 bg-white pl-9 pr-3 py-1.5 text-xs text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-stone-400 py-10">
              <Loader2 size={14} className="animate-spin" /> Loading WhatsApp groups…
            </div>
          ) : error ? (
            <div className="p-4 text-xs text-rose-600">
              {error}
              <button type="button" onClick={load} className="ml-2 inline-flex items-center gap-1 text-amber-700 hover:underline">
                <RefreshCw size={12} /> retry
              </button>
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-stone-400 text-center py-10">{q ? 'No matches.' : 'All groups are already added. 🎉'}</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {candidates.map((g) => (
                <label key={g.id} className="flex items-center gap-2.5 px-4 py-2 text-xs cursor-pointer hover:bg-stone-50">
                  <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleSel(g.id)}
                    className="accent-amber-700 w-3.5 h-3.5" />
                  <span className="flex-1 truncate text-stone-700">{g.name}</span>
                  {g.participants != null && <span className="text-[10px] text-stone-400 shrink-0">{g.participants}p</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100">
          <span className="text-xs text-stone-400">{selected.size} selected</span>
          <button
            type="button" disabled={selected.size === 0 || adding}
            onClick={addSelected}
            className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-4 py-1.5 bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add {selected.size > 0 ? selected.size : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

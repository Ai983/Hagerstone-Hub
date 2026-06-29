import { useState } from 'react'
import { ChevronDown, MessageSquareText, Clock, Search } from 'lucide-react'
import { MarkdownAnswer } from '../founder/chatbot/MarkdownAnswer'
import { useGroupSummaries, type GieGroup } from '../../../lib/gie'

interface Props {
  groups: GieGroup[]
  groupId: string | null
  onGroupChange: (id: string) => void
  /** When true the brief body is collapsed by default (operator table is primary). */
  briefCollapsed?: boolean
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Minutes since a timestamp, or null. */
function minsSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000)
}

function GroupPill({
  group, active, onClick,
}: { group: GieGroup; active: boolean; onClick: () => void }) {
  const mins = minsSince(group.last_summarised_at)
  // "Stale" when no memo yet, or older than ~2× the group's cadence.
  const stale = mins === null || mins > group.summarise_every_minutes * 2
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
        active
          ? 'bg-amber-700 border-amber-700 text-white'
          : group.is_test
            ? 'bg-stone-50 border-stone-200 text-stone-400 hover:border-stone-300'
            : 'bg-white border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-800'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-rose-400' : 'bg-emerald-500'}`} />
      {group.name ?? group.provider_group_id.replace('@g.us', '')}
      {group.is_test && <span className="text-[9px] uppercase tracking-wide opacity-70">test</span>}
    </button>
  )
}

export function GroupMemoViewer({ groups, groupId, onGroupChange, briefCollapsed = false }: Props) {
  const { data: summaries = [], isLoading } = useGroupSummaries(groupId)
  const [showOlder, setShowOlder] = useState(false)
  const [showRolling, setShowRolling] = useState(false)
  const [search, setSearch] = useState('')
  const [briefOpen, setBriefOpen] = useState(!briefCollapsed)

  const latest = summaries[0] ?? null
  const older = summaries.slice(1)

  const q = search.trim().toLowerCase()
  const filteredGroups = q
    ? groups.filter((g) => (g.name ?? g.provider_group_id).toLowerCase().includes(q))
    : groups

  return (
    <section className="rounded-2xl bg-white border border-stone-100 p-4 sm:p-5"
      style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquareText size={16} className="text-amber-700" />
        <h2 className="text-sm font-semibold text-stone-700">Group Briefs</h2>
      </div>

      {/* Group switcher */}
      {groups.length === 0 ? (
        <p className="text-xs text-stone-400 py-6 text-center">No groups registered yet.</p>
      ) : (
        <>
          {/* Search */}
          <div className="relative mb-2.5">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups…"
              className="w-full rounded-full border border-stone-200 bg-white pl-9 pr-3 py-1.5 text-xs text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-300"
            />
          </div>

          {filteredGroups.length === 0 ? (
            <p className="text-xs text-stone-400 py-3 text-center">No groups match “{search}”.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
              {filteredGroups.map((g) => (
                <GroupPill key={g.id} group={g} active={g.id === groupId} onClick={() => onGroupChange(g.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Collapse toggle (operator table is primary; brief is reference) */}
      <button
        type="button"
        onClick={() => setBriefOpen((v) => !v)}
        className="mt-3 text-xs font-medium text-amber-700 hover:text-amber-800 flex items-center gap-1"
      >
        <ChevronDown size={13} className={`transition-transform ${briefOpen ? 'rotate-180' : ''}`} />
        {briefOpen ? 'Hide brief' : 'Show brief'}
      </button>

      {/* Latest memo */}
      {briefOpen && (
      <div className="mt-3">
        {isLoading ? (
          <div className="h-32 rounded-xl bg-stone-50 animate-pulse border border-stone-100" />
        ) : !latest ? (
          <p className="text-xs text-stone-400 py-8 text-center">No briefs yet for this group.</p>
        ) : (
          <div className="rounded-xl border border-stone-100 bg-stone-50/60 p-4">
            <div className="flex items-center gap-2 text-[11px] text-stone-400 mb-2">
              <Clock size={11} />
              <span>{fmt(latest.window_start)} – {fmt(latest.window_end)}</span>
              {latest.model && <span className="text-stone-300">· {latest.model}</span>}
            </div>
            <MarkdownAnswer text={latest.memo_md} />

            {latest.rolling_summary && (
              <div className="mt-3 pt-3 border-t border-stone-200/70">
                <button
                  type="button"
                  onClick={() => setShowRolling((v) => !v)}
                  className="text-[11px] font-medium text-amber-700 hover:text-amber-800 flex items-center gap-1"
                >
                  <ChevronDown size={12} className={`transition-transform ${showRolling ? 'rotate-180' : ''}`} />
                  Rolling summary
                </button>
                {showRolling && (
                  <p className="mt-2 text-xs text-stone-500 leading-relaxed whitespace-pre-wrap">
                    {latest.rolling_summary}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Older briefs */}
      {briefOpen && older.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowOlder((v) => !v)}
            className="text-xs font-medium text-stone-500 hover:text-stone-700 flex items-center gap-1"
          >
            <ChevronDown size={13} className={`transition-transform ${showOlder ? 'rotate-180' : ''}`} />
            {older.length} earlier brief{older.length > 1 ? 's' : ''}
          </button>
          {showOlder && (
            <div className="mt-2 space-y-3">
              {older.map((s) => (
                <div key={s.id} className="rounded-xl border border-stone-100 bg-white p-4">
                  <div className="text-[11px] text-stone-400 mb-2">{fmt(s.window_start)} – {fmt(s.window_end)}</div>
                  <MarkdownAnswer text={s.memo_md} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

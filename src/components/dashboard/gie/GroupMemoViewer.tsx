import { useState } from 'react'
import { ChevronDown, MessageSquareText, Clock, Search } from 'lucide-react'
import { MarkdownAnswer } from '../founder/chatbot/MarkdownAnswer'
import { useGroupSummaries, type GieGroupOverview } from '../../../lib/gie'

interface Props {
  groups: GieGroupOverview[]
  groupId: string | null
  onGroupChange: (id: string) => void
  /** When true the brief body is collapsed by default (operator table is primary). */
  briefCollapsed?: boolean
}

/** Higher = more deserving of the operator's attention. Drives pill ordering. */
function attentionScore(g: GieGroupOverview): number {
  return g.pending_drafts * 100 + g.open_flags * 10 + (g.has_new ? 5 : 0) + (g.msgs_7d > 0 ? 1 : 0)
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function GroupPill({
  group, active, onClick,
}: { group: GieGroupOverview; active: boolean; onClick: () => void }) {
  // Dot cue: blue = new messages since last brief (look here!), green = active in
  // the last 7d, grey = quiet.
  const dot = group.has_new ? 'bg-sky-500 animate-pulse' : group.msgs_7d > 0 ? 'bg-emerald-500' : 'bg-stone-300'
  return (
    <button
      type="button"
      onClick={onClick}
      title={group.has_new ? 'New messages since last brief' : undefined}
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
        active
          ? 'bg-amber-700 border-amber-700 text-white'
          : group.is_test
            ? 'bg-stone-50 border-stone-200 text-stone-400 hover:border-stone-300'
            : 'bg-white border-stone-200 text-stone-600 hover:border-amber-300 hover:text-amber-800'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="truncate max-w-[180px]">{group.name ?? group.provider_group_id.replace('@g.us', '')}</span>
      {group.pending_drafts > 0 && (
        <span className={`ml-0.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none ${
          active ? 'bg-white/25 text-white' : 'bg-rose-100 text-rose-700'
        }`} title={`${group.pending_drafts} task${group.pending_drafts > 1 ? 's' : ''} to dispatch`}>
          {group.pending_drafts}
        </span>
      )}
      {group.open_flags > 0 && (
        <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none ${
          active ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'
        }`} title={`${group.open_flags} open flag${group.open_flags > 1 ? 's' : ''}`}>
          ⚑{group.open_flags}
        </span>
      )}
      {group.is_test && <span className="text-[9px] uppercase tracking-wide opacity-70">test</span>}
    </button>
  )
}

export function GroupMemoViewer({ groups, groupId, onGroupChange, briefCollapsed = false }: Props) {
  const { data: summaries = [], isLoading } = useGroupSummaries(groupId)
  const [showOlder, setShowOlder] = useState(false)
  const [showRolling, setShowRolling] = useState(false)
  const [search, setSearch] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(true)
  const [briefOpen, setBriefOpen] = useState(!briefCollapsed)

  const latest = summaries[0] ?? null
  const older = summaries.slice(1)

  // Only active groups appear in the picker (deactivated ones are hidden — manage
  // them in the Manage Groups panel). Sort the noisiest/most-actionable to the front.
  const activeGroups = groups.filter((g) => g.is_active)
  const q = search.trim().toLowerCase()
  const needsAttention = (g: GieGroupOverview) =>
    g.pending_drafts > 0 || g.open_flags > 0 || g.has_new || g.msgs_7d > 0 || g.id === groupId

  const filteredGroups = [...activeGroups]
    .filter((g) => (q
      ? (g.name ?? g.provider_group_id).toLowerCase().includes(q)
      : attentionOnly ? needsAttention(g) : true))
    .sort((a, b) => {
      const s = attentionScore(b) - attentionScore(a)
      if (s !== 0) return s
      const at = a.last_message_at ? Date.parse(a.last_message_at) : 0
      const bt = b.last_message_at ? Date.parse(b.last_message_at) : 0
      if (bt !== at) return bt - at
      return (a.name ?? '').localeCompare(b.name ?? '')
    })

  const hiddenCount = activeGroups.length - filteredGroups.length

  return (
    <section className="rounded-2xl bg-white border border-stone-100 p-4 sm:p-5"
      style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <div className="flex items-center gap-2 mb-3">
        <MessageSquareText size={16} className="text-amber-700" />
        <h2 className="text-sm font-semibold text-stone-700">Group Briefs</h2>
      </div>

      {/* Group switcher */}
      {activeGroups.length === 0 ? (
        <p className="text-xs text-stone-400 py-6 text-center">No active groups. Add some in Manage Groups.</p>
      ) : (
        <>
          {/* Search + attention filter */}
          <div className="flex items-center gap-2 mb-2.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${activeGroups.length} groups…`}
                className="w-full rounded-full border border-stone-200 bg-white pl-9 pr-3 py-1.5 text-xs text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-300"
              />
            </div>
            {!q && (
              <button
                type="button"
                onClick={() => setAttentionOnly((v) => !v)}
                className={`shrink-0 text-xs font-medium rounded-full px-3 py-1.5 border transition-colors ${
                  attentionOnly
                    ? 'bg-amber-700 border-amber-700 text-white'
                    : 'bg-white border-stone-200 text-stone-600 hover:border-amber-300'
                }`}
                title="Show only groups with tasks, flags, or new messages"
              >
                {attentionOnly ? 'Needs attention' : 'All groups'}
              </button>
            )}
          </div>

          {filteredGroups.length === 0 ? (
            <p className="text-xs text-stone-400 py-3 text-center">
              {q ? `No groups match “${search}”.` : 'Nothing needs attention right now. 🎉'}
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
              {filteredGroups.map((g) => (
                <GroupPill key={g.id} group={g} active={g.id === groupId} onClick={() => onGroupChange(g.id)} />
              ))}
            </div>
          )}

          {!q && attentionOnly && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setAttentionOnly(false)}
              className="text-[11px] text-stone-400 hover:text-amber-700"
            >
              + {hiddenCount} quiet group{hiddenCount > 1 ? 's' : ''} hidden — show all
            </button>
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

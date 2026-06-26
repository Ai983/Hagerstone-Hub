import { ClipboardList } from 'lucide-react'
import { useDraftTasks, type GieDraftTask } from '../../../lib/gie'
import { DraftTaskCard } from './DraftTaskCard'

export function DraftTaskQueue({
  groupId, empNameById, onReview,
}: {
  groupId: string | null
  empNameById: Record<string, string>
  onReview: (d: GieDraftTask) => void
}) {
  const { data: drafts = [], isLoading } = useDraftTasks(groupId)

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-amber-700" />
          <h2 className="text-sm font-semibold text-stone-700">Draft Tasks</h2>
        </div>
        {drafts.length > 0 && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            {drafts.length} pending
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => <div key={i} className="h-40 rounded-2xl bg-white/70 animate-pulse border border-stone-100" />)}
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white/50 p-8 text-center">
          <p className="text-xs text-stone-400">No draft tasks waiting. New leadership asks turn into drafts here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {drafts.map((d) => (
            <DraftTaskCard
              key={d.id}
              draft={d}
              assigneeName={d.suggested_assignee_employee_id ? (empNameById[d.suggested_assignee_employee_id] ?? null) : null}
              onReview={onReview}
            />
          ))}
        </div>
      )}
    </section>
  )
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Send, X, Loader2, UserRound } from 'lucide-react'
import { Button } from '../../ui/button'
import { rejectDraft, type GieDraftTask } from '../../../lib/gie'

/**
 * A compact preview of one AI-drafted task. The AI context (title, description,
 * suggested person) is shown read-only; "Review & Dispatch" opens the SAME
 * delegation "Naya Kaam" form (pre-filled) so creation criteria stay identical.
 */
export function DraftTaskCard({
  draft, assigneeName, onReview,
}: {
  draft: GieDraftTask
  assigneeName: string | null
  onReview: (d: GieDraftTask) => void
}) {
  const qc = useQueryClient()
  const rejectM = useMutation({
    mutationFn: () => rejectDraft(draft.id),
    onSuccess: () => { toast.success('Draft dismissed'); qc.invalidateQueries({ queryKey: ['gie_drafts'] }) },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not dismiss'),
  })

  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5" style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.06)' }}>
      <div className="flex items-center gap-2 text-[11px] text-stone-400 mb-2">
        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium">Draft</span>
        {draft.group?.name && <span>from {draft.group.name}</span>}
      </div>

      <h3 className="font-semibold text-stone-800 text-[15px] leading-snug">{draft.title}</h3>
      {draft.description && <p className="text-sm text-stone-500 mt-2 leading-relaxed">{draft.description}</p>}

      <div className="flex items-center gap-1.5 mt-3 text-xs text-stone-500">
        <UserRound size={13} className="text-amber-600" />
        Suggested: <span className="font-medium text-stone-700">{assigneeName ?? 'pick a person'}</span>
      </div>

      <div className="flex gap-2 mt-4">
        <Button type="button" variant="outline" disabled={rejectM.isPending} onClick={() => rejectM.mutate()}
          className="flex-1 text-sm h-10 border-stone-200 text-stone-500">
          {rejectM.isPending ? <Loader2 size={14} className="animate-spin" /> : <><X size={14} className="mr-1" /> Dismiss</>}
        </Button>
        <Button type="button" onClick={() => onReview(draft)}
          className="flex-1 text-sm h-10 bg-amber-700 hover:bg-amber-800 text-white font-medium">
          <Send size={14} className="mr-1.5" /> Review &amp; Dispatch
        </Button>
      </div>
    </div>
  )
}

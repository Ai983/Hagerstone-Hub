import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Flag, Check, X, Loader2 } from 'lucide-react'
import { useFlaggedItems, actionFlag, dismissFlag } from '../../../lib/gie'

interface Props {
  /** Selected group — flags are scoped to it. */
  groupId: string | null
  /** employees.id (Hub PK) of the logged-in leader — stamped on actioned flags. */
  actionedByEmployeeId: string
}

function fmtRel(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function FlagQueue({ groupId, actionedByEmployeeId }: Props) {
  const { data: flags = [], isLoading } = useFlaggedItems(groupId)
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'action' | 'dismiss' }) =>
      kind === 'action' ? actionFlag(id, actionedByEmployeeId) : dismissFlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gie_flags'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update flag'),
    onSettled: () => setBusyId(null),
  })

  function run(id: string, kind: 'action' | 'dismiss') {
    setBusyId(id)
    mutation.mutate({ id, kind })
  }

  return (
    <section className="rounded-2xl bg-white border border-stone-100 p-4 sm:p-5"
      style={{ boxShadow: '0 4px 16px rgba(146,64,14,0.07)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Flag size={16} className="text-rose-500" />
          <h2 className="text-sm font-semibold text-stone-700">Leadership Flags</h2>
        </div>
        {flags.length > 0 && (
          <span className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
            {flags.length} open
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-16 rounded-xl bg-stone-50 animate-pulse border border-stone-100" />)}
        </div>
      ) : flags.length === 0 ? (
        <p className="text-xs text-stone-400 py-6 text-center">No open leadership flags 🎉</p>
      ) : (
        <div className="space-y-2">
          {flags.map((f) => {
            const busy = busyId === f.id
            return (
              <div key={f.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                <p className="text-sm text-stone-700 leading-snug">{f.excerpt}</p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <div className="text-[11px] text-stone-400 truncate">
                    {fmtRel(f.created_at)}
                    {f.leader_phone && <span className="ml-1 text-stone-300">· {f.leader_phone}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(f.id, 'action')}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Actioned
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(f.id, 'dismiss')}
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-100 disabled:opacity-50"
                    >
                      <X size={11} /> Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

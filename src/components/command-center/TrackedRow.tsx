import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, Loader2 } from 'lucide-react'
import { TableRow, TableCell } from '../ui/table'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { ReminderTracker } from './ReminderTracker'
import { cancelTrackedTask, type GieTrackedTask } from '../../lib/gie'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

/** A dispatched task's lifecycle status, derived from del_tasks + its tracker. */
export function trackedStatus(t: GieTrackedTask): 'completed' | 'penalty' | 'overdue' | 'active' {
  const done = t.tracking?.is_completed || ['submitted', 'under_review', 'completed'].includes(t.status) || !!t.submitted_at
  if (done) return 'completed'
  if (t.tracking?.penalty_applied) return 'penalty'
  const due = t.tracking?.due_at
  if (due && new Date(due).getTime() < Date.now()) return 'overdue'
  return 'active'
}

export function TrackedRow({
  task, empNameById,
}: {
  task: GieTrackedTask
  empNameById: Record<string, string>
}) {
  const qc = useQueryClient()
  const st = trackedStatus(task)
  const tr = task.tracking
  const assigneeName = tr?.assignee_employee_id ? (empNameById[tr.assignee_employee_id] ?? '—') : '—'

  const cancelM = useMutation({
    mutationFn: () => cancelTrackedTask(task.id, tr?.id ?? null),
    onSuccess: () => {
      toast.success('Task deleted · reminders stopped')
      qc.invalidateQueries({ queryKey: ['gie_tracking'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete task'),
  })

  const badge =
    st === 'completed' ? <Badge className="bg-stone-200 text-stone-700">Completed</Badge>
    : st === 'penalty' ? <Badge variant="destructive">Penalty −500</Badge>
    : st === 'overdue' ? <Badge className="bg-red-100 text-red-700">Overdue</Badge>
    : <Badge className="bg-sky-100 text-sky-700">Active</Badge>

  return (
    <TableRow>
      <TableCell className="p-2" />
      <TableCell className="p-2 align-top text-xs text-stone-500">{fmt(task.created_at)}</TableCell>
      <TableCell className="p-2 align-top">
        <span className="block truncate rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600" title={task.group_name ?? ''}>
          {task.group_name ?? '—'}
        </span>
      </TableCell>
      <TableCell className="p-2 align-top text-xs font-semibold text-stone-700 truncate" title={task.on_behalf_of ?? ''}>{task.on_behalf_of ?? '—'}</TableCell>
      <TableCell className="p-2 align-top text-sm text-stone-800 truncate" title={assigneeName}>{assigneeName}</TableCell>
      <TableCell className="p-2 align-top">
        <div className="flex items-center gap-2">
          {badge}
          {task.auto_dispatched_at && (
            <Badge
              className="bg-violet-100 text-violet-700"
              title={`Created + WhatsApped automatically on a director's @mention, ${fmt(task.auto_dispatched_at)} — no operator click`}
            >
              🤖 Auto
            </Badge>
          )}
          <span className="text-sm text-stone-800 line-clamp-2">{task.title}</span>
        </div>
      </TableCell>
      <TableCell className="p-2 align-top text-xs text-stone-500">{fmt(tr?.due_at ?? null)}</TableCell>
      <TableCell className="p-2 align-top text-sm text-stone-700">{task.custom_points ?? tr?.task_points ?? '—'}</TableCell>
      <TableCell className="p-2 align-top">
        <ReminderTracker
          count={tr?.reminder_count ?? 0}
          penaltyApplied={!!tr?.penalty_applied}
          completed={st === 'completed'}
          lastReminderAt={tr?.last_reminder_at}
        />
      </TableCell>
      <TableCell className="p-2 align-top">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs text-stone-400 truncate" title={st === 'completed' && task.submitted_at ? `submitted ${fmt(task.submitted_at)}` : ''}>
            {st === 'completed' && task.submitted_at ? `sub ${fmt(task.submitted_at)}` : ''}
          </span>
          <Button
            size="sm" variant="ghost"
            disabled={cancelM.isPending}
            onClick={() => { if (confirm(`Delete this task?\n\n“${task.title}”\n\nThe assignee's task is cancelled and all reminders/penalties stop. This cannot be undone.`)) cancelM.mutate() }}
            className="h-8 w-7 p-0 shrink-0 text-stone-400 hover:text-red-600"
            title="Delete task"
          >
            {cancelM.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

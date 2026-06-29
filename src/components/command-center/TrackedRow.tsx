import { TableRow, TableCell } from '../ui/table'
import { Badge } from '../ui/badge'
import { ReminderTracker } from './ReminderTracker'
import type { GieTrackedTask } from '../../lib/gie'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
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
  const st = trackedStatus(task)
  const tr = task.tracking
  const assigneeName = tr?.assignee_employee_id ? (empNameById[tr.assignee_employee_id] ?? '—') : '—'

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
      <TableCell className="p-2 text-xs text-stone-400">
        {st === 'completed' && task.submitted_at ? `submitted ${fmt(task.submitted_at)}` : ''}
      </TableCell>
    </TableRow>
  )
}

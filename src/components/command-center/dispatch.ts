import type { GieDraftTask, DispatchDraftArgs } from '../../lib/gie'
import type { Employee } from '../../types'

/** Build the due timestamp the reminder engine anchors R1 on: prefer an explicit
 *  due_at, else compose task_date + due_time (default 18:00). */
export function computeDueAt(draft: GieDraftTask): string | null {
  if (draft.due_at) return draft.due_at
  if (draft.task_date) {
    const t = draft.due_time && /^\d{2}:\d{2}/.test(draft.due_time) ? draft.due_time.slice(0, 5) : '18:00'
    const d = new Date(`${draft.task_date}T${t}:00`)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

export interface ResolvedDraft {
  ready: boolean
  missing: string[]               // human labels: 'assignee' | 'details' | 'due' | 'points'
  assignee: Employee | null
  /** Present only when ready — supply the operator's auth uid to get dispatch args. */
  build?: (assignedByAuthUid: string) => DispatchDraftArgs
}

/**
 * A draft is 🟢 Ready only with a resolvable assignee (account present), a title,
 * a due date, and a ladder points value. Anything missing → 🟠 Needs info.
 * Used by both the single-row Dispatch and "Dispatch all Ready".
 */
export function resolveDraft(draft: GieDraftTask, employees: Employee[]): ResolvedDraft {
  const assignee = draft.suggested_assignee_employee_id
    ? employees.find((e) => e.id === draft.suggested_assignee_employee_id) ?? null
    : null

  const missing: string[] = []
  if (!assignee || !assignee.auth_user_id) missing.push('assignee')
  if (!draft.title?.trim()) missing.push('details')
  if (!draft.task_date) missing.push('due')
  if (draft.custom_points == null) missing.push('points')

  const ready = missing.length === 0
  const build = ready
    ? (assignedByAuthUid: string): DispatchDraftArgs => ({
        draft,
        assignedToAuthUid: assignee!.auth_user_id!,
        assignedByAuthUid,
        roleGroup: draft.role_group || assignee!.role,   // never empty
        projectId: draft.project_id,
        taskDate: draft.task_date!,
        dueTime: draft.due_time,
        customPoints: draft.custom_points,
        onBehalfOf: draft.on_behalf_of ?? draft.assigned_by_name,
        assigneeEmployeeId: assignee!.id,
        assigneePhone: assignee!.phone,
        dueAt: computeDueAt(draft),
      })
    : undefined

  return { ready, missing, assignee, build }
}

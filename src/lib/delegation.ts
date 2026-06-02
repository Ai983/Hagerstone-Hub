import { supabase } from './supabase'
import type { DelTask, DelTaskType } from '../types/delegation'
import type { Employee } from '../types'

// ── Task types ────────────────────────────────────────────────────────────────

export async function fetchTaskTypes(roleGroup: string): Promise<DelTaskType[]> {
  const { data, error } = await supabase
    .from('del_task_types')
    .select('*')
    .eq('role_group', roleGroup)
    .eq('active', true)
    .order('effort_tier')
  if (error) throw error
  return data ?? []
}

// ── My tasks ──────────────────────────────────────────────────────────────────

export async function fetchMyTasks(authUserId: string): Promise<DelTask[]> {
  const { data, error } = await supabase
    .from('del_tasks')
    .select('*, del_points(id, points, reason, status, awarded_at)')
    .eq('assigned_to', authUserId)
    .order('task_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DelTask[]
}

// ── Team members (for head/founder assignment) ────────────────────────────────

export async function fetchTeamMembers(roleGroup: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, auth_user_id, name, email, role, is_head, is_active')
    .eq('role', roleGroup)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as Employee[]
}

export async function fetchAllActiveEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, auth_user_id, name, email, role, is_head, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as Employee[]
}

// ── Submitted tasks (verify queue) ────────────────────────────────────────────

export async function fetchSubmittedTasks(roleGroup: string | null): Promise<DelTask[]> {
  let q = supabase
    .from('del_tasks')
    .select('*, del_points(id, points, reason, status, awarded_at)')
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true })

  if (roleGroup) q = q.eq('role_group', roleGroup)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DelTask[]
}

// ── Task mutations ────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string
  description: string
  type_code: string
  task_date: string
  role_group: string
  assigned_to: string   // auth.users.id
  assigned_by: string   // auth.users.id
}

export async function createTask(input: CreateTaskInput): Promise<void> {
  const { error } = await supabase.from('del_tasks').insert({
    title:       input.title.trim(),
    description: input.description.trim() || null,
    type_code:   input.type_code || null,
    task_date:   input.task_date,
    role_group:  input.role_group,
    assigned_to: input.assigned_to,
    assigned_by: input.assigned_by,
  })
  if (error) throw error
}

export async function moveToInProgress(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('del_tasks')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

// ── Edge Function calls ───────────────────────────────────────────────────────

export async function submitTask(taskId: string): Promise<{ points: number; reason: string }> {
  const { data, error } = await supabase.functions.invoke('del-submit-task', {
    body: { task_id: taskId },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as { points: number; reason: string }
}

export async function verifyTask(
  taskId: string,
  decision: 'approve' | 'reject',
  rejectReason?: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('del-verify-task', {
    body: { task_id: taskId, decision, reject_reason: rejectReason },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
}

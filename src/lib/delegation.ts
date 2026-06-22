import { supabase } from './supabase'
import type { DelTask, DelTaskType, DelSubmission } from '../types/delegation'
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

// Create a NEW task type that persists in del_task_types (admin/founder/del_super).
export async function createTaskType(label: string, category: string, tier: string): Promise<DelTaskType> {
  const { data, error } = await supabase.functions.invoke('del-create-task-type', {
    body: { label, category, tier },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data.task_type as DelTaskType
}

export async function fetchAllTaskTypes(): Promise<DelTaskType[]> {
  const { data, error } = await supabase
    .from('del_task_types')
    .select('*')
    .eq('active', true)
    .order('role_group')
    .order('effort_tier')
  if (error) throw error
  return data ?? []
}

// ── My tasks ──────────────────────────────────────────────────────────────────

export async function fetchMyTasks(authUserId: string): Promise<DelTask[]> {
  const { data, error } = await supabase
    .from('del_tasks')
    .select('*, del_points(id, points, proposed_points, summary, agent_meta, reason, status, awarded_at)')
    .eq('assigned_to', authUserId)
    .order('task_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DelTask[]
}

// ── Team members (for head/founder assignment) ────────────────────────────────

// Org/approval accounts that are the primary of a dual identity (a personal account
// points to them via points_alias_of). Hidden from assignment pickers so each person
// appears ONCE and delegation routes to their personal account; points still merge on
// the leaderboard (get_work_scores folds the alias into the org card).
async function aliasedPrimaryIds(): Promise<Set<string>> {
  const { data } = await supabase
    .from('employees')
    .select('points_alias_of')
    .not('points_alias_of', 'is', null)
  return new Set((data ?? []).map((r: { points_alias_of: string }) => r.points_alias_of))
}

export async function fetchTeamMembers(roleGroup: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, auth_user_id, name, email, role, is_head, is_active')
    .eq('role', roleGroup)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  const hidden = await aliasedPrimaryIds()
  return (data ?? []).filter((e) => !(e.auth_user_id && hidden.has(e.auth_user_id))) as Employee[]
}

export async function fetchAllActiveEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('id, auth_user_id, name, email, role, is_head, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  const hidden = await aliasedPrimaryIds()
  return (data ?? []).filter((e) => !(e.auth_user_id && hidden.has(e.auth_user_id))) as Employee[]
}

// ── Projects (for the task-form project picker; live from public.projects) ─────
export interface DelProjectOption {
  id: string
  code: string
  name: string
}

export async function fetchActiveProjects(): Promise<DelProjectOption[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, code, name')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []) as DelProjectOption[]
}

// ── Verify queue (tasks awaiting head review — under_review status) ────────────

export async function fetchSubmittedTasks(roleGroup: string | null): Promise<DelTask[]> {
  let q = supabase
    .from('del_tasks')
    .select(`
      *,
      del_points(id, points, proposed_points, summary, agent_meta, reason, status, awarded_at),
      del_submissions(id, raw_text, attachments, input_type, created_at)
    `)
    .in('status', ['under_review', 'submitted'])
    .order('submitted_at', { ascending: true })
    // Latest submission first — a task can have several (e.g. resubmitted after a
    // rejection); the reviewer must see the most recent one (and its attachments).
    .order('created_at', { ascending: false, referencedTable: 'del_submissions' })

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
  project_id?: string | null      // public.projects.id
  custom_points?: number | null   // set for "Other" custom tasks (auto-award on verify)
  on_behalf_of?: string | null    // 'Dhruv Sir' | 'Bhaskar Sir'
  due_time?: string | null        // 'HH:MM' display-only deadline time
}

export async function createTask(input: CreateTaskInput): Promise<string> {
  const { data, error } = await supabase
    .from('del_tasks')
    .insert({
      title:         input.title.trim(),
      description:   input.description.trim() || null,
      type_code:     input.type_code || null,
      task_date:     input.task_date,
      role_group:    input.role_group,
      assigned_to:   input.assigned_to,
      assigned_by:   input.assigned_by,
      project_id:    input.project_id ?? null,
      custom_points: input.custom_points ?? null,
      on_behalf_of:  input.on_behalf_of ?? null,
      due_time:      input.due_time ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  const taskId = data.id as string

  // Head/founder assigning to someone else → fire WhatsApp notification (SPEC §6).
  // Self-assigned tasks are skipped server-side. Best-effort; never blocks creation.
  if (input.assigned_to !== input.assigned_by) {
    supabase.functions
      .invoke('del-notify-assign', { body: { task_id: taskId } })
      .catch(() => { /* notification is best-effort */ })
  }

  return taskId
}

export async function moveToInProgress(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('del_tasks')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw error
}

export async function cancelTask(taskId: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('del_tasks')
    .update({
      status: 'cancelled',
      reject_reason: reason.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
  if (error) throw error
}

// ── Edge Function calls ───────────────────────────────────────────────────────

export interface SubmitTaskInput {
  task_id: string
  text: string
  attachments?: { url: string; type: string; name: string; size: number }[]
}

export async function submitTask(
  input: SubmitTaskInput,
): Promise<{ submission_id: string; message: string }> {
  const { data, error } = await supabase.functions.invoke('del-submit-task', {
    body: input,
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as { submission_id: string; message: string }
}

export interface VerifyTaskInput {
  task_id: string
  decision: 'approve' | 'adjust' | 'reject'
  final_points?: number   // required when decision = 'adjust'
  reject_reason?: string  // required when decision = 'reject'
}

export async function verifyTask(input: VerifyTaskInput): Promise<void> {
  const { data, error } = await supabase.functions.invoke('del-verify-task', {
    body: input,
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
}

// Resend / nudge an already-assigned task (gentle before deadline, strict after).
export async function resendTaskFollowup(taskId: string): Promise<{ sent: boolean; overdue: boolean }> {
  const { data, error } = await supabase.functions.invoke('del-task-followup', {
    body: { task_id: taskId },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return { sent: !!data?.sent, overdue: !!data?.overdue }
}

// All currently-open delegation tasks (for the org employee board / ranking).
export async function fetchAllOpenTasks(): Promise<DelTask[]> {
  const { data, error } = await supabase
    .from('del_tasks')
    .select('*, del_points(points, proposed_points, status)')
    .in('status', ['assigned', 'in_progress', 'submitted', 'under_review'])
    .order('task_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as DelTask[]
}

// ── Upload attachment to Supabase Storage ─────────────────────────────────────

export async function uploadAttachment(
  taskId: string,
  file: File,
): Promise<{ url: string; type: string; name: string; size: number }> {
  const ext = file.name.split('.').pop() ?? 'bin'
  const uuid = crypto.randomUUID()
  const path = `task/${taskId}/${uuid}-${file.name}`

  const { error: uploadErr } = await supabase.storage
    .from('delegation-uploads')
    .upload(path, file, { contentType: file.type })

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  const { data: urlData } = supabase.storage
    .from('delegation-uploads')
    .getPublicUrl(path)

  return {
    url: urlData.publicUrl || path,
    type: file.type || ext,
    name: file.name,
    size: file.size,
  }
}

export async function fetchSubmission(taskId: string): Promise<DelSubmission | null> {
  const { data, error } = await supabase
    .from('del_submissions')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as DelSubmission | null
}

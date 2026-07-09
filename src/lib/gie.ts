import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { createTask } from './delegation'

// ── Types (mirror the gie_* tables) ───────────────────────────────────────────

export interface GieGroup {
  id: string
  provider_group_id: string
  name: string | null
  is_active: boolean
  is_test: boolean
  summarise_every_minutes: number
  last_summarised_at: string | null
  created_at: string
}

/** Enriched group row from gie_groups_overview() — carries the attention signals
 *  the picker + Manage Groups panel render (pending drafts, open flags, new msgs). */
export interface GieGroupOverview {
  id: string
  provider_group_id: string
  name: string | null
  is_active: boolean
  is_test: boolean
  summarise_every_minutes: number
  last_summarised_at: string | null
  pending_drafts: number
  open_flags: number
  last_message_at: string | null
  msgs_7d: number
  has_new: boolean
}

/** One WhatsApp group as seen on the Maytapi side (for the "add group" picker). */
export interface MaytapiGroup {
  id: string
  name: string | null
  participants: number | null
  onboarded: boolean
}

export interface GieSummary {
  id: string
  group_id: string
  window_start: string
  window_end: string
  memo_md: string
  rolling_summary: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

/** A row may embed its group's name via the gie_groups FK. */
interface WithGroupName {
  group?: { name: string | null } | null
}

export type GieFlagStatus = 'open' | 'actioned' | 'dismissed'

export interface GieFlaggedItem extends WithGroupName {
  id: string
  group_id: string
  summary_id: string | null
  raw_message_id: string | null
  leader_phone: string | null
  excerpt: string
  status: GieFlagStatus
  actioned_by: string | null
  created_at: string
}

export type GieDraftStatus = 'pending' | 'approved' | 'rejected'

export interface GieDraftTask extends WithGroupName {
  id: string
  group_id: string | null
  summary_id: string | null
  flagged_item_id: string | null
  title: string
  description: string | null
  type_code: string | null
  role_group: string | null
  suggested_assignee_employee_id: string | null   // employees.id (Hub PK), NOT an auth uid
  task_date: string | null
  due_time: string | null
  custom_points: number | null
  on_behalf_of: string | null
  project_id: string | null
  status: GieDraftStatus
  approved_task_id: string | null
  created_at: string
  // ── v2 draft-extraction enrichment (Command Center operator table) ──
  assigned_by_name: string | null      // the leader who sent the ask (deterministic)
  assigned_by_phone: string | null
  source_excerpt: string | null        // the original WhatsApp message
  source_raw_message_id: string | null // the message the assignee was resolved from
  /** 'high'   — a director @mentioned them in the source message (auto-dispatched)
   *  'medium' — their name was written in the source message
   *  'low'    — guessed from elsewhere in the window; always needs a human
   *  null     — unassigned */
  assignee_confidence: string | null
  due_at: string | null                // timestamptz when stated/implied
  suggested_points: number | null      // AI-suggested ladder value
  needs_info: boolean
  /** Set when the task was created + WhatsApped with no operator click. Such drafts
   *  are already status='approved', so they never appear in the Dispatch queue. */
  auto_dispatched_at: string | null
}

/** A dispatched task as the operator sees it: del_tasks joined to its gie_task_tracking. */
export interface GieTrackedTask {
  // del_tasks
  id: string                 // del_tasks.id
  title: string
  description: string | null
  role_group: string
  status: string             // assigned | in_progress | submitted | under_review | completed | cancelled
  task_date: string
  due_time: string | null
  custom_points: number | null
  on_behalf_of: string | null
  submitted_at: string | null
  created_at: string
  assigned_to: string        // auth uid
  // from the originating draft (for the Group filter)
  group_id: string | null
  group_name: string | null
  // gie_task_tracking (embedded)
  tracking: {
    id: string
    assignee_employee_id: string | null
    assignee_phone: string | null
    due_at: string | null
    task_points: number | null
    reminder_count: number
    last_reminder_at: string | null
    next_reminder_at: string | null
    is_completed: boolean
    completed_at: string | null
    penalty_applied: boolean
    penalty_points: number
  } | null
}

// ── Query keys ────────────────────────────────────────────────────────────────

const GROUPS_KEY = ['gie_groups'] as const
const SUMMARIES_KEY = (groupId: string | null | undefined) => ['gie_summaries', groupId] as const
const FLAGS_KEY = ['gie_flags'] as const
const DRAFTS_KEY = ['gie_drafts'] as const
const TRACKING_KEY = ['gie_tracking'] as const

// ── Fetchers ──────────────────────────────────────────────────────────────────

export async function fetchGieGroups(): Promise<GieGroup[]> {
  const { data, error } = await supabase
    .from('gie_groups')
    .select('*')
    .eq('is_active', true)
    .order('is_test', { ascending: true })   // real groups first, test group last
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as GieGroup[]
}

export async function fetchGroupSummaries(groupId: string, limit = 20): Promise<GieSummary[]> {
  const { data, error } = await supabase
    .from('gie_summaries')
    .select('*')
    .eq('group_id', groupId)
    .order('window_end', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as GieSummary[]
}

/** OPEN leadership flags for one group (the action backlog for that group). */
export async function fetchFlaggedItems(groupId?: string | null): Promise<GieFlaggedItem[]> {
  let q = supabase.from('gie_flagged_items').select('*, group:gie_groups(name)').eq('status', 'open')
  if (groupId) q = q.eq('group_id', groupId)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GieFlaggedItem[]
}

/** PENDING draft tasks for one group — ready to edit + dispatch. */
export async function fetchDraftTasks(groupId?: string | null): Promise<GieDraftTask[]> {
  let q = supabase.from('gie_draft_tasks').select('*, group:gie_groups(name)').eq('status', 'pending')
  if (groupId) q = q.eq('group_id', groupId)
  const { data, error } = await q.order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as GieDraftTask[]
}

/**
 * All DISPATCHED tasks that originated from a draft (del_tasks ⨝ gie_task_tracking).
 * Powers the Active / Completed / Overdue tabs. Group is carried from the draft.
 */
export async function fetchTrackedTasks(): Promise<GieTrackedTask[]> {
  const { data, error } = await supabase
    .from('gie_task_tracking')
    .select(`
      id, assignee_employee_id, assignee_phone, due_at, task_points,
      reminder_count, last_reminder_at, next_reminder_at,
      is_completed, completed_at, penalty_applied, penalty_points, created_at,
      draft:gie_draft_tasks(group_id, group:gie_groups(name)),
      task:del_tasks!inner(
        id, title, description, role_group, status, task_date, due_time,
        custom_points, on_behalf_of, submitted_at, created_at, assigned_to
      )
    `)
    .order('created_at', { ascending: false })
  if (error) throw error
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...r.task,
    group_id: r.draft?.group_id ?? null,
    group_name: r.draft?.group?.name ?? null,
    tracking: {
      id: r.id,
      assignee_employee_id: r.assignee_employee_id,
      assignee_phone: r.assignee_phone,
      due_at: r.due_at,
      task_points: r.task_points,
      reminder_count: r.reminder_count,
      last_reminder_at: r.last_reminder_at,
      next_reminder_at: r.next_reminder_at,
      is_completed: r.is_completed,
      completed_at: r.completed_at,
      penalty_applied: r.penalty_applied,
      penalty_points: r.penalty_points,
    },
  })) as GieTrackedTask[]
}

// ── Hooks (60s polling keeps the page fresh even before gie_pulse exists) ──────

export function useGieGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: fetchGieGroups,
    staleTime: 30_000,
    refetchInterval: 120_000,
  })
}

const OVERVIEW_KEY = ['gie_groups_overview'] as const

export async function fetchGieGroupsOverview(): Promise<GieGroupOverview[]> {
  const { data, error } = await supabase.rpc('gie_groups_overview')
  if (error) throw error
  return (data ?? []) as GieGroupOverview[]
}

/** Enriched group list (attention badges + new-message cue). Founder/admin/del_super only. */
export function useGieGroupsOverview() {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: fetchGieGroupsOverview,
    staleTime: 20_000,
    refetchInterval: 60_000,
  })
}

export function useGroupSummaries(groupId: string | null | undefined) {
  return useQuery({
    queryKey: SUMMARIES_KEY(groupId),
    queryFn: () => fetchGroupSummaries(groupId!),
    enabled: !!groupId,
    staleTime: 10_000,
    refetchInterval: 60_000,
  })
}

export function useFlaggedItems(groupId?: string | null) {
  return useQuery({
    queryKey: ['gie_flags', groupId],
    queryFn: () => fetchFlaggedItems(groupId),
    enabled: !!groupId,
    staleTime: 10_000,
    refetchInterval: 60_000,
  })
}

export function useDraftTasks(groupId?: string | null) {
  return useQuery({
    queryKey: ['gie_drafts', groupId],
    queryFn: () => fetchDraftTasks(groupId),
    enabled: !!groupId,
    staleTime: 10_000,
    refetchInterval: 60_000,
  })
}

/** Dispatched tasks (Active / Completed / Overdue tabs). Not group-scoped at the
 *  query level — the operator filters by group client-side via group_id. */
export function useTrackedTasks() {
  return useQuery({
    queryKey: TRACKING_KEY,
    queryFn: fetchTrackedTasks,
    staleTime: 10_000,
    refetchInterval: 60_000,
  })
}

/** Trigger the summariser on demand for one group (Refresh button). Runs under the
 *  logged-in del_super/founder/admin session — the function accepts their JWT. */
export async function triggerSummarise(groupId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('gie-summarise', { body: { group_id: groupId } })
  if (error) throw new Error(error.message)
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error)
}

// ── Group management (founder/admin/del_super — server-enforced) ───────────────

/** Activate / deactivate a group. Deactivate = "remove" from the Command Center
 *  (stops capture, keeps history, reversible). */
export async function setGroupActive(providerGroupId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('gie_set_group_active', {
    p_provider_group_id: providerGroupId, p_active: active,
  })
  if (error) throw error
}

/** Add a group (or re-activate a removed one). */
export async function addGroup(providerGroupId: string, name: string | null): Promise<void> {
  const { error } = await supabase.rpc('gie_add_group', {
    p_provider_group_id: providerGroupId, p_name: name ?? '',
  })
  if (error) throw error
}

/** Live WhatsApp group list from Maytapi (via the admin edge function) — powers
 *  the "add group" picker with an `onboarded` flag on each. */
export async function fetchMaytapiGroups(): Promise<MaytapiGroup[]> {
  const { data, error } = await supabase.functions.invoke('maytapi-list-groups', { body: {} })
  if (error) throw new Error(error.message)
  const d = data as { groups?: MaytapiGroup[]; error?: string }
  if (d?.error) throw new Error(d.error)
  return d?.groups ?? []
}

/**
 * Single centralised realtime subscription — call ONCE on the Command Center.
 * Clone of useDelegationPulse(): one channel on the gie_pulse table that the
 * summary backend bumps after every write, invalidating all GIE queries.
 */
export function useGiePulse() {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase
      .channel('gie_pulse_invalidator')
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'gie_pulse' },
          () => {
            qc.invalidateQueries({ queryKey: GROUPS_KEY })
            qc.invalidateQueries({ queryKey: OVERVIEW_KEY })
            qc.invalidateQueries({ queryKey: ['gie_summaries'] })
            qc.invalidateQueries({ queryKey: FLAGS_KEY })
            qc.invalidateQueries({ queryKey: DRAFTS_KEY })
            qc.invalidateQueries({ queryKey: TRACKING_KEY })
          })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/** Mark a leadership flag as actioned. actionedByEmployeeId = employees.id (Hub PK). */
export async function actionFlag(flagId: string, actionedByEmployeeId: string): Promise<void> {
  const { error } = await supabase
    .from('gie_flagged_items')
    .update({ status: 'actioned', actioned_by: actionedByEmployeeId })
    .eq('id', flagId)
  if (error) throw error
}

export async function dismissFlag(flagId: string): Promise<void> {
  const { error } = await supabase
    .from('gie_flagged_items')
    .update({ status: 'dismissed' })
    .eq('id', flagId)
  if (error) throw error
}

export async function rejectDraft(draftId: string): Promise<void> {
  const { error } = await supabase
    .from('gie_draft_tasks')
    .update({ status: 'rejected' })
    .eq('id', draftId)
  if (error) throw error
}

/** Mark a draft approved once it's been dispatched via the shared delegation form. */
export async function approveDraft(draftId: string): Promise<void> {
  const { error } = await supabase
    .from('gie_draft_tasks')
    .update({ status: 'approved' })
    .eq('id', draftId)
  if (error) throw error
}

/**
 * Delete a DISPATCHED task from the operator's view: cancel the underlying
 * del_tasks row and stop its reminder/penalty tracker. The tracker is halted
 * FIRST (is_completed + next_reminder_at=null) so a cancelled task can never be
 * reminded/penalised even if the task update lags. The row then disappears from
 * the Active/Overdue tabs (the table filters out cancelled tasks).
 */
export async function cancelTrackedTask(delTaskId: string, trackingId: string | null): Promise<void> {
  if (trackingId) {
    await supabase
      .from('gie_task_tracking')
      .update({ is_completed: true, next_reminder_at: null })
      .eq('id', trackingId)
  }
  const { error } = await supabase
    .from('del_tasks')
    .update({ status: 'cancelled', reject_reason: 'Cancelled from Command Center', updated_at: new Date().toISOString() })
    .eq('id', delTaskId)
  if (error) throw error
}

/** Inline-edit a still-pending draft from the operator table (assignee / details /
 *  due / points). RLS (gie_drafts_update → is_del_super) gates this. */
export interface DraftPatch {
  title?: string
  description?: string | null
  suggested_assignee_employee_id?: string | null
  role_group?: string | null
  task_date?: string | null
  due_time?: string | null
  due_at?: string | null
  custom_points?: number | null
  needs_info?: boolean
}
export async function updateDraft(draftId: string, patch: DraftPatch): Promise<void> {
  const { error } = await supabase
    .from('gie_draft_tasks')
    .update(patch)
    .eq('id', draftId)
    .eq('status', 'pending')
  if (error) throw error
}

export interface DispatchDraftArgs {
  draft: GieDraftTask
  assignedToAuthUid: string   // resolved auth.users.id of the assignee
  assignedByAuthUid: string   // logged-in manager (== auth.uid()); required by del_tasks RLS
  roleGroup: string           // NOT NULL on del_tasks
  projectId: string | null
  taskDate: string            // 'YYYY-MM-DD'
  dueTime: string | null      // 'HH:MM'
  customPoints: number | null
  onBehalfOf: string | null   // 'Dhruv Sir' | 'Bhaskar Sir' | null
  // ── reminder/penalty tracking (v2) ──
  assigneeEmployeeId: string | null  // employees.id of the assignee
  assigneePhone: string | null       // for the 1:1 reminder pings
  dueAt: string | null               // timestamptz; R1 fires here (null = no reminders)
}

/**
 * Dispatch a draft as a real del_tasks row by REUSING createTask() — which also
 * best-effort fires del-notify-assign (WhatsApp) because assigned_to !== assigned_by.
 * Then records a gie_task_tracking row (reminder/penalty engine) and flips the draft
 * to 'approved'. Writes are not atomic: if the task is created but a follow-up write
 * fails we return flipped=false (do NOT roll the task back — that would double-notify).
 */
export async function dispatchDraft(args: DispatchDraftArgs): Promise<{ taskId: string; flipped: boolean }> {
  if (args.draft.status !== 'pending' || args.draft.approved_task_id) {
    throw new Error('This draft was already dispatched.')
  }

  const taskId = await createTask({
    title:         args.draft.title,
    description:   args.draft.description ?? '',
    type_code:     args.draft.type_code ?? '',
    task_date:     args.taskDate,
    role_group:    args.roleGroup,            // never empty — defaulted by the row
    assigned_to:   args.assignedToAuthUid,
    assigned_by:   args.assignedByAuthUid,    // === auth.uid()
    project_id:    args.projectId,
    custom_points: args.customPoints,
    on_behalf_of:  args.onBehalfOf,
    due_time:      args.dueTime,
  })

  // Reminder/penalty tracker. R1 is anchored at due_at; a null due means no reminders
  // until one is set. Best-effort — a tracking failure must not block the dispatch.
  await supabase.from('gie_task_tracking').insert({
    del_task_id:          taskId,
    draft_id:             args.draft.id,
    assignee_employee_id: args.assigneeEmployeeId,
    assignee_phone:       args.assigneePhone,
    due_at:               args.dueAt,
    task_points:          args.customPoints,
    next_reminder_at:     args.dueAt,         // R1 at due (cadence in the engine)
  })

  // Only flip a still-pending draft (extra idempotency latch against double-send).
  const { error } = await supabase
    .from('gie_draft_tasks')
    .update({ status: 'approved', approved_task_id: taskId })
    .eq('id', args.draft.id)
    .eq('status', 'pending')

  return { taskId, flipped: !error }
}

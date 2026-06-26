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
}

// ── Query keys ────────────────────────────────────────────────────────────────

const GROUPS_KEY = ['gie_groups'] as const
const SUMMARIES_KEY = (groupId: string | null | undefined) => ['gie_summaries', groupId] as const
const FLAGS_KEY = ['gie_flags'] as const
const DRAFTS_KEY = ['gie_drafts'] as const

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

// ── Hooks (60s polling keeps the page fresh even before gie_pulse exists) ──────

export function useGieGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: fetchGieGroups,
    staleTime: 30_000,
    refetchInterval: 120_000,
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

/** Trigger the summariser on demand for one group (Refresh button). Runs under the
 *  logged-in del_super/founder/admin session — the function accepts their JWT. */
export async function triggerSummarise(groupId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('gie-summarise', { body: { group_id: groupId } })
  if (error) throw new Error(error.message)
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error)
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
            qc.invalidateQueries({ queryKey: ['gie_summaries'] })
            qc.invalidateQueries({ queryKey: FLAGS_KEY })
            qc.invalidateQueries({ queryKey: DRAFTS_KEY })
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
}

/**
 * Dispatch a draft as a real del_tasks row by REUSING createTask() — which also
 * best-effort fires del-notify-assign (WhatsApp) because assigned_to !== assigned_by.
 * Then flips the draft to 'approved'. The two writes are not atomic: if the task is
 * created but the flip fails, we return flipped=false (do NOT roll the task back).
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
    role_group:    args.roleGroup,            // never empty — defaulted by the card
    assigned_to:   args.assignedToAuthUid,
    assigned_by:   args.assignedByAuthUid,    // === auth.uid()
    project_id:    args.projectId,
    custom_points: args.customPoints,
    on_behalf_of:  args.onBehalfOf,
    due_time:      args.dueTime,
  })

  // Only flip a still-pending draft (extra idempotency latch against double-send).
  const { error } = await supabase
    .from('gie_draft_tasks')
    .update({ status: 'approved', approved_task_id: taskId })
    .eq('id', args.draft.id)
    .eq('status', 'pending')

  return { taskId, flipped: !error }
}

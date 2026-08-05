import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from './supabase'
import type { DelPoint } from '../types/delegation'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DelegationPeriod = 'week' | 'month' | 'all'

export interface DelegationScoreRow {
  user_id:         string
  user_name:       string
  role_group:      string
  verified_points: number
  pending_points:  number
  streak_points:   number
  total:           number
  rank:            number
}

export interface PeriodWinner {
  rank:     number
  user_id:  string
  name:     string
  points:   number
}

export interface WinnerSnapshot {
  id:          string
  period_type: 'week' | 'month'
  role_group:  string
  start_date:  string
  end_date:    string
  winners:     PeriodWinner[]
  finalized:   boolean
  finalized_at: string | null
}

export interface OrgFeedRow extends DelPoint {
  user_name: string | null
}

// ── Raw queries ───────────────────────────────────────────────────────────────

export async function fetchDelegationScores(
  period: DelegationPeriod,
): Promise<DelegationScoreRow[]> {
  const { data, error } = await supabase.rpc('get_delegation_scores', { p_period: period })
  if (error) throw error
  return (data ?? []) as DelegationScoreRow[]
}

export async function fetchMyRecentPoints(
  authUserId: string,
  limit = 30,
): Promise<DelPoint[]> {
  // Join del_tasks.title so cards can show the real, short task title
  // (never parse it out of the AI summary string).
  const { data, error } = await supabase
    .from('del_points')
    .select('*, del_tasks(title)')
    .eq('user_id', authUserId)
    .eq('is_archived', false)
    .order('awarded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row: DelPoint & { del_tasks?: { title: string } | null }) => ({
    ...row,
    task_title: row.del_tasks?.title ?? null,
  })) as DelPoint[]
}

export async function fetchMyDelegationTotal(authUserId: string): Promise<number> {
  const { data, error } = await supabase
    .from('del_points')
    .select('points')
    .eq('user_id', authUserId)
    .eq('status', 'verified')
    .eq('source_type', 'delegation')
    .eq('is_archived', false)
  if (error) throw error
  return (data ?? []).reduce((s: number, r: { points: number }) => s + r.points, 0)
}

export async function fetchOrgFeed(limit = 40): Promise<OrgFeedRow[]> {
  const { data: pts, error } = await supabase
    .from('del_points')
    .select('*')
    .eq('is_archived', false)
    .order('awarded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  if (!pts || pts.length === 0) return []

  const userIds = [...new Set((pts as DelPoint[]).map((p) => p.user_id))]
  const { data: emps } = await supabase
    .from('employees')
    .select('auth_user_id, name')
    .in('auth_user_id', userIds)

  const nameMap = new Map((emps ?? []).map((e: { auth_user_id: string; name: string }) => [e.auth_user_id, e.name]))
  return (pts as DelPoint[]).map((p) => ({ ...p, user_name: nameMap.get(p.user_id) ?? null }))
}

export async function fetchPendingCountsByRole(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('del_tasks')
    .select('role_group')
    .eq('status', 'submitted')
    .eq('is_archived', false)
  if (error) throw error
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.role_group] = (counts[row.role_group] ?? 0) + 1
  }
  return counts
}

export async function fetchLatestWinners(): Promise<WinnerSnapshot[]> {
  const { data, error } = await supabase
    .from('del_period_winners')
    .select('*')
    .eq('finalized', true)
    .order('end_date', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data ?? []) as WinnerSnapshot[]
}

// points_seen: upsert last-seen total for a source
export async function upsertPointsSeen(
  userId: string,
  source: 'delegation' | 'cps' | 'finance',
  lastTotal: number,
): Promise<void> {
  await supabase.from('points_seen').upsert(
    { user_id: userId, source, last_total: lastTotal, seen_at: new Date().toISOString() },
    { onConflict: 'user_id,source' },
  )
}

export async function fetchPointsSeen(
  userId: string,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('points_seen')
    .select('source, last_total')
    .eq('user_id', userId)
  const m = new Map<string, number>()
  for (const r of data ?? []) m.set(r.source, r.last_total)
  return m
}

// ── React Query hooks ─────────────────────────────────────────────────────────

const SCORES_KEY  = (period: DelegationPeriod) => ['del_scores', period] as const
const FEED_KEY    = ['del_org_feed'] as const
const PENDING_KEY = ['del_pending_counts'] as const
const WINNERS_KEY = ['del_winners'] as const

/**
 * Single centralised pulse subscription — call this ONCE per page that uses
 * delegation hooks (GamificationSection, DelegationFounderSection).
 * Each individual hook no longer creates its own channel, avoiding the
 * "cannot add postgres_changes callbacks after subscribe()" error that occurs
 * when multiple hook instances subscribe to the same channel name.
 */
export function useDelegationPulse() {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase
      .channel('del_pulse_invalidator')
      .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'gamification_pulse' },
          () => {
            qc.invalidateQueries({ queryKey: ['del_scores'] })
            qc.invalidateQueries({ queryKey: FEED_KEY })
            qc.invalidateQueries({ queryKey: PENDING_KEY })
            qc.invalidateQueries({ queryKey: ['del_my_pts'] })
          })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [qc])
}

/** Per-role leaderboard scores. Realtime driven by useDelegationPulse(). */
export function useDelegationScores(period: DelegationPeriod) {
  return useQuery({
    queryKey: SCORES_KEY(period),
    queryFn:  () => fetchDelegationScores(period),
    staleTime: 5_000,
    refetchInterval: 60_000,
  })
}

// Company-wide INDIVIDUAL leaderboard (no department partition) — admin/founder view.
export async function fetchIndividualLeaderboard(period: DelegationPeriod): Promise<DelegationScoreRow[]> {
  const { data, error } = await supabase.rpc('get_delegation_leaderboard', { p_period: period })
  if (error) throw error
  return (data ?? []) as DelegationScoreRow[]
}

export function useIndividualLeaderboard(period: DelegationPeriod) {
  return useQuery({
    queryKey: ['del_individual_lb', period],
    queryFn:  () => fetchIndividualLeaderboard(period),
    staleTime: 5_000,
    refetchInterval: 60_000,
  })
}

export function useMyRecentPoints(authUserId: string | undefined, limit = 30) {
  return useQuery({
    queryKey: ['del_my_pts', authUserId, limit],
    queryFn:  () => fetchMyRecentPoints(authUserId!, limit),
    enabled:  !!authUserId,
    staleTime: 5_000,
    refetchInterval: 60_000,
  })
}

export function useOrgDelegationFeed() {
  return useQuery({
    queryKey: FEED_KEY,
    queryFn:  () => fetchOrgFeed(40),
    staleTime: 5_000,
    refetchInterval: 60_000,
  })
}

export function usePendingCounts() {
  return useQuery({
    queryKey: PENDING_KEY,
    queryFn:  fetchPendingCountsByRole,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function useLatestWinners() {
  return useQuery({
    queryKey: WINNERS_KEY,
    queryFn:  fetchLatestWinners,
    staleTime: 60_000,
    refetchInterval: 300_000,
  })
}

// ── Points-seen: "since last visit" notifications ─────────────────────────────

/**
 * On mount, compares the current delegation total to the last-seen total.
 * Shows a toast if it increased, then updates points_seen.
 * CPS/Finance use the same pattern: compare gamification totals.
 */
export function usePointsSeenNotification(
  authUserId: string | undefined,
  delegationTotal: number | null,
  cpsTotal: number | null,
  financeTotal: number | null,
  mostRecentReason: string | null,
) {
  useEffect(() => {
    if (!authUserId) return
    let cancelled = false

    async function check() {
      const seen = await fetchPointsSeen(authUserId!)
      const updates: Promise<void>[] = []

      function notify(
        source: 'delegation' | 'cps' | 'finance',
        current: number | null,
        badge: string,
        reason: string | null,
      ) {
        if (current === null) return
        const last = seen.get(source) ?? 0
        if (current > last) {
          const delta = current - last
          toast.success(
            `+${delta} pts · ${badge}${reason ? ` — ${reason.slice(0, 60)}` : ''}`,
            { duration: 5000 },
          )
          if (!cancelled) {
            updates.push(upsertPointsSeen(authUserId!, source, current))
          }
        } else if (!seen.has(source) && current > 0) {
          // First visit — just record, no toast
          if (!cancelled) updates.push(upsertPointsSeen(authUserId!, source, current))
        }
      }

      notify('delegation', delegationTotal, 'Delegation', mostRecentReason)
      notify('cps',        cpsTotal,        'CPS',        null)
      notify('finance',    financeTotal,     'Finance',    null)

      await Promise.all(updates)
    }

    check()
    return () => { cancelled = true }
  // Run only once when all totals are first available (not null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, delegationTotal !== null, cpsTotal !== null, financeTotal !== null])
}

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { RoleId } from '../types'

/**
 * Unified Hub gamification client.
 *
 * Scoring runs server-side in the Postgres function `public.get_hub_gamification()`
 * (SECURITY DEFINER) — see migration `hub_gamification_v1`. The browser cannot compute
 * leaderboards directly because RLS on `finance.imprest_requests`, `finance.employees`
 * and the `cps.*` tables only exposes the caller's own rows. The RPC returns nothing
 * sensitive — only names, points and counts.
 *
 * Implements SPEC-HUB-GAMIFICATION.md (groups, rules S1/S2/P1/F1/F2, UI specs §8/§9).
 */

/** Tunable point constants — display mirror of the SQL function constants (SPEC §3). */
export const POINTS = {
  STOCK_DAILY: 10, // per project per day
  QUOTE_WIN: 10, // per winning PO
  PROC_FULL: 10, // PR dispatched ≤ grace days
  PROC_HALF: 5, // PR dispatched ≤ late cutoff
  PROC_GRACE_DAYS: 3,
  PROC_LATE_CUTOFF_DAYS: 7,
  IMPREST_ONTIME: 5, // imprest filed within submit window
  IMPREST_SUBMIT_DAYS: 3,
  FINANCE_PROCESS: 5, // imprest processed within window
  FINANCE_PROCESS_DAYS: 3,
} as const

export type GamificationGroup = 'site_engineer' | 'procurement' | 'finance' | 'management'

/** One person's score breakdown (matches the RPC row shape). */
export interface ScoreBreakdown {
  userId: string
  userName: string
  total: number

  // CPS — site engineer
  stockPoints: number
  stockDays: number
  quotePoints: number
  quoteWins: number

  // CPS — procurement
  procurementPoints: number
  procOnTime: number
  procLate: number
  procMissed: number

  // Finance — site engineer
  imprestPoints: number
  imprestOnTime: number

  // Finance — finance team
  financeProcessPoints: number
  financeOnTime: number
}

export interface LeaderboardRow extends ScoreBreakdown {
  rank: number
}

export interface MyScore extends ScoreBreakdown {
  group: GamificationGroup
  rank: number
  groupSize: number
}

export interface Leaderboard {
  key: 'site_engineer' | 'procurement' | 'finance'
  title: string
  rows: LeaderboardRow[]
}

export interface GamificationPayload {
  group: GamificationGroup | null
  me: MyScore | null
  leaderboards: Leaderboard[]
}

const EMPTY: GamificationPayload = { group: null, me: null, leaderboards: [] }

/** Fetch the current user's unified gamification payload from the server. */
export async function fetchHubGamification(): Promise<GamificationPayload> {
  const { data, error } = await supabase.rpc('get_hub_gamification')
  if (error) throw error
  if (!data) return EMPTY
  const payload = data as GamificationPayload
  return {
    group: payload.group ?? null,
    me: payload.me ?? null,
    leaderboards: payload.leaderboards ?? [],
  }
}

const QUERY_KEY = ['hub_gamification'] as const

/**
 * Live gamification data. Fetches via react-query and re-fetches in real time whenever
 * `public.gamification_pulse` is bumped (statement-level triggers on the scoring source
 * tables — see migration `hub_gamification_realtime_v1`). A 60s interval is kept as a
 * safety net in case the realtime channel drops.
 */
export function useGamification() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchHubGamification,
    refetchInterval: 60_000,
    staleTime: 5_000,
  })

  useEffect(() => {
    const channel = supabase
      .channel('gamification_pulse')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'gamification_pulse' },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  return query
}

export interface TeamSummary {
  key: Leaderboard['key']
  title: string
  totalPoints: number
  memberCount: number
  topName: string | null
  topPoints: number
}

/**
 * Derive per-board team standings (combined points, top performer) for the view-only
 * management hero. Pure client-side — no extra server round-trip.
 */
export function deriveTeamSummary(leaderboards: Leaderboard[]): TeamSummary[] {
  return leaderboards.map((b) => {
    const top = b.rows.find((r) => r.rank === 1) ?? b.rows[0] ?? null
    return {
      key: b.key,
      title: b.title,
      totalPoints: b.rows.reduce((sum, r) => sum + r.total, 0),
      memberCount: b.rows.length,
      topName: top?.userName ?? null,
      topPoints: top?.total ?? 0,
    }
  })
}

/**
 * Where the gamification section renders on the dashboard, per SPEC §7.
 * Site engineers see it at the bottom (below modules); procurement / finance /
 * management see it at the top. Other roles get no gamification.
 */
export function getPlacement(role: RoleId | null | undefined): 'top' | 'bottom' | 'none' {
  if (!role) return 'none'
  // site_engineer sees gamification below the module grid (their modules are the focus)
  if (role === 'site_engineer') return 'bottom'
  // Everyone else sees it above the module grid
  return 'top'
}

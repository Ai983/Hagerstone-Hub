import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

// Unified "Work Score" = Task (delegation) + Operational (auto CPS/Finance) + Coordinator (del_super).
// Backed by public.get_work_scores() / get_employee_scorecard(); point values come from
// public.points_config (single source of truth). See project-delegation-points-system memory.

export type WorkPeriod = 'week' | 'month' | 'all'

export interface WorkScoreRow {
  user_id: string
  name: string
  department: string
  designation: string | null
  is_del_super: boolean
  task_points: number
  ops_points: number
  coord_points: number
  total: number
  rank_in_dept: number
}

export interface RecentTask {
  title: string
  status: string
  task_date: string | null
  completed_on_time: boolean | null
  points: number | null
  point_status: string | null
}

export interface EmployeeScorecard {
  user: {
    id: string; name: string; department: string; designation: string | null
    is_del_super: boolean; staff_type: string | null; period: WorkPeriod
    task_points: number; ops_points: number; coord_points: number
    total: number; rank_in_dept: number | null
  }
  tasks: { completed: number; in_progress: number; recent: RecentTask[] }
  operations: {
    stock_days: number; quote_wins: number; imprest_ontime: number
    proc_on_time: number; proc_late: number; fin_processed_ontime: number
  }
  imprest: {
    raised_count: number; raised_amount: number; approved_amount: number
    collected_amount: number; paid_count: number; pending_count: number
  }
  coordinator: { assigned_completed: number; verify_fast: number; verify_ok: number } | null
  error?: string
}

// Friendly department labels
export const DEPT_LABELS: Record<string, string> = {
  site_engineer: 'Site Engineers', procurement: 'Procurement', finance: 'Finance',
  mis: 'MIS', design: 'Design', sales: 'Sales', crm: 'CRM', hr: 'HR',
  ea: 'Executive Assistant', ai: 'AI / IT', admin: 'Admin', management: 'Management',
  founder: 'Founder', project_manager: 'Project Managers',
}
export const deptLabel = (d: string) => DEPT_LABELS[d] ?? d

// Date for the *previous* period — used to compute "most improved".
function previousPeriodAsOf(period: WorkPeriod): string | null {
  const d = new Date()
  if (period === 'week') { d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
  if (period === 'month') { d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10) }
  return null // 'all' has no previous period
}

async function fetchWorkScores(period: WorkPeriod, asOf?: string | null): Promise<WorkScoreRow[]> {
  const params: Record<string, unknown> = { p_period: period }
  if (asOf) params.p_as_of = asOf
  const { data, error } = await supabase.rpc('get_work_scores', params)
  if (error) throw error
  return (data ?? []) as WorkScoreRow[]
}

export function useWorkScores(period: WorkPeriod) {
  return useQuery({
    queryKey: ['work_scores', period],
    queryFn: () => fetchWorkScores(period),
    staleTime: 10_000,
    refetchInterval: 60_000,
  })
}

/** Same scores but as of the previous period — to diff for "most improved". */
export function useWorkScoresPrev(period: WorkPeriod) {
  const asOf = previousPeriodAsOf(period)
  return useQuery({
    queryKey: ['work_scores_prev', period, asOf],
    queryFn: () => fetchWorkScores(period, asOf),
    enabled: !!asOf,
    staleTime: 60_000,
  })
}

async function fetchEmployeeScorecard(userId: string, period: WorkPeriod): Promise<EmployeeScorecard> {
  const { data, error } = await supabase.rpc('get_employee_scorecard', { p_user_id: userId, p_period: period })
  if (error) throw error
  return data as EmployeeScorecard
}

export function useEmployeeScorecard(userId: string | undefined, period: WorkPeriod) {
  return useQuery({
    queryKey: ['employee_scorecard', userId, period],
    queryFn: () => fetchEmployeeScorecard(userId!, period),
    enabled: !!userId,
    staleTime: 10_000,
  })
}

export const fmtINR = (n: number) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
export const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')

// ── Live point values (single source of truth = public.points_config) ────────
// get_points_config() returns a flat { key: number } object. UI hints (Verify,
// Mera Din) read this so the numbers shown always match what the server awards.
export type PointsConfig = Record<string, number>

async function fetchPointsConfig(): Promise<PointsConfig> {
  const { data, error } = await supabase.rpc('get_points_config')
  if (error) throw error
  return (data ?? {}) as PointsConfig
}

export function usePointsConfig() {
  return useQuery({
    queryKey: ['points_config'],
    queryFn: fetchPointsConfig,
    staleTime: 300_000, // values change rarely; cache 5 min
  })
}

// Seed values used while the config loads or if the read fails — kept in sync
// with the points_config 'delegation' rows.
const TIER_SEED: Record<string, number> = { S: 5, M: 10, L: 20, XL: 40 }

/** Build the {S,M,L,XL} tier-points map from live config, falling back to seeds. */
export function tierPointsFrom(cfg: PointsConfig | undefined): Record<string, number> {
  return {
    S:  cfg?.tier_S  ?? TIER_SEED.S,
    M:  cfg?.tier_M  ?? TIER_SEED.M,
    L:  cfg?.tier_L  ?? TIER_SEED.L,
    XL: cfg?.tier_XL ?? TIER_SEED.XL,
  }
}

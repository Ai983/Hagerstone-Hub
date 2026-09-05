export type Period = 'week' | 'month' | 'quarter' | 'ytd' | 'all'

export interface FilterState {
  period: Period
  site: string | null
  employeeId: string | null
  roleGroup: string | null
}

export interface HeadlineKpi {
  total_spend: number
  prev_spend: number
  committed_po_value: number
  imprest_outstanding: number
  payments_due_7d: number
  payments_due_30d: number
  payments_overdue: number
  pending_approvals: number
  active_employees: number
  imprest_blocked_count: number
}

export interface FinanceSummary {
  spend_trend: Array<{ bucket: string; amount: number }>
  spend_by_category: Array<{ category: string; amount: number }>
  spend_by_site: Array<{ site: string; amount: number }>
  expense_status_mix: Array<{ status: string; count: number }>
  imprest: {
    total_requested: number
    total_approved: number
    total_paid: number
    outstanding: number
    pending_count: number
    blocked_count: number
  }
  approval_avg_days: number | null
  vendor_payments: {
    due_amount: number
    overdue_amount: number
    paid_amount: number
    due_soon_7d: number
  }
  top_spenders: Array<{ name: string; amount: number }>
  top_sites: Array<{ site: string; amount: number }>
}

export interface CpsSummary {
  pr_pipeline: Array<{ status: string; count: number }>
  pr_to_po_avg_days: number | null
  open_pos: { count: number; total_value: number }
  pending_finance_dispatch: number
  rfq_status: Array<{ status: string; count: number }>
  quote_stats: { total: number; reviewed: number; pending: number }
  stock_stale_count: number
  stale_stock_projects: Array<{ project: string; last_movement: string; hours_stale: number }>
  vendor_stats: { active_count: number; new_this_period: number }
  top_vendors: Array<{ name: string; amount: number }>
  committed_by_project: Array<{ project: string; amount: number }>
}

export interface ProjectCostRow {
  display_name: string
  finance_site: string | null
  cps_project_code: string | null
  finance_actual: number
  cps_committed: number
  grand_total: number
}

// ── Imprest & Finance Ageing report (live version of the static HTML report) ──
export type AgeBand = '0-7' | '8-15' | '16-30' | '31-60' | '60+'

export interface ImprestAgeingStage {
  stage_key: string
  label: string
  owner: string
  count: number
  value: number
  oldest: number
  avg: number
  bands: Record<AgeBand, number>
}

export interface ImprestAgeingItem {
  ref: string
  stage_key: string
  site: string | null
  requester: string
  owner: string
  category: string | null
  amount: number
  net_payable: number | null
  submitted_at: string
  age_days: number
  days_at_stage: number
  band: AgeBand
  flag: 'paid_not_closed' | 'rejected_in_pipeline' | null
}

export interface ConcentrationRow {
  name: string
  items: number
  gt30: number
  gross: number
  oldest: number
}

export interface PoPaymentRow {
  ref: string
  supplier: string | null
  project: string | null
  status: 'pending_payment' | 'partially_paid'
  po_value: number
  paid: number | null
  outstanding: number
  ingested: string
  age_days: number
  is_test: boolean
}

export interface ImprestAgeing {
  as_of: string
  kpis: {
    stuck_count: number
    flagged_count: number
    gross_value: number
    approved_awaiting_payout: number
    oldest_days: number
    oldest_ref: string | null
    oldest_site: string | null
    breach_gt7: number
    breach_gt30: number
    breach_gt60: number
    bottleneck_stage: string | null
    bottleneck_count: number
  }
  pipeline: ImprestAgeingStage[]
  items: ImprestAgeingItem[]
  concentration_site: ConcentrationRow[]
  concentration_category: ConcentrationRow[]
  po_payments: PoPaymentRow[]
  integrity: {
    paid_not_closed: string[]
    rejected_in_pipeline: string[]
    zero_net_count: number
  }
}

// ── CPS PR Ageing report — "which procurement head is a PR stuck with, and for how long" ──
export interface CpsPrAgeingGroup {
  owner?: string
  stage_key?: string
  label?: string
  /** by_stage only: whether this stage is blocked on the head rather than on suppliers. */
  needs_you?: boolean
  /** by_owner only: how many of this owner's PRs are blocked on them. */
  needs_them?: number
  count: number
  oldest: number
  avg: number
  bands: Record<AgeBand, number>
}

export interface CpsPrAgeingItem {
  ref: string
  project: string | null
  site: string | null
  status: string
  stage_key: string
  /** Real blocking stage — an RFQ can exist in 'draft' and never have been sent. */
  stage_label: string
  /** true = blocked on the procurement head; false = genuinely waiting on suppliers. */
  needs_you: boolean
  rfq_number: string | null
  quote_count: number
  priority: string | null
  requester: string | null
  owner: string
  created_at: string
  required_by: string | null
  age_days: number
  band: AgeBand
}

export interface CpsPrAgeing {
  as_of: string
  kpis: {
    stuck_count: number
    oldest_days: number
    oldest_ref: string | null
    oldest_owner: string | null
    breach_gt7: number
    breach_gt15: number
    breach_gt30: number
    top_owner: string | null
    top_owner_count: number
  }
  by_owner: CpsPrAgeingGroup[]
  by_stage: CpsPrAgeingGroup[]
  items: CpsPrAgeingItem[]
}

// ── Delegation Ageing — "which delegated task is late, with whom, how late" ──
// Distinct band scale from the imprest/PR reports: delegation runs on a daily
// clock, not a monthly one, so 15 days late is critical here rather than fresh.
// The clock starts at the DEADLINE (task_date), not creation — a task assigned
// a week out is not late. See public.founder_delegation_ageing().
export type DelAgeBand = 'due' | '1-2' | '3-7' | '8-14' | '15+'

export interface DelAgeingGroup {
  owner?: string
  stage_key?: string
  label?: string
  /** by_stage only: TRUE when the ball is with a verifying head, not the assignee. */
  awaiting_verify?: boolean
  /** by_owner only: how many of this person's open tasks carry Very Urgent. */
  very_urgent?: number
  count: number
  overdue?: number
  oldest: number
  avg: number
  bands: Record<DelAgeBand, number>
}

export interface DelAgeingDelegator {
  delegator: string
  count: number
  overdue: number
  oldest: number
}

export interface DelAgeingItem {
  task_id: string
  ref: string
  owner: string
  delegator: string
  on_behalf_of: string | null
  role_group: string
  project: string | null
  status: string
  stage_key: string
  stage_label: string
  awaiting_verify: boolean
  /** Reverse-mapped from custom_points; null for tasks not created via the sheet. */
  urgency: 'very_urgent' | 'urgent' | 'normal' | null
  task_date: string
  due_time: string | null
  created_at: string
  /** Days past the deadline — 0 means not yet due. Drives every band and KPI. */
  overdue_days: number
  /** Days since creation. Context only. */
  age_days: number
  band: DelAgeBand
}

export interface DelegationAgeing {
  as_of: string
  kpis: {
    open_count: number
    overdue_count: number
    awaiting_verify: number
    very_urgent_late: number
    oldest_days: number
    oldest_ref: string | null
    oldest_owner: string | null
    breach_gt2: number
    breach_gt7: number
    breach_gt14: number
    top_owner: string | null
    top_owner_count: number
  }
  by_owner: DelAgeingGroup[]
  by_stage: DelAgeingGroup[]
  by_delegator: DelAgeingDelegator[]
  items: DelAgeingItem[]
}

export interface DelegationSummary {
  task_summary: {
    total: number
    assigned: number
    submitted: number
    under_review: number
    completed: number
    completion_rate: number | null
  }
  by_person: Array<{
    name: string
    auth_user_id: string
    role: string
    total: number
    completed: number
    submitted: number
    under_review: number
    assigned: number
    completion_pct: number | null
    total_points: number
  }>
  by_team: Array<{
    role_group: string
    total: number
    completed: number
    completion_pct: number | null
    avg_points: number
  }>
  task_trend: Array<{ bucket: string; total: number; completed: number }>
  top_performers: Array<{ name: string; role: string; points: number }>
}

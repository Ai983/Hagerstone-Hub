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

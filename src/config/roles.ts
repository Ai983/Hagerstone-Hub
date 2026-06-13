import type { RoleId, ModuleId } from '../types'

// Single source of truth for role display labels. Previously duplicated in
// EmployeesPage / AddEmployeePage / EditEmployeePage.
export const ROLE_LABELS: Record<RoleId, string> = {
  admin: 'Admin',
  management: 'Management',
  procurement: 'Procurement',
  finance: 'Finance',
  hr: 'HR',
  project_manager: 'Project Manager',
  site_engineer: 'Site Engineer',
  ai: 'AI',
  mis: 'MIS',
  design: 'Design',
  ea: 'Executive Assistant',
  sales: 'Sales',
  crm: 'CRM',
  founder: 'Founder',
}

// Default module access pre-filled per role on the Add / Edit Employee forms.
// Admins can toggle to override. Previously duplicated and drifted between
// AddEmployeePage (no lcs) and EditEmployeePage (with lcs) — reconciled here so
// create and edit pre-fill identically. `marketing` / `scraper` are opt-in only.
export const ROLE_DEFAULT_MODULES: Record<RoleId, ModuleId[]> = {
  admin:           ['attendance', 'cps', 'finance_admin', 'finance_employee', 'hireflow', 'lcs'],
  management:      ['attendance', 'cps', 'finance_admin', 'finance_employee', 'hireflow', 'lcs'],
  procurement:     ['attendance', 'cps', 'finance_employee', 'lcs'],
  finance:         ['attendance', 'finance_admin', 'finance_employee', 'lcs'],
  hr:              ['attendance', 'hireflow'],
  project_manager: ['attendance', 'cps', 'finance_employee', 'lcs'],
  site_engineer:   ['attendance', 'finance_employee', 'lcs'],
  ai:              ['attendance', 'cps', 'finance_admin', 'finance_employee', 'hireflow'],
  mis:             ['attendance', 'cps', 'finance_admin', 'finance_employee', 'hireflow'],
  design:          ['attendance'],
  ea:              ['attendance'],
  sales:           ['attendance'],
  crm:             ['attendance'],
  founder:         ['attendance', 'cps', 'finance_admin', 'finance_employee', 'hireflow'],
}

// All active employees can access delegation — the task types seeded per role
// control what they can actually create. Derived from the role registry so it
// can never drift out of sync (it previously listed phantom roles like
// `facade` / `lcs` / `marketing` while omitting real ones like design/ea/sales/crm).
export const DELEGATION_ROLES: string[] = Object.keys(ROLE_LABELS)

// Operational departments shown in the org-wide founder delegation views (KPI
// strip + per-role leaderboards). Excludes the global founder/admin verifier
// roles, which act across all departments rather than being one.
export const DELEGATION_DEPARTMENTS: RoleId[] = (Object.keys(ROLE_LABELS) as RoleId[])
  .filter((r) => r !== 'founder' && r !== 'admin')

// Short department labels for compact UI (e.g. the My Day create form grouping).
export const ROLE_SHORT_LABELS: Record<RoleId, string> = {
  admin: 'Admin',
  management: 'Mgmt',
  procurement: 'Procure',
  finance: 'Finance',
  hr: 'HR',
  project_manager: 'Projects',
  site_engineer: 'Site Eng',
  ai: 'AI/IT',
  mis: 'MIS',
  design: 'Design',
  ea: 'EA',
  sales: 'Sales',
  crm: 'CRM',
  founder: 'Founder',
}

export type RoleId =
  | 'admin'
  | 'management'
  | 'procurement'
  | 'finance'
  | 'hr'
  | 'project_manager'
  | 'site_engineer'
  | 'ai'
  | 'mis'
  | 'design'
  | 'ea'
  | 'sales'
  | 'crm'
  | 'founder'

export type ModuleId = 'attendance' | 'cps' | 'finance_admin' | 'finance_employee' | 'hireflow' | 'lcs' | 'marketing' | 'scraper'

export interface Role {
  id: RoleId
  label: string
  default_modules: ModuleId[]
}

export interface Employee {
  id: string
  auth_user_id: string | null
  name: string
  email: string
  phone: string | null
  designation: string | null
  department: string | null
  role: RoleId
  employee_code: string | null
  is_active: boolean
  is_head: boolean
  must_change_password: boolean
  onboarded_at: string | null
  created_at: string
}

export interface EmployeeModuleAccess {
  id: string
  employee_id: string
  module_id: ModuleId
  can_access: boolean
}

export interface ModuleConfig {
  id: ModuleId
  name: string
  description: string
  url: string
  color: string
  borderColor: string
  icon: string
}

export interface OnboardingLog {
  id: string
  employee_id: string
  channel: 'whatsapp' | 'email'
  status: 'sent' | 'failed' | 'delivered'
  message_preview: string | null
  sent_at: string
}

export type ProjectCategory = 'project' | 'office_region' | 'other'

export interface Project {
  id: string
  code: string
  name: string
  category: ProjectCategory
  is_active: boolean
  is_cps: boolean
  is_finance: boolean
  site_address: string | null
  site_incharge_name: string | null
  site_contact: string | null
  cps_project_id: string | null
  created_at: string
  updated_at: string
}

export type ProjectAliasSource = 'finance_site' | 'cps_name' | 'cps_code' | 'manual'

export interface ProjectAlias {
  id: string
  project_id: string
  alias: string
  source: ProjectAliasSource
  created_at: string
}

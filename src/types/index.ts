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
  | 'founder'

export type ModuleId = 'attendance' | 'cps' | 'finance_admin' | 'finance_employee' | 'hireflow' | 'lcs'

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

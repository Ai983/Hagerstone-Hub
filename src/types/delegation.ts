export type EffortTier = 'S' | 'M' | 'L' | 'XL'
export type DelTaskStatus = 'assigned' | 'in_progress' | 'submitted' | 'verified' | 'rejected'
export type DelPointStatus = 'pending' | 'verified' | 'rejected' | 'reversed'

export interface DelTaskType {
  id: string
  code: string
  label: string
  role_group: string
  effort_tier: EffortTier
  daily_cap: number | null
  active: boolean
}

export interface DelPoint {
  id: string
  user_id: string
  role_group: string
  points: number
  reason: string
  task_id: string | null
  source_type: 'delegation' | 'streak'
  status: DelPointStatus
  verified_by: string | null
  period_week: string | null
  period_month: string | null
  awarded_at: string
  verified_at: string | null
}

export interface DelTask {
  id: string
  title: string
  description: string | null
  type_code: string | null
  role_group: string
  assigned_to: string   // auth.users.id
  assigned_by: string   // auth.users.id
  task_date: string     // DATE as "YYYY-MM-DD"
  status: DelTaskStatus
  submitted_at: string | null
  completed_on_time: boolean | null
  verified_at: string | null
  verified_by: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string
  del_points?: DelPoint[]
}

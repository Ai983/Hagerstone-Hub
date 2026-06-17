export type EffortTier = 'S' | 'M' | 'L' | 'XL'

export type DelTaskStatus =
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'under_review'
  | 'completed'
  | 'verified'   // legacy — treat same as completed in UI
  | 'rejected'
  | 'cancelled'

export type DelPointStatus = 'pending' | 'verified' | 'rejected' | 'reversed'

export interface DelTaskType {
  id: string
  code: string
  label: string
  role_group: string
  effort_tier: EffortTier
  daily_cap: number | null
  active: boolean
  scored_by: 'agent' | 'external'
}

export interface DelSubmission {
  id: string
  task_id: string
  submitted_by: string
  input_type: 'audio' | 'text'
  raw_text: string | null
  audio_url: string | null
  transcript_status: 'pending' | 'done' | 'failed' | 'n/a'
  attachments: { url: string; type: string; name: string; size: number }[]
  created_at: string
}

export interface AgentMeta {
  confidence: 'high' | 'medium' | 'low'
  flags: string[]
  reasoning: string
  model: string
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
  // V2 AI-scoring fields
  submission_id: string | null
  proposed_points: number | null
  summary: string | null
  agent_meta: AgentMeta | null
  // Joined from del_tasks (set by fetchMyRecentPoints) — never parsed from a string
  task_title?: string | null
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
  due_time: string | null      // display-only deadline time "HH:MM:SS"
  project_id: string | null
  custom_points: number | null // set for "Other" custom tasks
  on_behalf_of: string | null  // director the task is assigned for
  status: DelTaskStatus
  submitted_at: string | null
  completed_on_time: boolean | null
  verified_at: string | null
  verified_by: string | null
  reject_reason: string | null
  created_at: string
  updated_at: string
  del_points?: DelPoint[]
  del_submissions?: DelSubmission[]
}

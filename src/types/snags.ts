// Snag management — post-handover client defect reports.
// Hand-written to match supabase/sql/snags.sql (this project has no generated
// Supabase types; see src/types/index.ts and src/types/delegation.ts).

export type SnagStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type SnagPriority = 'low' | 'medium' | 'high' | 'urgent'

export const SNAG_STATUSES: SnagStatus[] = ['open', 'in_progress', 'resolved', 'closed']
export const SNAG_PRIORITIES: SnagPriority[] = ['low', 'medium', 'high', 'urgent']

export const SNAG_STATUS_LABELS: Record<SnagStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

export const SNAG_PRIORITY_LABELS: Record<SnagPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

/** The forward path through the lifecycle. Saksham advances one step at a time;
 *  a snag can also be closed from any state (e.g. a duplicate or a non-issue). */
export const SNAG_NEXT_STATUS: Record<SnagStatus, SnagStatus | null> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'closed',
  closed: null,
}

/** Same shape uploadAttachment() returns in src/lib/delegation.ts. */
export interface SnagAttachment {
  url: string
  type: string
  name: string
  size: number
}

export interface Snag {
  id: string
  ref: string
  project_id: string
  form_link_id: string | null
  reporter_name: string
  reporter_phone: string | null
  reporter_email: string | null
  category: string | null
  priority: SnagPriority
  title: string
  description: string
  attachments: SnagAttachment[]
  status: SnagStatus
  assigned_to: string | null
  resolution_note: string | null
  closure_attachments: SnagAttachment[]
  source: string
  created_at: string
  updated_at: string
  first_response_at: string | null
  resolved_at: string | null
  closed_at: string | null
  /** Joined from public.projects for display. */
  project?: { name: string; code: string } | null
}

export type SnagEventType = 'created' | 'status_changed' | 'comment' | 'assigned' | 'notified'

export interface SnagEvent {
  id: string
  snag_id: string
  actor_id: string | null
  event_type: SnagEventType
  from_status: SnagStatus | null
  to_status: SnagStatus | null
  note: string | null
  recipient_phone: string | null
  /** For 'notified' rows: the Plumbline gateway's wa_messages.id. Resolve it
   *  through snag_wa_status() — a queued send is not a delivered one. */
  wa_message_id: string | null
  created_at: string
  actor?: { name: string } | null
}

/** wa_messages.status values the gateway writes. */
export type WaStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

export interface SnagFormLink {
  id: string
  project_id: string
  token: string
  label: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  revoked_at: string | null
}

// GIE — Direct Delegation (v3 — Maytapi code inlined, no _shared import)
// Creates a del_tasks row AND sends a WhatsApp group message from Ma'am's number.
// Body: { group_id, title, assignee_employee_id, task_date?, type_code? }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jwtRole(token: string): string | null {
  try {
    const p = token.split('.')[1]
    if (!p) return null
    return (JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).role as string) ?? null
  } catch { return null }
}

// ── Inline Maytapi group-send (avoids _shared import path issues) ──────────
const GRP_PRODUCT_ID = Deno.env.get('MAYTAPI_GRP_PRODUCT_ID') ?? 'f09cb10a-0037-4e1f-8895-ee7a607077b4'
const GRP_PHONE_ID   = Deno.env.get('MAYTAPI_GRP_PHONE_ID')   ?? '145466'
const GRP_API_KEY    = Deno.env.get('MAYTAPI_GRP_API_KEY')    ?? ''

async function sendToGroup(groupJid: string, assigneePhone: string, message: string) {
  // Prefer the self-hosted gateway when configured; else Maytapi (GRP creds).
  const gatewayUrl = Deno.env.get('WA_GATEWAY_URL')
  const gatewayKey = Deno.env.get('WA_GATEWAY_KEY')
  const useGateway = !!gatewayUrl && !!gatewayKey
  const sendKey = useGateway ? gatewayKey! : GRP_API_KEY
  if (!sendKey) {
    console.warn('[direct-delegate] no send key (WA_GATEWAY_KEY or MAYTAPI_GRP_API_KEY) — skipping group WA')
    return false
  }
  const endpoint = useGateway
    ? `${gatewayUrl}/maytapi/${GRP_PRODUCT_ID}/${GRP_PHONE_ID}/sendMessage`
    : `https://api.maytapi.com/api/${GRP_PRODUCT_ID}/${GRP_PHONE_ID}/sendMessage`
  const digits = assigneePhone.replace(/\D/g, '')
  const waId   = digits.startsWith('91') ? digits : `91${digits}`
  try {
    const res = await fetch(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-maytapi-key': sendKey },
        body: JSON.stringify({
          to_number: groupJid,
          type: 'text',
          message,
          mentionedList: [`${waId}@c.us`],
        }),
      },
    )
    const body: unknown = await res.json().catch(() => null)
    const ok = res.ok && !!body && typeof body === 'object' && 'success' in body && body.success === true
    if (!ok) console.warn('[direct-delegate] group WA failed', body)
    return ok
  } catch (e) {
    console.error('[direct-delegate] group WA threw', String(e))
    return false
  }
}
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  // Auth — logged-in del_super / founder / admin user OR service_role (tests)
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  let callerEmployeeId: string | null = null
  let callerAuthId: string | null = null

  if (jwtRole(bearer) !== 'service_role') {
    if (!bearer) return json({ error: 'Unauthorized' }, 401)
    const { data: { user }, error: authErr } = await admin.auth.getUser(bearer)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)
    callerAuthId = user.id
    const { data: emp } = await admin
      .from('employees').select('id, role, del_super')
      .eq('auth_user_id', user.id).eq('is_active', true)
      .is('points_alias_of', null).maybeSingle()
    if (!emp || !(emp.role === 'founder' || emp.role === 'admin' || emp.del_super)) {
      return json({ error: 'Unauthorized — del_super / founder / admin required' }, 403)
    }
    callerEmployeeId = emp.id
  }

  let body: { group_id: string; title: string; assignee_employee_id: string; task_date?: string; type_code?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const { group_id, title, assignee_employee_id, task_date, type_code } = body
  if (!group_id || !title?.trim() || !assignee_employee_id) {
    return json({ error: 'group_id, title, and assignee_employee_id are required' }, 400)
  }

  // 1 — Group
  const { data: grp } = await admin
    .from('gie_groups').select('id, name, provider_group_id')
    .eq('id', group_id).eq('is_active', true).maybeSingle()
  if (!grp) return json({ error: 'Group not found' }, 404)

  // 2 — Assignee
  const { data: assignee } = await admin
    .from('employees').select('id, name, phone, auth_user_id')
    .eq('id', assignee_employee_id).eq('is_active', true).maybeSingle()
  if (!assignee) return json({ error: 'Assignee not found' }, 404)
  if (!assignee.auth_user_id) return json({ error: 'Assignee has no portal account' }, 422)

  // 3 — Resolve caller auth_user_id
  if (callerEmployeeId && !callerAuthId) {
    const { data: caller } = await admin.from('employees').select('auth_user_id').eq('id', callerEmployeeId).maybeSingle()
    callerAuthId = caller?.auth_user_id ?? null
  }
  if (!callerAuthId) callerAuthId = assignee.auth_user_id

  // 4 — Look up role_group from the selected task type (fall back to 'office')
  let roleGroup = 'office'
  if (type_code) {
    const { data: tt } = await admin.from('del_task_types').select('role_group').eq('code', type_code).maybeSingle()
    if (tt?.role_group) roleGroup = tt.role_group
  }

  // 5 — Create del_tasks
  const today = new Date().toISOString().slice(0, 10)
  const { data: task, error: taskErr } = await admin.from('del_tasks').insert({
    title: title.trim(),
    description: `Delegated via Command Center — ${grp.name ?? ''}`,
    type_code: type_code ?? null,
    role_group: roleGroup,
    assigned_to: assignee.auth_user_id,
    assigned_by: callerAuthId,
    task_date: task_date ?? today,
    status: 'assigned',
  }).select('id').single()

  if (taskErr || !task) {
    console.error('[direct-delegate] del_tasks insert failed', taskErr)
    return json({ error: taskErr?.message ?? 'Failed to create task' }, 500)
  }

  // 6 — Personal notify (best-effort)
  // Must pass the user's JWT, not the service_role key — del-notify-assign calls auth.getUser()
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/del-notify-assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
    body: JSON.stringify({ task_id: task.id }),
  }).catch((e: unknown) => console.warn('[direct-delegate] notify-assign failed', String(e)))

  // 7 — Group WhatsApp
  const phone = (assignee.phone ?? '').replace(/\D/g, '')
  const groupMsg = `@${phone.startsWith('91') ? phone : `91${phone}`} — Task assigned: ${title.trim()}`
  const waOk = grp.provider_group_id && phone
    ? await sendToGroup(grp.provider_group_id, phone, groupMsg)
    : false

  // 8 — Synthetic audit row (fire-and-forget)
  if (callerEmployeeId) {
    admin.from('gie_raw_messages').insert({
      group_id,
      provider_msg_id: `direct_${task.id}`,
      sender_employee_id: callerEmployeeId,
      sender_name: 'Portal delegation',
      is_from_leadership: true,
      msg_type: 'text',
      body: groupMsg,
      mentioned_employee_ids: [assignee_employee_id],
      sent_at: new Date().toISOString(),
    }).then(() => {}).catch((e: unknown) => console.warn('[direct-delegate] audit row failed', String(e)))
  }

  return json({ ok: true, task_id: task.id, wa_ok: waOk, group: grp.name, assignee: assignee.name })
})

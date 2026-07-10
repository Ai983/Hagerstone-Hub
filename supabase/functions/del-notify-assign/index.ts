// del-notify-assign — Head/founder/del_super → Employee assignment WhatsApp.
// Called by the client right after a task is created for someone else. Writes a
// del_notifications row (in-app fallback record) and sends the WhatsApp DIRECTLY
// via Maytapi — same proven path as the admin Send Invite/Resend onboarding
// flow (send-onboarding). The row is PATCHed to sent/failed after the send so
// assigned never silently means not notified.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWhatsApp } from '../_shared/maytapi.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Decode a Supabase JWT's `role` claim. No signature check — verify_jwt=true already
 *  validated it at the gateway. */
function jwtRole(token: string): string | null {
  try {
    const p = token.split('.')[1]
    if (!p) return null
    return (JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).role as string) ?? null
  } catch {
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const bearer = authHeader.replace('Bearer ', '').trim()
  // Match the key by value as well as by JWT claim. Supabase's newer secret keys
  // (sb_secret_…) are opaque, not JWTs, so jwtRole() returns null for them and the
  // service branch was skipped — every auto-dispatched task 401'd here and the
  // assignee was never notified, silently.
  const isService = bearer === serviceKey || jwtRole(bearer) === 'service_role'

  // ── 1. Verify caller — a logged-in user, unless this is a machine call ─────
  // gie-summarise auto-dispatches director-@mentioned tasks from a cron with no user
  // session. In that case the sender is whoever del_tasks.assigned_by says it is, so
  // the task row (written under service-role) is the authority. Resolved after load.
  let user: { id: string } | null = null
  if (!isService) {
    const { data: { user: u }, error: authErr } = await supabase.auth.getUser(bearer)
    if (authErr || !u) return json({ error: 'Unauthorized' }, 401)
    user = u
  }

  // ── 2. Parse input ───────────────────────────────────────────────────────
  const { task_id } = await req.json()
  if (!task_id) return json({ error: 'task_id is required' }, 400)

  // ── 3. Load the task ───────────────────────────────────────────────────────
  const { data: task } = await supabase
    .from('del_tasks')
    .select('id, title, type_code, role_group, assigned_to, assigned_by, task_date, status, on_behalf_of, due_time')
    .eq('id', task_id)
    .single()
  if (!task) return json({ error: 'Task not found' }, 404)

  // The person the notification is FROM: the caller, or for machine calls the
  // assigner recorded on the task.
  const senderUid = isService ? task.assigned_by : user!.id
  const { data: caller } = await supabase
    .from('employees')
    .select('name, role, is_head, is_active, del_super, gie_auto_dispatch')
    .eq('auth_user_id', senderUid)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden' }, 403)

  // Only notify head/founder/del_super → other-employee assignments. Directors who can
  // auto-dispatch from WhatsApp count too: Bhaskar is role='management' with is_head
  // false, so without this his @mentioned tasks would be created and never notified.
  const isGlobal = caller.role === 'founder' || caller.role === 'admin' || caller.del_super === true
  const isHead   = caller.is_head === true
  const isDirector = caller.gie_auto_dispatch === true
  if (!isGlobal && !isHead && !isDirector) {
    return json({ skipped: true, reason: 'caller is not a head/founder' })
  }
  if (task.assigned_to === senderUid) {
    return json({ skipped: true, reason: 'self-assigned — no notification' })
  }

  // ── 4. Resolve assignee phone + task type label ───────────────────────────
  const { data: assignee } = await supabase
    .from('employees')
    .select('name, phone')
    .eq('auth_user_id', task.assigned_to)
    .single()

  let typeLabel = task.type_code ?? 'kaam'
  if (task.type_code) {
    const { data: tt } = await supabase
      .from('del_task_types')
      .select('label')
      .eq('code', task.type_code)
      .single()
    if (tt?.label) typeLabel = tt.label
  }

  const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
  const deepLink = `${hubBase}/delegation/my-day`

  // Readable deadline, e.g. 20 Jun 2026 (fall back to raw date on any error)
  let dueLabel = task.task_date
  try {
    dueLabel = new Date(`${task.task_date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch (_e) { /* keep raw YYYY-MM-DD */ }
  const timeStr = task.due_time ? ` ${String(task.due_time).slice(0, 5)}` : ''

  // Assigned on behalf of a director (Ritu assigns for them); fall back to caller.
  const assigner = task.on_behalf_of ?? caller.name

  const message =
    `📋 *Naya Kaam Assign Hua Hai*\n\n` +
    `Namaste ${assignee?.name ?? ''}! Aapko ek naya task ${assigner} ne assign kiya hai:\n\n` +
    `📝 *Kaam:* ${task.title}\n` +
    `🏷️ *Type:* ${typeLabel}\n` +
    `👤 *Assign by:* ${assigner}\n` +
    `⏰ *Last date:* ${dueLabel}${timeStr}\n\n` +
    `Kripya is task ko skillfully aur timely complete karein.\n\n` +
    `Kaam complete karke yahan submit karein 👇\n${deepLink}\n\n` +
    `⚠️ Link ko Chrome ya Safari mein kholein (WhatsApp ke andar nahi).\n\n` +
    `— Admin Hagerstone`

  // ── 5. Write del_notifications row (pending) — in-app fallback record ──────
  const channel = assignee?.phone ? 'whatsapp' : 'in_app'
  const { data: notif } = await supabase
    .from('del_notifications')
    .insert({
      task_id,
      recipient_uid: task.assigned_to,
      channel,
      status: 'pending',
      attempts: 0,
      payload: { message, phone: assignee?.phone ?? null, assignee_name: assignee?.name ?? null },
    })
    .select('id')
    .single()

  // ── 6. Send WhatsApp directly via Maytapi (same path as send-onboarding) ───
  // No phone → the in_app row above is the notification (status stays 'pending').
  let waStatus: 'pending' | 'sent' | 'failed' = 'pending'
  if (assignee?.phone) {
    const r = await sendWhatsApp({ phone: assignee.phone, message })
    waStatus = r.ok ? 'sent' : 'failed'

    if (notif?.id) {
      await supabase
        .from('del_notifications')
        .update({ status: waStatus, attempts: 1, provider_msg_id: r.msgId })
        .eq('id', notif.id)
    }
  }

  return json({
    success: true,
    notification_id: notif?.id,
    channel,
    notified: waStatus === 'sent',
  })
})

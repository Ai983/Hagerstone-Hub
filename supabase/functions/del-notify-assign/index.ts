// del-notify-assign — Head→Employee assignment WhatsApp notification (SPEC §6)
// Called by the client right after a head/founder creates a task for someone else.
// Writes a del_notifications row (pending) + fires the n8n Maytapi webhook.
// n8n sends the WhatsApp and PATCHes the row to sent/failed. On 2 failures the
// in-app inbox row (this row) is the fallback so "assigned" never silently means
// "not notified".

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── 1. Verify caller ───────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error: authErr } =
    await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: caller } = await supabase
    .from('employees')
    .select('name, role, is_head, is_active')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden' }, 403)

  // ── 2. Parse input ───────────────────────────────────────────────────────
  const { task_id } = await req.json()
  if (!task_id) return json({ error: 'task_id is required' }, 400)

  // ── 3. Load the task ───────────────────────────────────────────────────────
  const { data: task } = await supabase
    .from('del_tasks')
    .select('id, title, type_code, role_group, assigned_to, assigned_by, task_date, status')
    .eq('id', task_id)
    .single()
  if (!task) return json({ error: 'Task not found' }, 404)

  // Only notify head/founder → other-employee assignments
  const isGlobal = caller.role === 'founder' || caller.role === 'admin'
  const isHead   = caller.is_head === true
  if (!isGlobal && !isHead) {
    return json({ skipped: true, reason: 'caller is not a head/founder' })
  }
  if (task.assigned_to === user.id) {
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

  const message =
    `📋 Naya kaam aapko assign hua hai: *${task.title}* (${typeLabel}). ` +
    `Assign by: ${caller.name}. Last date: ${task.task_date}. App mein dekhein: ${deepLink}`

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

  // ── 6. Fire n8n Maytapi webhook (best-effort) ──────────────────────────────
  // If no phone, we skip WhatsApp — the in_app row above is the notification.
  const webhook = Deno.env.get('N8N_DEL_ASSIGN_WEBHOOK')
  if (webhook && assignee?.phone) {
    fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_id: notif?.id,
        task_id,
        task_title: task.title,
        task_type_label: typeLabel,
        head_name: caller.name,
        due_date: task.task_date,
        deep_link: deepLink,
        recipient_phone: assignee.phone,
        recipient_name: assignee.name,
        message,
      }),
    }).catch(() => {
      // best-effort; the pending row remains for retry / in-app fallback
    })
  }

  return json({
    success: true,
    notification_id: notif?.id,
    channel,
    notified: !!(webhook && assignee?.phone),
  })
})

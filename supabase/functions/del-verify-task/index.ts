import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Maytapi (reject -> resubmit WhatsApp). Same path as del-notify-assign.
const MAYTAPI_PRODUCT_ID = 'b8cce1b9-0f9f-4aef-994c-d232716471f0'
const MAYTAPI_PHONE_ID = '46821'
const MAYTAPI_API_KEY = Deno.env.get('MAYTAPI_API_KEY')!

// Tier point ceilings — the max a verifier may award (mirrors delegation-points)
const TIER: Record<string, number> = { S: 5, M: 10, L: 20, XL: 40 }

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

  // 1. Verify caller identity
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error: authErr } =
    await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: caller } = await supabase
    .from('employees')
    .select('name, role, is_head, is_active, del_super')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden: no active employee record' }, 403)

  // 2. Parse input
  const body = await req.json()
  const { task_id, decision, final_points, reject_reason } = body as {
    task_id: string
    decision: 'approve' | 'adjust' | 'reject'
    final_points?: number
    reject_reason?: string
  }

  if (!task_id) return json({ error: 'task_id is required' }, 400)
  if (!['approve', 'adjust', 'reject'].includes(decision)) {
    return json({ error: `decision must be approve, adjust, or reject` }, 400)
  }
  if (decision === 'adjust' && (final_points === undefined || final_points === null)) {
    return json({ error: 'final_points is required when decision is adjust' }, 400)
  }
  if (decision === 'reject' && !reject_reason?.trim()) {
    return json({ error: 'reject_reason is required when rejecting' }, 400)
  }

  // 3. Fetch the task
  const { data: task } = await supabase
    .from('del_tasks')
    .select('id, title, role_group, status, type_code, custom_points, on_behalf_of, assigned_to')
    .eq('id', task_id)
    .single()

  if (!task) return json({ error: 'Task not found' }, 404)
  if (task.status !== 'under_review' && task.status !== 'submitted') {
    return json({ error: `Task is not awaiting review (status: ${task.status})` }, 409)
  }

  // 4. Authorise caller (del_super = founder/admin-equivalent over delegation)
  const isGlobal  = caller.role === 'founder' || caller.role === 'admin' || caller.del_super === true
  const isDeptHead = caller.role === task.role_group && caller.is_head === true
  if (!isGlobal && !isDeptHead) {
    return json({ error: 'Forbidden: you are not the head for this department' }, 403)
  }

  // 5. Determine the MAX awardable points (the value decided at assignment):
  //    custom Other points if set, else the task type tier ceiling.
  let maxPoints = 0
  if (task.custom_points != null) {
    maxPoints = task.custom_points
  } else if (task.type_code) {
    const { data: tt } = await supabase
      .from('del_task_types')
      .select('effort_tier')
      .eq('code', task.type_code)
      .single()
    maxPoints = TIER[tt?.effort_tier ?? ''] ?? 0
  }

  // 6. Fetch pending points row
  const { data: pendingPts } = await supabase
    .from('del_points')
    .select('id, proposed_points')
    .eq('task_id', task_id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  const now = new Date().toISOString()

  // 7a. Approve / Adjust — award, CLAMPED to [0, maxPoints]
  if (decision === 'approve' || decision === 'adjust') {
    const raw = decision === 'adjust'
      ? Math.max(0, Math.round(final_points!))
      : (pendingPts?.proposed_points ?? 0)
    const awardedPoints = Math.min(raw, maxPoints)   // never exceed the decided points

    const { error: taskErr } = await supabase
      .from('del_tasks')
      .update({ status: 'completed', verified_by: user.id, verified_at: now, updated_at: now })
      .eq('id', task_id)
    if (taskErr) return json({ error: taskErr.message }, 500)

    const { error: ptsErr } = await supabase
      .from('del_points')
      .update({ points: awardedPoints, status: 'verified', verified_by: user.id, verified_at: now })
      .eq('task_id', task_id)
      .eq('status', 'pending')
    if (ptsErr) return json({ error: ptsErr.message }, 500)

    await supabase.from('del_audit_log').insert({
      task_id,
      actor_uid: user.id,
      action: decision === 'adjust' ? 'adjusted_and_approved' : 'approved',
      old_status: task.status,
      new_status: 'completed',
      details: { final_points: awardedPoints, max_points: maxPoints, requested: raw },
    })

    return json({ success: true, decision, final_points: awardedPoints, max_points: maxPoints })
  }

  // 7b. Reject — send the task BACK to in_progress so the assignee can resubmit,
  //     and WhatsApp them a strict re-do message with the reason + director.
  const { error: taskErr } = await supabase
    .from('del_tasks')
    .update({
      status: 'in_progress',
      reject_reason: reject_reason!.trim(),
      verified_by: user.id,
      verified_at: now,
      updated_at: now,
    })
    .eq('id', task_id)
  if (taskErr) return json({ error: taskErr.message }, 500)

  await supabase
    .from('del_points')
    .update({ status: 'rejected', verified_by: user.id, verified_at: now })
    .eq('task_id', task_id)
    .eq('status', 'pending')

  await supabase.from('del_audit_log').insert({
    task_id,
    actor_uid: user.id,
    action: 'rejected',
    old_status: task.status,
    new_status: 'in_progress',
    details: { reason: reject_reason, returned_for_resubmit: true },
  })

  // WhatsApp the assignee (best-effort)
  const { data: assignee } = await supabase
    .from('employees')
    .select('name, phone')
    .eq('auth_user_id', task.assigned_to)
    .single()

  if (assignee?.phone) {
    const director = task.on_behalf_of ?? caller.name
    const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
    const deepLink = `${hubBase}/delegation/my-day`
    const message =
      `⚠️ *Task Reject Hua — Firse Submit Karein*\n\n` +
      `${assignee.name}, aapka task ${task.title} ${director} ne check karke REJECT kar diya hai.\n\n` +
      `📝 *Reason:* ${reject_reason!.trim()}\n\n` +
      `Kripya theek karke FIRSE submit karein 👇\n${deepLink}\n\n` +
      `— Admin Hagerstone`
    const digits = assignee.phone.replace(/\D/g, '')
    const toNumber = digits.startsWith('91') ? digits : `91${digits}`
    try {
      await fetch(
        `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-maytapi-key': MAYTAPI_API_KEY },
          body: JSON.stringify({ to_number: toNumber, type: 'text', message }),
        },
      )
    } catch (_e) { /* best-effort */ }

    await supabase.from('del_notifications').insert({
      task_id,
      recipient_uid: task.assigned_to,
      channel: 'whatsapp',
      status: 'sent',
      attempts: 1,
      payload: { message, kind: 'rejected_resubmit', by: caller.name },
    })
  }

  return json({ success: true, decision: 'rejected', resubmit: true })
})

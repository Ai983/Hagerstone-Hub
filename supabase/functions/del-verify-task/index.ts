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

  // ── 1. Verify caller identity ──────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error: authErr } =
    await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: caller } = await supabase
    .from('employees')
    .select('role, is_head, is_active, del_super')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden: no active employee record' }, 403)

  // ── 2. Parse input ─────────────────────────────────────────────────────────
  const body = await req.json()
  const { task_id, decision, final_points, reject_reason } = body as {
    task_id: string
    decision: 'approve' | 'adjust' | 'reject'
    final_points?: number
    reject_reason?: string
  }

  if (!task_id) return json({ error: 'task_id is required' }, 400)
  if (!['approve', 'adjust', 'reject'].includes(decision)) {
    return json({ error: "decision must be 'approve', 'adjust', or 'reject'" }, 400)
  }
  if (decision === 'adjust' && (final_points === undefined || final_points === null)) {
    return json({ error: 'final_points is required when decision is adjust' }, 400)
  }
  if (decision === 'reject' && !reject_reason?.trim()) {
    return json({ error: 'reject_reason is required when rejecting' }, 400)
  }

  // ── 3. Fetch the task ──────────────────────────────────────────────────────
  const { data: task } = await supabase
    .from('del_tasks')
    .select('id, role_group, status')
    .eq('id', task_id)
    .single()

  if (!task) return json({ error: 'Task not found' }, 404)

  // Accept both under_review (normal V2 flow) and submitted (fallback/legacy)
  if (task.status !== 'under_review' && task.status !== 'submitted') {
    return json({ error: `Task is not awaiting review (status: ${task.status})` }, 409)
  }

  // ── 4. Authorise caller ────────────────────────────────────────────────────
  // del_super = founder/admin-equivalent over delegation: verify ANY department.
  const isGlobal  = caller.role === 'founder' || caller.role === 'admin' || caller.del_super === true
  const isDeptHead = caller.role === task.role_group && caller.is_head === true
  if (!isGlobal && !isDeptHead) {
    return json({ error: 'Forbidden: you are not the head for this department' }, 403)
  }

  // ── 5. Fetch pending points row ────────────────────────────────────────────
  const { data: pendingPts } = await supabase
    .from('del_points')
    .select('id, proposed_points')
    .eq('task_id', task_id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  const now = new Date().toISOString()

  // ── 6. Apply decision ──────────────────────────────────────────────────────
  if (decision === 'approve' || decision === 'adjust') {
    const awardedPoints = decision === 'adjust'
      ? Math.max(0, Math.round(final_points!))
      : (pendingPts?.proposed_points ?? 0)

    const { error: taskErr } = await supabase
      .from('del_tasks')
      .update({ status: 'completed', verified_by: user.id, verified_at: now, updated_at: now })
      .eq('id', task_id)
    if (taskErr) return json({ error: taskErr.message }, 500)

    const { error: ptsErr } = await supabase
      .from('del_points')
      .update({
        points: awardedPoints,
        status: 'verified',
        verified_by: user.id,
        verified_at: now,
      })
      .eq('task_id', task_id)
      .eq('status', 'pending')
    if (ptsErr) return json({ error: ptsErr.message }, 500)

    await supabase.from('del_audit_log').insert({
      task_id,
      actor_uid: user.id,
      action: decision === 'adjust' ? 'adjusted_and_approved' : 'approved',
      old_status: task.status,
      new_status: 'completed',
      details: { final_points: awardedPoints },
    })

    return json({ success: true, decision, final_points: awardedPoints })
  }

  // reject
  const { error: taskErr } = await supabase
    .from('del_tasks')
    .update({
      status: 'rejected',
      reject_reason: reject_reason!.trim(),
      verified_by: user.id,
      verified_at: now,
      updated_at: now,
    })
    .eq('id', task_id)
  if (taskErr) return json({ error: taskErr.message }, 500)

  const { error: ptsErr } = await supabase
    .from('del_points')
    .update({ status: 'rejected', verified_by: user.id, verified_at: now })
    .eq('task_id', task_id)
    .eq('status', 'pending')
  if (ptsErr) return json({ error: ptsErr.message }, 500)

  await supabase.from('del_audit_log').insert({
    task_id,
    actor_uid: user.id,
    action: 'rejected',
    old_status: task.status,
    new_status: 'rejected',
    details: { reason: reject_reason },
  })

  return json({ success: true, decision: 'rejected' })
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TIER, TIER_HALF, GRACE_DAYS } from '../_shared/delegation-points.ts'

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

function isoWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = d.getUTCDay()
  const daysToMonday = dow === 0 ? 6 : dow - 1
  d.setUTCDate(d.getUTCDate() - daysToMonday)
  return d.toISOString().slice(0, 10)
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01'
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
    .select('id, role, is_active')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden: no active employee record' }, 403)

  // ── 2. Parse input ─────────────────────────────────────────────────────────
  const body = await req.json()
  const { task_id, text, attachments = [] } = body as {
    task_id: string
    text: string
    attachments?: { url: string; type: string; name: string; size: number }[]
  }

  if (!task_id) return json({ error: 'task_id is required' }, 400)
  if (!text?.trim()) return json({ error: 'Submission text is required' }, 400)

  // ── 3. Fetch and validate task ─────────────────────────────────────────────
  const { data: task, error: taskErr } = await supabase
    .from('del_tasks')
    .select('id, title, description, type_code, role_group, assigned_to, task_date, status, custom_points')
    .eq('id', task_id)
    .single()

  if (taskErr || !task) return json({ error: 'Task not found' }, 404)
  if (task.assigned_to !== user.id) return json({ error: 'Forbidden: you are not the assignee' }, 403)
  if (task.status !== 'assigned' && task.status !== 'in_progress') {
    return json({ error: `Task is already ${task.status}` }, 409)
  }

  // ── 4. Compute timing ──────────────────────────────────────────────────────
  const now = new Date()
  const submittedDateStr = now.toISOString().slice(0, 10)
  const completedOnTime = submittedDateStr <= task.task_date

  const graceCutoff = new Date(task.task_date + 'T00:00:00Z')
  graceCutoff.setUTCDate(graceCutoff.getUTCDate() + GRACE_DAYS)
  const withinGrace = submittedDateStr <= graceCutoff.toISOString().slice(0, 10)

  // ── 5. Compute tier ceiling ────────────────────────────────────────────────
  let ceiling = 0
  let effortTier: string | null = null
  let scoredBy: 'agent' | 'external' = 'agent'

  if (task.type_code) {
    const { data: tt } = await supabase
      .from('del_task_types')
      .select('effort_tier, daily_cap, scored_by')
      .eq('code', task.type_code)
      .eq('active', true)
      .single()

    if (tt) {
      effortTier = tt.effort_tier
      scoredBy = (tt.scored_by as 'agent' | 'external') ?? 'agent'
      // Ceiling = full tier points on time, half if in grace, 0 if beyond
      if (completedOnTime) {
        ceiling = TIER[effortTier] ?? 0
      } else if (withinGrace) {
        ceiling = TIER_HALF[effortTier] ?? 0
      }

      // Apply daily_cap — if cap reached, ceiling becomes 0
      if (tt.daily_cap !== null && ceiling > 0) {
        const { data: siblingScoredTasks } = await supabase
          .from('del_tasks')
          .select('id')
          .eq('assigned_to', user.id)
          .eq('type_code', task.type_code)
          .eq('task_date', task.task_date)
          .neq('id', task_id)
          .in('status', ['submitted', 'under_review', 'completed', 'verified'])

        if (siblingScoredTasks && siblingScoredTasks.length > 0) {
          const siblingIds = siblingScoredTasks.map((t: { id: string }) => t.id)
          const { count: scoredCount } = await supabase
            .from('del_points')
            .select('id', { count: 'exact', head: true })
            .in('task_id', siblingIds)
            .gt('points', 0)

          if ((scoredCount ?? 0) >= tt.daily_cap) {
            ceiling = 0
          }
        }
      }
    }
  }

  // ── 6. Update task status to submitted ────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('del_tasks')
    .update({
      status: 'submitted',
      submitted_at: now.toISOString(),
      completed_on_time: completedOnTime,
      updated_at: now.toISOString(),
    })
    .eq('id', task_id)

  if (updateErr) return json({ error: updateErr.message }, 500)

  // ── 7. Create submission record ────────────────────────────────────────────
  const { data: submission, error: subErr } = await supabase
    .from('del_submissions')
    .insert({
      task_id,
      submitted_by: user.id,
      input_type: 'text',
      raw_text: text.trim(),
      attachments: attachments ?? [],
    })
    .select('id')
    .single()

  if (subErr) return json({ error: subErr.message }, 500)

  // ── 8. Audit log ───────────────────────────────────────────────────────────
  await supabase.from('del_audit_log').insert({
    task_id,
    actor_uid: user.id,
    action: 'submitted',
    old_status: task.status,
    new_status: 'submitted',
    details: { submission_id: submission.id, ceiling, scored_by: scoredBy },
  })

  // ── 9-custom. Other custom-points task: assigner set the points → auto-award
  // on verify. We propose exactly the entered value (regardless of timing) and
  // move to under_review so the head just confirms completion.
  if (task.custom_points != null) {
    await supabase
      .from('del_points')
      .insert({
        user_id:      user.id,
        role_group:   task.role_group,
        points:       0,
        proposed_points: task.custom_points,
        summary:      `Custom Other task — ${task.custom_points} pts set by the assigner. Head: confirm to award.`,
        reason:       `${task.title} submitted — custom points (${task.custom_points})`,
        task_id,
        submission_id: submission.id,
        source_type:  'delegation',
        status:       'pending',
        period_week:  isoWeekMonday(task.task_date),
        period_month: monthStart(task.task_date),
        agent_meta:   { confidence: 'n/a', flags: ['custom_points'], reasoning: 'Assigner-set custom points', model: 'none' },
      })

    await supabase
      .from('del_tasks')
      .update({ status: 'under_review', updated_at: now.toISOString() })
      .eq('id', task_id)

    return json({
      success: true,
      submission_id: submission.id,
      message: 'Submitted! Head confirm karega aur aapke points mil jayenge.',
    })
  }

  // ── 9a. EXTERNAL types: CPS/Finance already own the points (spec §3) ───────
  // The AI agent does NOT propose points. We move straight to under_review with
  // a note so the head can see the task; points come from the existing engine.
  if (scoredBy === 'external') {
    await supabase
      .from('del_points')
      .insert({
        user_id:      user.id,
        role_group:   task.role_group,
        points:       0,
        proposed_points: null,
        summary:      'This task type is scored by the CPS/Finance system — points are tracked there, not by the delegation AI. Head: confirm completion only.',
        reason:       `${task.title} submitted — externally scored (CPS/Finance)`,
        task_id,
        submission_id: submission.id,
        source_type:  'delegation',
        status:       'pending',
        period_week:  isoWeekMonday(task.task_date),
        period_month: monthStart(task.task_date),
        agent_meta:   { confidence: 'n/a', flags: ['external_scored'], reasoning: 'Scored by CPS/Finance engine', model: 'none' },
      })

    await supabase
      .from('del_tasks')
      .update({ status: 'under_review', updated_at: now.toISOString() })
      .eq('id', task_id)

    return json({
      success: true,
      submission_id: submission.id,
      message: 'Submitted! Yeh kaam CPS/Finance se score hota hai — Head sirf confirm karega.',
    })
  }

  // ── 9b. AGENT types: fire-and-forget to n8n AI scoring workflow ───────────
  // Score runs in n8n; head will see the result once it completes (status → under_review)
  const n8nWebhook = Deno.env.get('N8N_DEL_SCORING_WEBHOOK')
  if (n8nWebhook) {
    fetch(n8nWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id,
        submission_id: submission.id,
        ceiling,
        task_title: task.title,
        task_description: task.description,
        type_code: task.type_code,
        role_group: task.role_group,
        effort_tier: effortTier,
        raw_text: text.trim(),
        attachments: attachments ?? [],
        user_id: user.id,
        period_week: isoWeekMonday(task.task_date),
        period_month: monthStart(task.task_date),
      }),
    }).catch(() => {
      // Scoring is best-effort; the task is already submitted
    })
  }

  return json({
    success: true,
    submission_id: submission.id,
    message: 'Submitted! AI scoring is running — your head will see the result shortly.',
  })
})

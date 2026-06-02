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

/** Monday of the ISO week containing the given date string (YYYY-MM-DD). */
function isoWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const dow = d.getUTCDay() // 0=Sun
  const daysToMonday = dow === 0 ? 6 : dow - 1
  d.setUTCDate(d.getUTCDate() - daysToMonday)
  return d.toISOString().slice(0, 10)
}

/** First day of the month of the given date string. */
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

  // ── 1. Verify caller identity from JWT (never trust body) ──────────────────
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

  // ── 2. Parse and validate input ────────────────────────────────────────────
  const { task_id } = await req.json()
  if (!task_id) return json({ error: 'task_id is required' }, 400)

  // ── 3. Fetch the task ──────────────────────────────────────────────────────
  const { data: task, error: taskErr } = await supabase
    .from('del_tasks')
    .select('id, title, type_code, role_group, assigned_to, task_date, status')
    .eq('id', task_id)
    .single()

  if (taskErr || !task) return json({ error: 'Task not found' }, 404)

  // Caller must be the assignee
  if (task.assigned_to !== user.id) return json({ error: 'Forbidden: you are not the assignee' }, 403)

  // Can only submit from assigned or in_progress
  if (task.status !== 'assigned' && task.status !== 'in_progress') {
    return json({ error: `Task is already ${task.status}` }, 409)
  }

  // ── 4. Compute timing and points ───────────────────────────────────────────
  const now = new Date()
  const submittedDateStr = now.toISOString().slice(0, 10)  // "YYYY-MM-DD" UTC

  const completedOnTime = submittedDateStr <= task.task_date

  const graceCutoff = new Date(task.task_date + 'T00:00:00Z')
  graceCutoff.setUTCDate(graceCutoff.getUTCDate() + GRACE_DAYS)
  const withinGrace = submittedDateStr <= graceCutoff.toISOString().slice(0, 10)

  let points = 0
  let timingLabel = 'beyond grace (0 points)'

  // Look up effort tier from task type (null type_code → 0 points)
  let effortTier: string | null = null
  if (task.type_code) {
    const { data: tt } = await supabase
      .from('del_task_types')
      .select('effort_tier, daily_cap')
      .eq('code', task.type_code)
      .eq('active', true)
      .single()

    if (tt) {
      effortTier = tt.effort_tier

      if (completedOnTime) {
        points = TIER[effortTier] ?? 0
        timingLabel = 'on time'
      } else if (withinGrace) {
        points = TIER_HALF[effortTier] ?? 0
        timingLabel = `${GRACE_DAYS} day grace (half points)`
      }

      // ── 5. Enforce daily_cap ───────────────────────────────────────────────
      if (tt.daily_cap !== null && points > 0) {
        const { count } = await supabase
          .from('del_points')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('task_id', null)   // only count via type_code match below
          // We need to count by type_code on the same task_date.
          // Join through del_tasks to find same type_code + task_date.
          // Simpler: count del_points rows where task_id references a del_task
          // with the same type_code and task_date — done via a subquery RPC.
          // For simplicity here, count all of this user's del_points that link to
          // del_tasks with matching type_code AND task_date, and have points > 0.

        // Use a raw SQL approach via rpc is cleaner; here we do two queries:
        const { data: siblingScoredTasks } = await supabase
          .from('del_tasks')
          .select('id')
          .eq('assigned_to', user.id)
          .eq('type_code', task.type_code)
          .eq('task_date', task.task_date)
          .neq('id', task_id)
          .in('status', ['submitted', 'verified'])

        if (siblingScoredTasks && siblingScoredTasks.length > 0) {
          const siblingIds = siblingScoredTasks.map((t: { id: string }) => t.id)
          const { count: scoredCount } = await supabase
            .from('del_points')
            .select('id', { count: 'exact', head: true })
            .in('task_id', siblingIds)
            .gt('points', 0)

          if ((scoredCount ?? 0) >= tt.daily_cap) {
            points = 0
            timingLabel = `daily cap of ${tt.daily_cap} reached for ${task.type_code}`
          }
        }
      }
    }
  }

  // ── 6. Build reason string ──────────────────────────────────────────────────
  const typeLabel = task.type_code ?? 'task'
  const reason = points > 0
    ? `+${points} — "${task.title}" (${typeLabel}) submitted ${timingLabel} — pending Head verification`
    : `+0 — "${task.title}" (${typeLabel}) — ${timingLabel}`

  const periodWeek  = isoWeekMonday(task.task_date)
  const periodMonth = monthStart(task.task_date)

  // ── 7. Update task status ───────────────────────────────────────────────────
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

  // ── 8. Insert pending points row ────────────────────────────────────────────
  const { error: pointsErr } = await supabase
    .from('del_points')
    .insert({
      user_id:      user.id,
      role_group:   task.role_group,
      points,
      reason,
      task_id:      task_id,
      source_type:  'delegation',
      status:       'pending',
      period_week:  periodWeek,
      period_month: periodMonth,
    })

  if (pointsErr) return json({ error: pointsErr.message }, 500)

  return json({ success: true, points, reason })
})

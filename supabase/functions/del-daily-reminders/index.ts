// del-daily-reminders — ONE WhatsApp follow-up per day for every open delegation
// task, until the assignee acts on it. Machine-only: call with the service-role
// key as bearer (n8n Schedule Trigger, once daily ~10:00 IST).
//
// Scope of "open": status in ('assigned','in_progress'). Once the assignee
// submits (status → submitted/under_review) or the task is completed/verified/
// cancelled/rejected, reminders stop automatically — the ball is no longer in
// the assignee's court.
//
// "One at a time / one per day": a task is skipped if ANY del_notifications row
// already exists for it since today's IST midnight. This also means the
// assign-day notice (del-notify-assign) counts as that day's message, so the
// first daily reminder lands the day AFTER assignment. No schema change needed.
//
// Tone: gentle before/at the deadline, strict once the deadline date has passed.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWhatsApp } from '../_shared/maytapi.ts'

const BATCH = 300

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

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Auth: service-role JWT only (n8n schedule) ─────────────────────────────
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  let role: string | null = null
  try {
    role = JSON.parse(atob(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role
  } catch { /* noop */ }
  if (role !== 'service_role') return json({ error: 'Unauthorized' }, 401)

  const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
  const deepLink = `${hubBase}/delegation/my-day`

  // Today in IST + the UTC instant of today's IST midnight (for the "already
  // messaged today" guard).
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const istMidnightUtc = new Date(`${todayIST}T00:00:00+05:30`).toISOString()

  // ── Open tasks that are still the assignee's responsibility ────────────────
  const { data: tasks, error } = await admin
    .from('del_tasks')
    .select('id, title, assigned_to, assigned_by, task_date, due_time, on_behalf_of')
    .in('status', ['assigned', 'in_progress'])
    .limit(BATCH)
  if (error) return json({ error: error.message }, 500)

  const sent: string[] = []
  const skippedToday: string[] = []
  const noPhone: string[] = []
  const errors: { id: string; error: string }[] = []

  for (const task of tasks ?? []) {
    try {
      // Already messaged today (assign notice or a prior reminder)? → skip.
      const { count } = await admin
        .from('del_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('task_id', task.id)
        .gte('created_at', istMidnightUtc)
      if ((count ?? 0) > 0) { skippedToday.push(task.id); continue }

      // Resolve assignee (phone + name)
      const { data: assignee } = await admin
        .from('employees')
        .select('name, phone')
        .eq('auth_user_id', task.assigned_to)
        .maybeSingle()
      if (!assignee?.phone) { noPhone.push(task.id); continue }

      // Resolve who the task is on behalf of (director) or fall back to the assigner.
      let assigner = task.on_behalf_of ?? 'Admin'
      if (!task.on_behalf_of) {
        const { data: by } = await admin
          .from('employees')
          .select('name')
          .eq('auth_user_id', task.assigned_by)
          .maybeSingle()
        assigner = by?.name ?? 'Admin'
      }

      // Readable deadline (IST) + optional time
      let dueLabel = task.task_date
      try {
        dueLabel = new Date(`${task.task_date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
          timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
        })
      } catch { /* keep raw */ }
      const timeStr = task.due_time ? ` ${String(task.due_time).slice(0, 5)}` : ''
      const overdue = todayIST > task.task_date

      const message = overdue
        ? (
            `⚠️ *Deadline Cross Ho Chuki!*\n\n` +
            `${assignee.name}, is task ki deadline (${dueLabel}${timeStr}) nikal chuki hai. ` +
            `${assigner} update maang rahe hain — ise TURANT complete karke submit karein:\n\n` +
            `📝 *Kaam:* ${task.title}\n\n` +
            `Abhi submit karein 👇\n${deepLink}\n\n` +
            `— Admin Hagerstone`
          )
        : (
            `🔔 *Task Reminder*\n\n` +
            `Namaste ${assignee.name}! ${assigner} ne aapko yeh task diya hai — reminder:\n\n` +
            `📝 *Kaam:* ${task.title}\n` +
            `⏰ *Last date:* ${dueLabel}${timeStr}\n\n` +
            `Kripya time par complete karke submit karein 👇\n${deepLink}\n\n` +
            `— Admin Hagerstone`
          )

      const r = await sendWhatsApp({ phone: assignee.phone, message })
      await admin.from('del_notifications').insert({
        task_id: task.id,
        recipient_uid: task.assigned_to,
        channel: 'whatsapp',
        status: r.ok ? 'sent' : 'failed',
        attempts: 1,
        provider_msg_id: r.msgId,
        payload: { kind: 'daily_reminder', overdue, message },
      })
      sent.push(task.id)
    } catch (e) {
      errors.push({ id: task.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return json({
    ok: true,
    scanned: (tasks ?? []).length,
    sent: sent.length,
    skipped_today: skippedToday.length,
    no_phone: noPhone.length,
    errors,
  })
})

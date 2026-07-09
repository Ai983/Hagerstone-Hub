// GIE — Reminder + penalty engine. Runs on DISPATCHED tasks tracked in
// gie_task_tracking that aren't completed. Three escalating reminders (R1→R3),
// then a 4th that DEBITS 500 points via the existing scoring system (del_points).
// Machine-only: call with the service-role key as bearer (n8n Schedule Trigger,
// hourly). Award-on-completion needs NO code here — del-submit-task proposes the
// custom_points and del-verify-task credits them; this function only STOPS
// reminders on completion and applies the lateness penalty.
//
// Cadence (due-anchored, escalating): R1 at due_at, then +24h per step. The send
// whose result is reminder_count==4 is the penalty step.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Use the SHARED sender. This file used to inline its own copy whose normalizePhone
// read `digits.startsWith('91')` — so a 10-digit mobile that merely begins with 91
// (e.g. 9117715416) was mistaken for a number that already carried the country code
// and was dialled without one. The shared helper checks length === 12 instead.
import { sendWhatsApp } from '../_shared/maytapi.ts'

const STEP_MS = 24 * 60 * 60 * 1000   // 24h between reminders
const PENALTY_POINTS = 500
const BATCH = 200

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// ── Period helpers (match del-submit-task so the ledger lands in the right buckets) ──
function isoWeekMonday(d: Date): string {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = c.getUTCDay()
  c.setUTCDate(c.getUTCDate() - (dow === 0 ? 6 : dow - 1))
  return c.toISOString().slice(0, 10)
}
function monthStart(d: Date): string {
  return d.toISOString().slice(0, 7) + '-01'
}

function reminderText(name: string, title: string, level: number, hubBase: string): string {
  const link = `${hubBase}/delegation/my-day`
  if (level === 1) {
    return `🔔 *Reminder — Task pending*\n\n${name}, aapka task *${title}* abhi tak complete nahi hua hai.\nKripya jaldi pura karke submit karein 👇\n${link}\n\n— Admin Hagerstone`
  }
  if (level === 2) {
    return `⏰ *Doosra Reminder — Task overdue*\n\n${name}, *${title}* ka deadline nikal raha hai. Please ise priority par lein aur aaj submit karein 👇\n${link}\n\n— Admin Hagerstone`
  }
  return `⚠️ *Teesra Reminder — Action zaroori*\n\n${name}, *${title}* abhi bhi pending hai. Agle reminder par *500 points ki kataai* ho jayegi. Kripya turant submit karein 👇\n${link}\n\n— Admin Hagerstone`
}

function penaltyText(name: string, title: string, hubBase: string): string {
  const link = `${hubBase}/delegation/my-day`
  return `🛑 *Final Notice — 500 points deducted*\n\n${name}, *${title}* time par complete na hone ki wajah se aapke *500 points kaat liye gaye hain*.\nTask abhi bhi pura karke submit karein 👇\n${link}\n\n— Admin Hagerstone`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
  const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'

  // Service-role bearer only (n8n schedule). Decode role from the JWT payload.
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  let role: string | null = null
  try { role = JSON.parse(atob(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch { /* noop */ }
  if (role !== 'service_role') return json({ error: 'Unauthorized' }, 401)

  const now = new Date()
  const nowIso = now.toISOString()
  const reconciled: string[] = []
  const reminded: string[] = []
  const penalised: string[] = []
  const errors: { id: string; error: string }[] = []

  // Pull open trackers joined to their task (status/title/assignee).
  const { data: rows, error } = await admin
    .from('gie_task_tracking')
    .select(`
      id, del_task_id, assignee_phone, reminder_count, next_reminder_at, penalty_applied, task_points,
      task:del_tasks!inner(id, title, status, submitted_at, assigned_to, role_group)
    `)
    .eq('is_completed', false)
    .eq('penalty_applied', false)
    .limit(BATCH)
  if (error) return json({ error: error.message }, 500)

  for (const r of (rows ?? []) as any[]) {
    const task = r.task
    try {
      // 1. Reconcile completion — assignee submitted ⇒ stop reminders forever.
      const done = !!task.submitted_at || ['submitted', 'under_review', 'completed'].includes(task.status)
      if (done) {
        await admin.from('gie_task_tracking')
          .update({ is_completed: true, completed_at: task.submitted_at ?? nowIso })
          .eq('id', r.id)
        reconciled.push(r.id)
        continue
      }

      // 2. Due yet?  (next_reminder_at = null means "never remind" — see the backlog
      //    silencing migration; those rows stay open but are not chased.)
      if (!r.next_reminder_at || new Date(r.next_reminder_at).getTime() > now.getTime()) continue

      // resolve assignee display name + a phone if the tracker is missing one
      const { data: emp } = await admin.from('employees')
        .select('name, phone').eq('auth_user_id', task.assigned_to).maybeSingle()
      const name = emp?.name ?? 'Team'

      // The tracker's phone is a snapshot taken at dispatch; fall back to the employee
      // record. With neither, we can never reach them — stop instead of re-erroring on
      // every hourly run forever, and leave a breadcrumb for whoever fixes the row.
      const phone = r.assignee_phone || emp?.phone || null
      if (!phone) {
        await admin.from('gie_task_tracking').update({ next_reminder_at: null }).eq('id', r.id)
        errors.push({ id: r.id, error: 'no assignee phone — reminders stopped' })
        continue
      }

      const nextLevel = (r.reminder_count ?? 0) + 1

      if (nextLevel <= 3) {
        // ── R1 / R2 / R3 ──
        const sent = await sendWhatsApp({ phone, message: reminderText(name, task.title, nextLevel, hubBase) })
        await admin.from('gie_task_tracking').update({
          reminder_count: nextLevel,
          last_reminder_at: nowIso,
          next_reminder_at: new Date(now.getTime() + STEP_MS).toISOString(),
        }).eq('id', r.id)
        await admin.from('del_notifications').insert({
          task_id: task.id, recipient_uid: task.assigned_to, channel: 'whatsapp',
          status: sent.ok ? 'sent' : 'failed', attempts: 1, provider_msg_id: sent.msgId,
          payload: { kind: `gie_reminder_${nextLevel}` },
        }).select('id').maybeSingle().then(() => {}, () => {})
        reminded.push(r.id)
      } else {
        // ── 4th: PENALTY −500 via del_points (same currency as awards) ──
        await admin.from('del_points').insert({
          user_id: task.assigned_to,
          role_group: task.role_group,
          points: -PENALTY_POINTS,
          reason: `${task.title} — late/incomplete (4th reminder): −${PENALTY_POINTS} pts`,
          task_id: task.id,
          source_type: 'delegation',
          status: 'verified',            // immediately affects the balance (SUM where verified)
          period_week: isoWeekMonday(now),
          period_month: monthStart(now),
          awarded_at: nowIso,
          verified_at: nowIso,
          summary: 'Auto-penalty: task not completed by the 4th reminder.',
          agent_meta: { flags: ['gie_penalty'], reasoning: 'GIE reminder engine 4th-strike penalty', model: 'none' },
        })
        await admin.from('gie_points_ledger').insert({
          del_task_id: task.id, points: -PENALTY_POINTS, kind: 'penalty',
          reason: '4th reminder reached — task still incomplete',
        })
        await admin.from('gie_task_tracking').update({
          reminder_count: nextLevel,
          last_reminder_at: nowIso,
          penalty_applied: true,
          penalty_points: -PENALTY_POINTS,
          next_reminder_at: null,        // stop — idempotency via penalty_applied + unique(del_task_id)
        }).eq('id', r.id)
        const sent = await sendWhatsApp({ phone, message: penaltyText(name, task.title, hubBase) })
        await admin.from('del_notifications').insert({
          task_id: task.id, recipient_uid: task.assigned_to, channel: 'whatsapp',
          status: sent.ok ? 'sent' : 'failed', attempts: 1, provider_msg_id: sent.msgId,
          payload: { kind: 'gie_penalty' },
        }).select('id').maybeSingle().then(() => {}, () => {})
        penalised.push(r.id)
      }
    } catch (e) {
      errors.push({ id: r.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // Bump the gamification pulse so balances/leaderboards refresh live after penalties.
  if (penalised.length) {
    await admin.from('gamification_pulse')
      .update({ updated_at: nowIso, source: 'gie_penalty' }).eq('id', 1)
      .then(() => {}, () => {})
  }

  return json({
    ok: true,
    reconciled: reconciled.length,
    reminded: reminded.length,
    penalised: penalised.length,
    errors,
  })
})

// del-task-followup — Resend / nudge for an already-assigned delegation task.
// Triggered by Ritu / heads / founder / admin from the employee task card.
// Sends a WhatsApp follow-up on behalf of the assigning director:
//   - gentle before the deadline (director is asking for an update)
//   - strict after the deadline (deadline cross ho chuki, jaldi bhejiye)
// Direct Maytapi — same proven path as del-notify-assign / send-onboarding.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

import { sendWhatsApp } from '../_shared/maytapi.ts'

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

  // 1. Verify caller
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
  if (!caller) return json({ error: 'Forbidden' }, 403)

  const isGlobal = caller.role === 'founder' || caller.role === 'admin' || caller.del_super === true
  if (!isGlobal && caller.is_head !== true) {
    return json({ error: 'Forbidden: not a head/founder/admin' }, 403)
  }

  // 2. Input
  const { task_id } = await req.json()
  if (!task_id) return json({ error: 'task_id is required' }, 400)

  // 3. Load task
  const { data: task } = await supabase
    .from('del_tasks')
    .select('id, title, type_code, role_group, assigned_to, task_date, due_time, status, on_behalf_of')
    .eq('id', task_id)
    .single()
  if (!task) return json({ error: 'Task not found' }, 404)

  // Only nudge open tasks
  if (['completed', 'verified', 'cancelled', 'rejected'].includes(task.status)) {
    return json({ skipped: true, reason: `task is ${task.status}` })
  }

  // 4. Resolve assignee
  const { data: assignee } = await supabase
    .from('employees')
    .select('name, phone')
    .eq('auth_user_id', task.assigned_to)
    .single()
  if (!assignee?.phone) {
    return json({ skipped: true, reason: 'assignee has no phone on file' })
  }

  const director = task.on_behalf_of ?? caller.name

  // Readable deadline (IST) + display time
  let dueLabel = task.task_date
  try {
    dueLabel = new Date(`${task.task_date}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch (_e) { /* keep raw */ }
  const timeStr = task.due_time ? ` ${String(task.due_time).slice(0, 5)}` : ''

  // Past deadline? compare today's IST date string with task_date (date-based)
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const pastDeadline = todayIST > task.task_date

  const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
  const deepLink = `${hubBase}/delegation/my-day`

  const message = pastDeadline
    ? (
        `⚠️ *Deadline Cross Ho Chuki!*\n\n` +
        `${assignee.name}, aapke task ki deadline (${dueLabel}${timeStr}) nikal chuki hai. ` +
        `${director} is task ka update maang rahe hain — ise TURANT complete karke bhejiye:\n\n` +
        `📝 *Kaam:* ${task.title}\n\n` +
        `Abhi submit karein 👇\n${deepLink}\n\n` +
        `— Admin Hagerstone`
      )
    : (
        `🔔 *Task Update Chahiye*\n\n` +
        `Namaste ${assignee.name}! ${director} aapke is task par update maang rahe hain:\n\n` +
        `📝 *Kaam:* ${task.title}\n` +
        `⏰ *Last date:* ${dueLabel}${timeStr}\n\n` +
        `Kripya jaldi update dein ya complete karke submit karein 👇\n${deepLink}\n\n` +
        `— Admin Hagerstone`
      )

  // 5. Send via Maytapi
  const r = await sendWhatsApp({ phone: assignee.phone, message })
  const waStatus: 'sent' | 'failed' = r.ok ? 'sent' : 'failed'

  // 6. Record the follow-up
  await supabase.from('del_notifications').insert({
    task_id,
    recipient_uid: task.assigned_to,
    channel: 'whatsapp',
    status: waStatus,
    attempts: 1,
    provider_msg_id: r.msgId,
    payload: { message, kind: pastDeadline ? 'followup_overdue' : 'followup', by: caller.name },
  })

  return json({ success: true, sent: waStatus === 'sent', overdue: pastDeadline })
})

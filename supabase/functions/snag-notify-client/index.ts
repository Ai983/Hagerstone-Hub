// snag-notify-client — tells the CLIENT their snag is fixed.
//
// The mirror image of snag-intake: that one alerts our team when a client
// reports a defect, this one closes the loop back to the client when Saksham
// marks it resolved or closed from /snags.
//
// Why an edge function and not a browser call: the WhatsApp gateway key is a
// server secret (WA_GATEWAY_KEY), and the outbound number is chosen by a human
// at closing time — so the caller is authenticated as a Hub user and re-checked
// against can_manage_snags here, not just in the UI.
//
// The number is NOT taken from the report. A client who filed with no phone, or
// with the site engineer's number, or from a landline, still has to be reachable
// on WhatsApp — so whoever closes the snag types the number to message, and we
// backfill reporter_phone when the report had none.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendWhatsApp, normalizePhone } from '../_shared/maytapi.ts'

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

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** Same guard as snag-intake: a placeholder row like 9800000000 normalises to a
 *  real, dialable number, and auto-messaging one would WhatsApp a stranger. */
function isRealMobile(raw: string | null | undefined): boolean {
  const digits = (raw ?? '').replace(/\D/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  if (local.length !== 10) return false
  if (!/^[6-9]/.test(local)) return false
  return !/(\d)\1{6,}/.test(local)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Who is calling? Same shape as del-task-followup.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)
  const { data: { user }, error: authErr } =
    await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const { data: caller } = await supabase
    .from('employees')
    .select('id, name, role, is_active, snag_owner')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()
  if (!caller) return json({ error: 'Forbidden' }, 403)
  // Mirrors public.can_manage_snags().
  if (!(caller.snag_owner === true || caller.role === 'admin')) {
    return json({ error: 'Forbidden: you cannot close snags' }, 403)
  }

  // 2. Input
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ error: 'Invalid body' }, 400) }

  const snagId = str(body.snag_id, 40)
  const phoneRaw = str(body.phone, 30)
  if (!snagId) return json({ error: 'snag_id is required' }, 400)
  if (!isRealMobile(phoneRaw)) {
    return json({ error: 'That does not look like a WhatsApp mobile number. Enter the client\'s 10-digit mobile.' }, 400)
  }

  // 3. The snag
  const { data: snag } = await supabase
    .from('snag_reports')
    .select('id, ref, status, title, reporter_name, reporter_phone, resolution_note, resolved_at, project:projects(name)')
    .eq('id', snagId)
    .single()
  if (!snag) return json({ error: 'Snag not found' }, 404)

  // Telling a client "your issue is fixed" while it is still open would be worse
  // than saying nothing, so the state is checked here and not only in the UI.
  if (snag.status !== 'resolved' && snag.status !== 'closed') {
    return json({ error: 'This snag is not resolved or closed yet.' }, 400)
  }

  const projectName = ((snag.project ?? {}) as { name?: string }).name ?? ''
  const isClosed = snag.status === 'closed'

  const lines = [
    `✅ *Your issue has been ${isClosed ? 'resolved and closed' : 'resolved'}*`,
    ``,
    `Dear ${snag.reporter_name},`,
    ``,
    `The issue you reported${projectName ? ` at ${projectName}` : ''} has been attended to and marked ${isClosed ? 'resolved and closed' : 'resolved'}.`,
    ``,
    `*Ref:* ${snag.ref}`,
    `*Issue:* ${snag.title}`,
  ]
  if (snag.resolution_note) {
    lines.push(`*What was done:* ${String(snag.resolution_note).slice(0, 600)}`)
  }
  lines.push(
    ``,
    // Deliberately NOT "reply to this message": nothing in the Hub reads inbound
    // WhatsApp, so a reply here would go unanswered. The two routes named below
    // are both real — the report form link they already have still works.
    `If the problem is still there, please contact your Hagerstone project manager quoting the reference number above, or report it again using the same link we sent you.`,
    ``,
    `Thank you for your patience.`,
    `— Team Hagerstone`,
  )

  // 4. Send. `ok` means the gateway accepted it — wa_messages.status is the truth,
  // which the Snags page resolves through snag_wa_status().
  const result = await sendWhatsApp({ phone: phoneRaw, message: lines.join('\n') })
  const phone = normalizePhone(phoneRaw)

  // 5. Log it either way. A failed send that leaves no trace is how a client ends
  // up never hearing back and nobody knowing.
  await supabase.from('snag_events').insert({
    snag_id: snag.id,
    actor_id: caller.id,
    event_type: 'client_notified',
    note: result.ok
      ? `Closure message sent to the client`
      : `Closure message FAILED to send to the client`,
    recipient_phone: phone,
    wa_message_id: result.ok ? result.msgId : null,
  })

  if (result.ok) {
    const patch: Record<string, unknown> = { client_notified_at: new Date().toISOString() }
    // Only fill a blank — never overwrite the number the client themselves gave,
    // which may be the one they actually answer.
    if (!snag.reporter_phone) patch.reporter_phone = phoneRaw
    await supabase.from('snag_reports').update(patch).eq('id', snag.id)
  }

  if (!result.ok) {
    return json({ error: 'WhatsApp could not be sent. The snag status was still saved.' }, 502)
  }
  return json({ ok: true, phone })
})

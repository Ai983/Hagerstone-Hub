// Admin helper for GIE group onboarding.
//   GET / POST {}                 -> list all Maytapi groups + onboarded flag
//   POST { action: 'onboard' }    -> insert all HSIPL/Internal-branded groups not
//                                    yet in gie_groups (idempotent). Optional:
//                                    { activate:false } add inactive, { cadence:N }.
//   POST { action: 'status' }     -> capture phone's WhatsApp session state. Returns
//                                    logged_in:false when the number has been signed
//                                    out and group capture is silently dead.
// Gated to service_role OR an active founder/admin/del_super.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}
function jwtRole(t: string): string | null {
  try { const p = t.split('.')[1]; if (!p) return null
    return (JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).role as string) ?? null
  } catch { return null }
}

const PID   = Deno.env.get('MAYTAPI_GRP_PRODUCT_ID') ?? 'f09cb10a-0037-4e1f-8895-ee7a607077b4'
const PHONE = Deno.env.get('MAYTAPI_GRP_PHONE_ID')   ?? '145466'
const KEY   = Deno.env.get('MAYTAPI_GRP_API_KEY')    ?? ''
const GRP_NUMBER = '918882979328'  // maytapi_phone stored on gie_groups rows
const BRAND = /^\s*(hsipl|internal[- ])/i

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  let ok = jwtRole(bearer) === 'service_role'
  if (!ok && bearer) {
    const { data: { user } } = await admin.auth.getUser(bearer)
    if (user) {
      const { data: emp } = await admin.from('employees').select('role, del_super')
        .eq('auth_user_id', user.id).eq('is_active', true).maybeSingle()
      ok = !!emp && (emp.role === 'founder' || emp.role === 'admin' || emp.del_super === true)
    }
  }
  if (!ok) return json({ error: 'Unauthorized' }, 401)
  if (!KEY) return json({ error: 'MAYTAPI_GRP_API_KEY not set' }, 500)

  const opts = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

  // Session health. When the WhatsApp account is signed out Maytapi keeps answering
  // 200 on every endpoint but getGroups returns success:false — so an empty group list
  // is NOT proof the bot left the groups. Check logged_in before believing it.
  if (opts.action === 'status') {
    const sres = await fetch(`https://api.maytapi.com/api/${PID}/${PHONE}/status`, { headers: { 'x-maytapi-key': KEY } })
    const sbody = await sres.json().catch(() => null)
    const st = (sbody as any)?.status ?? {}
    return json({
      phone_id: PHONE,
      expected_number: GRP_NUMBER,
      logged_in: st.loggedIn === true,
      awaiting_qr_scan: st.isQr === true,
      connected_number: st.number ?? null,
      can_send: st?.state?.canSend ?? null,
    })
  }

  const res = await fetch(`https://api.maytapi.com/api/${PID}/${PHONE}/getGroups`, { headers: { 'x-maytapi-key': KEY } })
  const body = await res.json().catch(() => null)
  if (!res.ok) return json({ error: 'maytapi getGroups failed', status: res.status }, 502)

  // Surface a dead session rather than masquerading it as "zero groups".
  if ((body as any)?.success === false) {
    const err = (body as any)?.data
    return json({
      error: 'maytapi session not ready — the capture number is probably logged out',
      hint: `scan the QR for phone ${PHONE} from WhatsApp on ${GRP_NUMBER}`,
      maytapi: err ?? null,
    }, 503)
  }

  const data = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : [])

  const { data: onboardedRows } = await admin.from('gie_groups').select('provider_group_id')
  const onboarded = new Set((onboardedRows ?? []).map((r: any) => r.provider_group_id))

  const norm = data.map((g: any) => ({
    id: g.id ?? g.jid ?? null,
    name: g.name ?? g.subject ?? null,
    participants: Array.isArray(g.participants) ? g.participants.length : null,
  })).filter((g: any) => g.id)

  if (opts.action === 'onboard') {
    const rows = norm
      .filter((g: any) => !onboarded.has(g.id) && BRAND.test(g.name || ''))
      .map((g: any) => ({
        provider_group_id: g.id,
        name: g.name,
        is_active: opts.activate !== false,
        is_test: false,
        summarise_every_minutes: opts.cadence ?? 30,
        maytapi_phone: GRP_NUMBER,
      }))
    if (rows.length === 0) return json({ requested: 0, inserted: 0, groups: [] })
    const { data: ins, error } = await admin.from('gie_groups')
      .upsert(rows, { onConflict: 'provider_group_id', ignoreDuplicates: true })
      .select('provider_group_id, name')
    if (error) return json({ error: error.message }, 500)
    return json({ requested: rows.length, inserted: ins?.length ?? 0, active: opts.activate !== false, cadence: opts.cadence ?? 30, groups: ins })
  }

  const groups = norm.map((g: any) => ({ ...g, onboarded: onboarded.has(g.id) }))
  return json({ total: groups.length, onboarded_count: groups.filter((g: any) => g.onboarded).length, groups })
})

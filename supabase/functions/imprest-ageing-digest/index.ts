// Daily Imprest & Finance Ageing digest.
// Runs the founder_imprest_ageing RPC with the service role, builds a polished,
// mobile-responsive, NO-LOGIN HTML report, uploads it to the public
// `founder-reports` bucket, and returns a short WhatsApp gist + the report link.
// Called by the n8n "Daily Imprest Ageing Digest to Founder" workflow.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-secret',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SHARED_SECRET = Deno.env.get('N8N_DIGEST_SECRET') ?? 'hagerstone-n8n-secret-2026'
// Unguessable key for the public, no-login report view link (?view=1&k=...).
const REPORT_KEY = Deno.env.get('REPORT_KEY') ?? 'a7f3c9e1b5d24680f9c3a1e7'

const inr = (n: number) => 'Rs.' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const lakh = (n: number) =>
  Math.abs(Number(n)) >= 100000 ? `Rs.${(Number(n) / 100000).toFixed(2)} L` : inr(Number(n))

const STAGE_SHORT: Record<string, string> = {
  s1_pending: 'Stage 1 review', s2_pending: 'Stage 2 review', director_pending: 'Director approval',
  s3_pending: 'Finance review', founder_review_pending: 'Founder gate',
  founder_approved: 'Founder-approved payout', s3_legacy: 'Legacy (never sent to founder)',
}
const OWNER_SHORT: Record<string, string> = {
  s1_pending: 'Avisha', s2_pending: 'Ritu', director_pending: 'Bhaskar Sir',
  s3_pending: 'Finance', founder_review_pending: 'Dhruv Sir',
  founder_approved: 'Finance', s3_legacy: 'Finance',
}

function buildGist(d: any, url: string): string {
  const k = d.kpis
  const pipeline = d.pipeline ?? []

  // Where it's stuck: biggest pile-ups, with who owns each.
  const top = [...pipeline]
    .filter((p: any) => p.count > 0)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 3)
    .map((p: any) => `  - ${STAGE_SHORT[p.stage_key] ?? p.label} (${OWNER_SHORT[p.stage_key] ?? p.owner}): *${p.count}* - ${lakh(p.value)}`)
    .join('\n')

  // What actually needs action - split by who must move it.
  const founderGate = pipeline.find((p: any) => p.stage_key === 'founder_review_pending')?.count ?? 0
  const poLive = (d.po_payments ?? []).filter((p: any) => !p.is_test)
  const poOut = poLive.reduce((a: number, p: any) => a + Number(p.outstanding ?? 0), 0)
  const actions = [
    founderGate ? `  - *${founderGate}* awaiting YOUR approval (founder gate)` : '',
    `  - *${lakh(k.approved_awaiting_payout)}* approved, awaiting Finance payout`,
    poLive.length ? `  - Vendor POs: *${lakh(poOut)}* unpaid (${poLive.length})` : '',
  ].filter(Boolean).join('\n')

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return [
    `*HAGERSTONE - DAILY AGEING REPORT*`,
    `${today}`,
    ``,
    `*${k.stuck_count}* imprests stuck  -  *${lakh(k.gross_value)}* tied up`,
    `Oldest *${k.oldest_days}d*  -  Breach: *${k.breach_gt7}* >7d / *${k.breach_gt30}* >30d / *${k.breach_gt60}* >60d`,
    ``,
    `*Where it's stuck (stage / owner / count):*`,
    top || '  - None',
    ``,
    `*Needs action:*`,
    actions,
    ``,
    `*Tap for the full report (no login):*`,
    url,
    ``,
    `- Hagerstone Finance System`,
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let site: string | null = url.searchParams.get('site')
  if (!site && req.method === 'POST') {
    try { site = (await req.json())?.site ?? null } catch { /* no body */ }
  }
  if (typeof site === 'string' && site.trim() === '') site = null

  // -- DATA MODE: raw JSON for the public (no-login) report page on the hub domain --
  // (Supabase neuters HTML served to anonymous browsers, so the page is rendered on
  //  Vercel and fetches the data here, gated by an unguessable key.)
  if (url.searchParams.get('data')) {
    if (url.searchParams.get('k') !== REPORT_KEY) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const { data, error } = await supabase.rpc('founder_imprest_ageing', { p_site: site })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  // -- DIGEST MODE: short JSON gist for the n8n WhatsApp workflow --
  const provided = req.headers.get('x-n8n-secret') ?? url.searchParams.get('secret')
  if (provided !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const { data, error } = await supabase.rpc('founder_imprest_ageing', { p_site: site })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const reportUrl = `https://hagerstone-hub.vercel.app/r/ageing?k=${REPORT_KEY}`
  return new Response(JSON.stringify({
    message: buildGist(data, reportUrl),
    report_url: reportUrl,
    kpis: data?.kpis ?? null,
    generated_at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})

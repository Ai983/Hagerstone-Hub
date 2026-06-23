// Daily Imprest & Finance Ageing digest — data + formatted WhatsApp brief.
// Called by the n8n "Daily Imprest Ageing Digest to Founder" workflow on a
// schedule. Authenticates with a shared secret (x-n8n-secret header) and runs the
// founder_imprest_ageing RPC with the service role, so the service key never
// leaves Supabase. Returns { message, kpis, generated_at } — n8n forwards
// `message` straight to Maytapi.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-secret',
}

const HUB_URL = 'https://hagerstone-hub.vercel.app/founder'
// Shared secret — matches the convention used across the existing n8n workflows.
// Override by setting the N8N_DIGEST_SECRET function secret.
const SHARED_SECRET = Deno.env.get('N8N_DIGEST_SECRET') ?? 'hagerstone-n8n-secret-2026'

const lakh = (n: number) =>
  Math.abs(Number(n)) >= 100000
    ? `Rs.${(Number(n) / 100000).toFixed(2)} L`
    : `Rs.${Number(n).toLocaleString('en-IN')}`

// Stage → responsible person, so the brief names who is holding each pile-up.
const STAGE_BRIEF: Record<string, string> = {
  s1_pending:             'Stage 1 review · Avisha',
  s2_pending:             'Stage 2 review · HO/Bangalore',
  director_pending:       'Director approval · Bhaskar Sir',
  s3_pending:             'Finance review · Finance team',
  s3_awaiting_founder:    'Awaiting founder gate · Dhruv Sir',
  founder_review_pending: 'Founder gate · Dhruv Sir',
  founder_approved:       'Founder-approved, awaiting payout · Finance team',
  s3_awaiting_payout:     'Finance-approved, awaiting payout · Finance team',
}

function buildMessage(d: any): string {
  const k = d.kpis
  const pipe = (d.pipeline ?? [])
    .filter((s: any) => s.count > 0)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 4)
    .map((s: any) => `  • ${STAGE_BRIEF[s.stage_key] ?? s.label}: *${s.count}* (${lakh(s.value)})`)
    .join('\n')

  const poLive = (d.po_payments ?? []).filter((p: any) => !p.is_test)
  const poOut = poLive.reduce((a: number, p: any) => a + Number(p.outstanding ?? 0), 0)

  // Needs attention: the items sitting longest with one person right now.
  const STAGE_SHORT: Record<string, string> = {
    s1_pending: 'Stage 1', s2_pending: 'Stage 2', director_pending: 'Director',
    s3_pending: 'Finance review', s3_awaiting_founder: 'Awaiting founder gate',
    founder_review_pending: 'Founder gate', founder_approved: 'Awaiting payout',
    s3_awaiting_payout: 'Awaiting payout',
  }
  const attention = [...(d.items ?? [])]
    .sort((a: any, b: any) => (b.days_at_stage ?? 0) - (a.days_at_stage ?? 0))
    .slice(0, 5)
    .map((it: any, i: number) =>
      `${i + 1}. ${it.ref} · ${it.site ?? '—'}\n     ${STAGE_SHORT[it.stage_key] ?? it.stage_key} · with ${it.owner ?? '—'} · *${it.days_at_stage ?? 0}d* (${it.age_days}d total)`)
    .join('\n')

  const oldest = [k.oldest_ref, k.oldest_site].filter(Boolean).join(' · ')

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  return [
    `*HAGERSTONE — DAILY AGEING REPORT*`,
    `${today}`,
    ``,
    `*${k.stuck_count}* imprests stuck in the pipeline · *${lakh(k.gross_value)}* tied up`,
    `Approved & awaiting payout: *${lakh(k.approved_awaiting_payout)}*`,
    `Oldest: *${k.oldest_days}d*${oldest ? ` · ${oldest}` : ''}`,
    `Breach: *${k.breach_gt7}* >7d · *${k.breach_gt30}* >30d · *${k.breach_gt60}* >60d`,
    ``,
    `*Where it's stuck (stage · person · count):*`,
    pipe || '  • None',
    ``,
    `🔴 *Needs attention — longest at one stage:*`,
    attention || '  • None',
    ``,
    `*PO payments:* ${poLive.length} unsettled · *${lakh(poOut)}* outstanding`,
    k.flagged_count ? `\n⚠️ ${k.flagged_count} item(s) flagged for review.` : ``,
    ``,
    `📊 Full detailed report:`,
    HUB_URL,
    ``,
    `— Hagerstone Finance System`,
  ].filter((l) => l !== null && l !== undefined).join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Shared-secret auth — accept header or ?secret= for easy testing.
  const url = new URL(req.url)
  const provided = req.headers.get('x-n8n-secret') ?? url.searchParams.get('secret')
  if (provided !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Optional site scoping via ?site= or JSON body { site }. Empty string /
  // whitespace means "all sites" (null), so the filter isn't applied.
  let site: string | null = url.searchParams.get('site')
  if (!site && req.method === 'POST') {
    try { site = (await req.json())?.site ?? null } catch { /* no body */ }
  }
  if (typeof site === 'string' && site.trim() === '') site = null

  const { data, error } = await supabase.rpc('founder_imprest_ageing', { p_site: site })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    message: buildMessage(data),
    kpis: data?.kpis ?? null,
    link: HUB_URL,
    generated_at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})

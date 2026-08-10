// Combined daily founder brief — Finance (imprest ageing) + Procurement (CPS PR ageing)
// in ONE WhatsApp message. Called by the n8n "WF — Daily Imprest Ageing Digest to Founder"
// workflow at 19:00 IST.
//
// Why one function rather than two n8n HTTP nodes stitched together in an expression:
// n8n MCP edits only ever create drafts (they need a UI publish to go live — see CLAUDE.md
// rule 6), so keeping all message formatting here means future wording changes deploy via
// MCP alone and never require touching n8n again. It's also git-tracked and curl-testable.
//
// Degrades gracefully: if one RPC fails the other section still ships, with a visible note,
// so a procurement outage never silently swallows the founder's finance brief.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-secret',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SHARED_SECRET = Deno.env.get('N8N_DIGEST_SECRET') ?? 'hagerstone-n8n-secret-2026'
const REPORT_KEY = Deno.env.get('REPORT_KEY')

const inr = (n: number) => 'Rs.' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const lakh = (n: number) =>
  Math.abs(Number(n)) >= 100000 ? `Rs.${(Number(n) / 100000).toFixed(2)} L` : inr(Number(n))

// Imprest pipeline stage → short label / owner, mirrors imprest-ageing-digest.
const STAGE_SHORT: Record<string, string> = {
  s1_pending: 'Stage 1 review', s2_pending: 'Stage 2 review', director_pending: 'Director approval',
  s3_pending: 'Finance review', founder_review_pending: 'Founder gate',
  founder_approved: 'Founder-approved payout', s3_legacy: 'Legacy (never sent to founder)',
}
const OWNER_SHORT: Record<string, string> = {
  s1_pending: 'Avisha', s2_pending: 'Ritu', director_pending: 'Bhaskar Sir',
  s3_pending: 'Finance', founder_review_pending: 'Ritu',
  founder_approved: 'Finance', s3_legacy: 'Finance',
}

function financeSection(d: any): string {
  if (!d?.kpis) return '*FINANCE — IMPREST AGEING*\n  - Data unavailable right now.'
  const k = d.kpis
  const pipeline = d.pipeline ?? []

  // Biggest live pile-ups, with who owns each. Legacy/anomaly stage excluded from the glance.
  const top = [...pipeline]
    .filter((p: any) => p.count > 0 && p.stage_key !== 's3_legacy')
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 3)
    .map((p: any) => `  - ${STAGE_SHORT[p.stage_key] ?? p.label} (${OWNER_SHORT[p.stage_key] ?? p.owner}): *${p.count}* - ${lakh(p.value)}`)
    .join('\n')

  const poLive = (d.po_payments ?? []).filter((p: any) => !p.is_test)
  const poOut = poLive.reduce((a: number, p: any) => a + Number(p.outstanding ?? 0), 0)
  const money = [
    `  - *${lakh(k.approved_awaiting_payout)}* approved, awaiting Finance payout`,
    poLive.length ? `  - Vendor POs: *${lakh(poOut)}* unpaid (${poLive.length})` : '',
  ].filter(Boolean).join('\n')

  return [
    `*FINANCE — IMPREST AGEING*`,
    `*${k.stuck_count}* stuck  -  *${lakh(k.gross_value)}* tied up  -  oldest *${k.oldest_days}d*`,
    `Breach: *${k.breach_gt7}* >7d / *${k.breach_gt30}* >30d / *${k.breach_gt60}* >60d`,
    ``,
    `_Where it's stuck:_`,
    top || '  - None',
    ``,
    `_Money to release:_`,
    money,
  ].join('\n')
}

function procurementSection(d: any): string {
  if (!d?.kpis) return '*PROCUREMENT — PR AGEING*\n  - Data unavailable right now.'
  const k = d.kpis
  const byOwner = [...(d.by_owner ?? [])]
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 5)
    .map((o: any) => `  - *${o.owner}*: ${o.count} PR${o.count === 1 ? '' : 's'} - oldest ${o.oldest}d, avg ${o.avg}d`)
    .join('\n')

  return [
    `*PROCUREMENT — PR AGEING*`,
    `*${k.stuck_count}* PRs stuck pre-PO  -  oldest *${k.oldest_days}d* (${k.oldest_ref ?? '-'}, ${k.oldest_owner ?? '-'})`,
    `Breach: *${k.breach_gt7}* >7d / *${k.breach_gt15}* >15d / *${k.breach_gt30}* >30d`,
    ``,
    `_Stuck with:_`,
    byOwner || '  - None',
  ].join('\n')
}

function buildBrief(fin: any, cps: any, hubBase: string): string {
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const reportUrl = `${hubBase}/r/ageing?k=${REPORT_KEY}`
  return [
    `*HAGERSTONE - DAILY AGEING BRIEF*`,
    today,
    ``,
    financeSection(fin),
    ``,
    procurementSection(cps),
    ``,
    `*Full reports (no login):*`,
    `Finance: ${reportUrl}`,
    `Procurement: ${reportUrl}&tab=cps`,
    ``,
    `- Hagerstone Ops`,
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const provided = req.headers.get('x-n8n-secret') ?? url.searchParams.get('secret')
  if (provided !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Both RPCs in parallel; either may fail independently without sinking the whole brief.
  const [finRes, cpsRes] = await Promise.all([
    supabase.rpc('founder_imprest_ageing', { p_site: null }),
    supabase.rpc('founder_cps_pr_ageing', { p_project: null }),
  ])

  // Only a total failure of BOTH is worth erroring on — otherwise ship what we have.
  if (finRes.error && cpsRes.error) {
    return new Response(JSON.stringify({
      error: `both RPCs failed: ${finRes.error.message} | ${cpsRes.error.message}`,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
  return new Response(JSON.stringify({
    message: buildBrief(finRes.data, cpsRes.data, hubBase),
    finance_kpis: finRes.data?.kpis ?? null,
    procurement_kpis: cpsRes.data?.kpis ?? null,
    degraded: Boolean(finRes.error || cpsRes.error),
    errors: [finRes.error?.message, cpsRes.error?.message].filter(Boolean),
    generated_at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})

// Daily CPS Purchase-Requisition Ageing digest — "which procurement head is a PR stuck
// with, and for how many days". Same shape as imprest-ageing-digest: runs the
// founder_cps_pr_ageing RPC with the service role and serves either a JSON gist (for the
// n8n WhatsApp workflow) or raw JSON (for the public no-login report page on the hub domain).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-n8n-secret',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SHARED_SECRET = Deno.env.get('N8N_DIGEST_SECRET') ?? 'hagerstone-n8n-secret-2026'
// Same unguessable key as the imprest digest — one key gates both public reports.
const REPORT_KEY = Deno.env.get('REPORT_KEY')

function buildGist(d: any, url: string): string {
  const k = d.kpis
  const byOwner = [...(d.by_owner ?? [])].sort((a: any, b: any) => b.count - a.count).slice(0, 5)

  const ownerLines = byOwner
    .map((o: any) => `  - *${o.owner}*: ${o.count} PR${o.count === 1 ? '' : 's'} - oldest ${o.oldest}d, avg ${o.avg}d`)
    .join('\n')

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return [
    `*HAGERSTONE - CPS PR AGEING*`,
    `${today}`,
    ``,
    `*${k.stuck_count}* PRs stuck pre-PO  -  oldest *${k.oldest_days}d* (${k.oldest_ref ?? '—'}, with ${k.oldest_owner ?? '—'})`,
    `Breach: *${k.breach_gt7}* >7d  /  *${k.breach_gt15}* >15d  /  *${k.breach_gt30}* >30d`,
    ``,
    `*Stuck with (procurement head):*`,
    ownerLines || '  - None',
    ``,
    `*Tap for the full report (no login):*`,
    url,
    ``,
    `- Hagerstone Procurement System`,
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let project: string | null = url.searchParams.get('project')
  if (!project && req.method === 'POST') {
    try { project = (await req.json())?.project ?? null } catch { /* no body */ }
  }
  if (typeof project === 'string' && project.trim() === '') project = null

  // -- DATA MODE: raw JSON for the public (no-login) report page --
  if (url.searchParams.get('data')) {
    if (url.searchParams.get('k') !== REPORT_KEY) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const { data, error } = await supabase.rpc('founder_cps_pr_ageing', { p_project: project })
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
  const { data, error } = await supabase.rpc('founder_cps_pr_ageing', { p_project: project })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const hubBase = Deno.env.get('HUB_PUBLIC_URL') ?? 'https://hagerstone-hub.vercel.app'
  const reportUrl = `${hubBase}/r/ageing?k=${REPORT_KEY}&tab=cps`
  return new Response(JSON.stringify({
    message: buildGist(data, reportUrl),
    report_url: reportUrl,
    kpis: data?.kpis ?? null,
    generated_at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})

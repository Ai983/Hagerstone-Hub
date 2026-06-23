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
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const STAGE_SHORT: Record<string, string> = {
  s1_pending: 'Stage 1', s2_pending: 'Stage 2', director_pending: 'Director',
  s3_pending: 'Finance review', s3_awaiting_founder: 'Awaiting founder gate',
  founder_review_pending: 'Founder gate', founder_approved: 'Awaiting payout',
  s3_awaiting_payout: 'Awaiting payout',
}
const BAND = {
  '0-7': '#1B9E8A', '8-15': '#E0B43A', '16-30': '#E07B2E', '31-60': '#C24A30', '60+': '#7E241A',
} as Record<string, string>
const BANDS = ['0-7', '8-15', '16-30', '31-60', '60+']
const bandOf = (d: number) => d <= 7 ? '0-7' : d <= 15 ? '8-15' : d <= 30 ? '16-30' : d <= 60 ? '31-60' : '60+'
const chip = (d: number) =>
  `<span style="background:${BAND[bandOf(d)]};color:#fff;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:600">${d}d</span>`

function buildHtml(d: any): string {
  const k = d.kpis
  const asOf = new Date(d.as_of).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const kpiCards = [
    { l: 'Imprests stuck', v: String(k.stuck_count), s: `${k.stuck_count - k.flagged_count} open  -  ${k.flagged_count} flagged` },
    { l: 'Gross value tied up', v: lakh(k.gross_value), s: 'requested, all stuck' },
    { l: 'Approved & awaiting payout', v: lakh(k.approved_awaiting_payout), s: 'cash cleared, not paid' },
    { l: 'Oldest stuck item', v: `${k.oldest_days}d`, s: `${esc(k.oldest_ref)}  -  ${esc(k.oldest_site)}`, accent: true },
    { l: 'Ageing breach', v: String(k.breach_gt7), s: `>7d | ${k.breach_gt30} >30d | ${k.breach_gt60} >60d` },
    { l: 'Primary bottleneck', v: String(k.bottleneck_count), s: esc(k.bottleneck_stage) },
  ].map((c) => `<div class="kpi${c.accent ? ' accent' : ''}"><div class="kl">${c.l}</div><div class="kv">${c.v}</div><div class="ks">${c.s}</div></div>`).join('')

  // Needs attention - longest at one stage
  const attention = [...(d.items ?? [])]
    .sort((a: any, b: any) => (b.days_at_stage ?? 0) - (a.days_at_stage ?? 0))
    .slice(0, 8)
    .map((it: any, i: number) => `<tr>
      <td class="mono">${i + 1}</td>
      <td class="mono">${esc(it.ref)}</td>
      <td>${esc(it.requester)}</td>
      <td>${esc(it.site ?? '-')}</td>
      <td>${esc(STAGE_SHORT[it.stage_key] ?? it.stage_key)}</td>
      <td><b>${esc(it.owner)}</b></td>
      <td style="text-align:right">${chip(it.days_at_stage)}</td>
      <td style="text-align:right" class="mono">${it.age_days}d</td>
    </tr>`).join('')

  // Pipeline / matrix
  const pipeRows = (d.pipeline ?? []).map((s: any) => {
    const tot = BANDS.reduce((a, b) => a + (s.bands[b] ?? 0), 0) || 1
    const spread = BANDS.filter((b) => s.bands[b] > 0).map((b) =>
      `<span title="${s.bands[b]} in ${b}d" style="width:${(s.bands[b] / tot) * 100}%;background:${BAND[b]}"></span>`).join('')
    const cells = BANDS.map((b) => s.bands[b] > 0
      ? `<td style="text-align:center"><span style="background:${BAND[b]};color:#fff;padding:2px 7px;border-radius:5px;font-weight:600;font-size:12px">${s.bands[b]}</span></td>`
      : `<td style="text-align:center;color:#cbd5e1"> - </td>`).join('')
    return `<tr>
      <td><b>${esc(s.label)}</b><div class="sub">${esc(s.owner)}</div>
        <div class="spread">${spread}</div></td>
      ${cells}
      <td style="text-align:center"><b>${s.count}</b></td>
      <td style="text-align:right" class="mono">${inr(s.value)}</td>
    </tr>`
  }).join('')

  // Stuck items (interactive)
  const stageBtns = (d.pipeline ?? []).filter((s: any) => s.count > 0)
    .map((s: any) => `<button class="chip" data-stage="${s.stage_key}">${esc(STAGE_SHORT[s.stage_key] ?? s.label)} (${s.count})</button>`).join('')
  const itemRows = (d.items ?? []).map((it: any) => `<tr data-stage="${it.stage_key}" data-band="${it.band}"
      data-search="${esc(((it.ref || '') + ' ' + (it.site || '') + ' ' + (it.requester || '') + ' ' + (it.owner || '')).toLowerCase())}"
      data-amt="${it.amount}" data-stagedays="${it.days_at_stage}" data-age="${it.age_days}">
      <td class="mono">${esc(it.ref)}${it.flag ? ' <span title="data flag" style="color:#C24A30">(!)</span>' : ''}</td>
      <td>${esc(STAGE_SHORT[it.stage_key] ?? it.stage_key)}</td>
      <td><b>${esc(it.owner)}</b></td>
      <td>${esc(it.site ?? '-')}</td>
      <td>${esc(it.requester)}</td>
      <td style="text-align:right" class="mono">${inr(it.amount)}</td>
      <td style="text-align:right" class="mono">${it.net_payable === null ? '-' : inr(it.net_payable)}</td>
      <td style="text-align:right">${chip(it.days_at_stage)}</td>
      <td style="text-align:right">${chip(it.age_days)}</td>
    </tr>`).join('')

  const concRows = (rows: any[]) => rows.slice(0, 12).map((r: any) => `<tr>
      <td>${esc(r.name)}</td><td style="text-align:right">${r.items}</td>
      <td style="text-align:right">${r.gt30 || ' - '}</td>
      <td style="text-align:right" class="mono">${inr(r.gross)}</td>
      <td style="text-align:right">${chip(r.oldest)}</td></tr>`).join('')

  const poLive = (d.po_payments ?? []).filter((p: any) => !p.is_test)
  const poOut = poLive.reduce((a: number, p: any) => a + Number(p.outstanding ?? 0), 0)
  const poRows = (d.po_payments ?? []).map((p: any) => `<tr${p.is_test ? ' style="opacity:.5;font-style:italic"' : ''}>
      <td class="mono">${esc(p.ref)}</td><td>${esc(p.supplier ?? '-')}</td>
      <td class="sub">${esc((p.project ?? '-').slice(0, 40))}</td>
      <td>${p.status === 'partially_paid' ? 'Partially paid' : 'Pending'}</td>
      <td style="text-align:right" class="mono">${inr(p.po_value)}</td>
      <td style="text-align:right" class="mono">${p.paid ? inr(p.paid) : '-'}</td>
      <td style="text-align:right" class="mono" style="color:#C24A30"><b>${inr(p.outstanding)}</b></td>
      <td style="text-align:right">${chip(p.age_days)}</td></tr>`).join('')

  const g = d.integrity
  const integ = [
    g.paid_not_closed?.length ? `<li><b>${g.paid_not_closed.length} marked paid but stage not closed</b> - ${g.paid_not_closed.map(esc).join(', ')}.</li>` : '',
    g.rejected_in_pipeline?.length ? `<li><b>${g.rejected_in_pipeline.length} rejected but still in the pipeline</b> - ${g.rejected_in_pipeline.map(esc).join(', ')}.</li>` : '',
    g.zero_net_count ? `<li><b>${g.zero_net_count} approved items have Rs.0 net payable</b> (offset against an earlier unpaid advance) - nothing to disburse, but never closed.</li>` : '',
    `<li>Ageing is computed from submission date and genuine stage-entry timestamps, not <code>updated_at</code>.</li>`,
  ].join('')

  const SCRIPT = `
  var rows=[].slice.call(document.querySelectorAll('#tb tr'));
  var sF='all',bF='all',q='';
  function apply(){var n=0;rows.forEach(function(r){
    var ok=(sF==='all'||r.dataset.stage===sF)&&(bF==='all'||r.dataset.band===bF)&&(q===''||r.dataset.search.indexOf(q)>-1);
    r.style.display=ok?'':'none';if(ok)n++;});document.getElementById('cnt').textContent=n+' of '+rows.length;}
  document.querySelectorAll('[data-stage]').forEach(function(b){if(b.tagName==='BUTTON')b.onclick=function(){
    document.querySelectorAll('.chip.sg').forEach(function(x){x.classList.remove('on')});b.classList.add('on');sF=b.dataset.stage;apply();};});
  document.querySelectorAll('[data-bk]').forEach(function(b){b.onclick=function(){
    document.querySelectorAll('[data-bk]').forEach(function(x){x.classList.remove('on')});b.classList.add('on');bF=b.dataset.bk;apply();};});
  document.getElementById('q').oninput=function(e){q=e.target.value.toLowerCase().trim();apply();};
  var st={};document.querySelectorAll('th[data-sort]').forEach(function(th){th.onclick=function(){
    var key=th.dataset.sort,dir=st[key]==='d'?'a':'d';st={};st[key]=dir;
    rows.sort(function(a,b){var av=parseFloat(a.dataset[key])||0,bv=parseFloat(b.dataset[key])||0;return dir==='d'?bv-av:av-bv;});
    var tb=document.getElementById('tb');rows.forEach(function(r){tb.appendChild(r);});};});
  apply();`

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hagerstone - Imprest &amp; Finance Ageing</title>
<style>
:root{--ink:#14213D;--paper:#F3F5F7;--line:#E2E7EE;--muted:#5C6B80}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);
font-family:-apple-system,Segoe UI,Roboto,system-ui,sans-serif;font-size:14px;line-height:1.5}
.mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace}
.wrap{max-width:1180px;margin:0 auto;padding:18px 14px 70px}
.mast{background:var(--ink);color:#fff;border-radius:12px;padding:20px 22px}
.mast h1{margin:0 0 4px;font-size:21px}.mast .sub{color:#9FB2CC;font-size:12px}
.asof{display:inline-block;margin-top:8px;background:rgba(255,255,255,.12);border-radius:6px;padding:4px 10px;font-size:12px}
h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);border-bottom:2px solid var(--ink);padding-bottom:7px;margin:30px 0 12px}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
.kpi{background:#fff;border:1px solid var(--line);border-top:3px solid var(--ink);border-radius:9px;padding:12px}
.kpi.accent{border-top-color:#7E241A}
.kl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;min-height:26px}
.kv{font-size:25px;font-weight:700;margin:6px 0 4px}.ks{font-size:11px;color:#8794A6}
.card{background:#fff;border:1px solid var(--line);border-radius:9px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#EDF1F6;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);padding:9px 10px;font-weight:600;white-space:nowrap}
td{padding:8px 10px;border-top:1px solid #EEF1F5;vertical-align:top}
.sub{font-size:11px;color:#8794A6}
.scroll{overflow-x:auto}.scroll table{min-width:760px}
.spread{display:flex;height:6px;border-radius:4px;overflow:hidden;margin-top:6px;background:#EEF1F5;gap:1px;max-width:260px}
.attention .card{border-left:4px solid #C24A30}
.tools{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:10px}
.chip{font-size:12px;border:1px solid var(--line);background:#fff;border-radius:20px;padding:5px 11px;cursor:pointer}
.chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
#q{font-size:13px;padding:8px 11px;border:1px solid var(--line);border-radius:7px;width:260px;max-width:100%}
th[data-sort]{cursor:pointer}th[data-sort]:hover{color:var(--ink)}
.cnt{font-size:12px;color:var(--muted)}
.gw{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.intg{background:#fff;border:1px solid var(--line);border-left:4px solid #C24A30;border-radius:9px;padding:14px 18px}
.intg li{margin:7px 0}
.foot{margin-top:26px;text-align:center;font-size:11px;color:#8794A6}
@media(max-width:860px){.kpis{grid-template-columns:repeat(2,1fr)}.gw{grid-template-columns:1fr}.mast h1{font-size:18px}}
</style></head><body><div class="wrap">

<div class="mast"><div class="sub">FINANCE SYSTEM  -  HAGERSTONE HUB</div>
<h1>Imprest &amp; Finance Ageing Report</h1>
<div class="sub">Every in-flight imprest &amp; vendor payment not yet paid - where it's stuck, with whom, and for how long. Live data.</div>
<div class="asof">As of ${esc(asOf)}</div></div>

<h2>Company snapshot</h2>
<div class="kpis">${kpiCards}</div>

<h2>Needs attention - longest at one stage</h2>
<div class="attention card scroll"><table>
<thead><tr><th>#</th><th>Ref</th><th>Requester</th><th>Site</th><th>Stage</th><th>With</th><th style="text-align:right">At stage</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${attention}</tbody></table></div>

<h2>Where it's stuck - stage  -  owner  -  age spread</h2>
<div class="card scroll"><table>
<thead><tr><th>Stage &amp; owner</th>${BANDS.map((b) => `<th style="text-align:center">${b}d</th>`).join('')}<th style="text-align:center">Total</th><th style="text-align:right">Value</th></tr></thead>
<tbody>${pipeRows}</tbody></table></div>

<h2>All stuck imprests (${(d.items ?? []).length})</h2>
<div class="tools">
  <button class="chip sg on" data-stage="all">All</button>${stageBtns.replace(/class="chip"/g, 'class="chip sg"')}
</div>
<div class="tools">
  <button class="chip on" data-bk="all">Any age</button>
  ${BANDS.map((b) => `<button class="chip" data-bk="${b}" style="border-color:${BAND[b]}">${b}d</button>`).join('')}
  <input id="q" type="search" placeholder="Search ref, site, person...">
  <span class="cnt" id="cnt"></span>
</div>
<div class="card scroll"><table>
<thead><tr><th>Ref</th><th>Stage</th><th>With</th><th>Site</th><th>Requester</th>
<th data-sort="amt" style="text-align:right">Requested</th><th style="text-align:right">Net payable</th>
<th data-sort="stagedays" style="text-align:right">At stage</th><th data-sort="age" style="text-align:right">Waiting</th></tr></thead>
<tbody id="tb">${itemRows}</tbody></table></div>

<h2>Concentration - where value &amp; age cluster</h2>
<div class="gw">
  <div class="card scroll"><table><thead><tr><th>Site / project</th><th style="text-align:right">Items</th><th style="text-align:right">&gt;30d</th><th style="text-align:right">Gross</th><th style="text-align:right">Oldest</th></tr></thead><tbody>${concRows(d.concentration_site ?? [])}</tbody></table></div>
  <div class="card scroll"><table><thead><tr><th>Category</th><th style="text-align:right">Items</th><th style="text-align:right">&gt;30d</th><th style="text-align:right">Gross</th><th style="text-align:right">Oldest</th></tr></thead><tbody>${concRows(d.concentration_category ?? [])}</tbody></table></div>
</div>

<h2>PO payments - vendor settlements not cleared</h2>
<div class="card scroll"><table>
<thead><tr><th>PO ref</th><th>Supplier</th><th>Project</th><th>Status</th><th style="text-align:right">PO value</th><th style="text-align:right">Paid</th><th style="text-align:right">Outstanding</th><th style="text-align:right">Waiting</th></tr></thead>
<tbody>${poRows}</tbody></table></div>
<p class="sub" style="margin-top:8px">${poLive.length} live unsettled PO(s) carrying <b>${inr(poOut)}</b> outstanding.</p>

<h2>Data integrity &amp; caveats</h2>
<div class="intg"><ul>${integ}</ul></div>

<div class="foot">Hagerstone International - internal finance controls report  -  generated ${esc(asOf)} from live data</div>
</div>
<script>${SCRIPT}</script>
</body></html>`
}

function buildGist(d: any, url: string): string {
  const k = d.kpis
  const attention = [...(d.items ?? [])]
    .sort((a: any, b: any) => (b.days_at_stage ?? 0) - (a.days_at_stage ?? 0))
    .slice(0, 3)
    .map((it: any, i: number) =>
      `${i + 1}. ${it.ref}  -  ${it.requester} - ${it.owner}  -  *${it.days_at_stage}d*`)
    .join('\n')
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return [
    `*HAGERSTONE - DAILY AGEING REPORT*`,
    `${today}`,
    ``,
    `*${k.stuck_count}* imprests stuck  -  *${lakh(k.gross_value)}* tied up`,
    `Oldest *${k.oldest_days}d*  -  Breach: *${k.breach_gt7}* >7d / *${k.breach_gt30}* >30d / *${k.breach_gt60}* >60d`,
    ``,
    `*Needs attention (longest at one stage):*`,
    attention || '  - None',
    ``,
    `*Tap for the full report (no login needed):*`,
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

  // ── VIEW MODE: render the live, no-login HTML report (gated by an unguessable key) ──
  if (url.searchParams.get('view')) {
    if (url.searchParams.get('k') !== REPORT_KEY) {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } })
    }
    const { data, error } = await supabase.rpc('founder_imprest_ageing', { p_site: site })
    if (error) return new Response('Error: ' + error.message, { status: 500, headers: { 'Content-Type': 'text/plain' } })
    return new Response(buildHtml(data), { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } })
  }

  // ── DIGEST MODE: short JSON gist for the n8n WhatsApp workflow ──
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
  const reportUrl = `${SUPABASE_URL}/functions/v1/imprest-ageing-digest?view=1&k=${REPORT_KEY}`
  return new Response(JSON.stringify({
    message: buildGist(data, reportUrl),
    report_url: reportUrl,
    kpis: data?.kpis ?? null,
    generated_at: new Date().toISOString(),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})

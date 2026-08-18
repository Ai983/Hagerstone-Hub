# Hagerstone Hub — Infrastructure Cost Reduction Report

**Date:** 16 July 2026
**Prepared from:** live billing screenshots (Railway, Supabase, Claude Console), live database/n8n/MCP inspection, and full code inventory of `hagerstone-hub`, `hagerstone-cps`, and the Hiring System.

---

## 1. Executive Summary

| | |
|---|---|
| **Current total spend** | **~₹15,400 / month (~$178)** |
| **Target after all fixes** | **~₹5,700–6,700 / month** |
| **Reduction** | **≈ 60%** |
| **Migrations off any platform required** | Only Maytapi. Supabase, Railway, and Claude stay — optimized, not replaced. |

**One urgent, non-cost item:** the Claude Console showed **$28.59 spent of a $30 monthly limit (95%), $3.35 credit remaining, auto-reload OFF**. When it runs out, GIE, CPS document parsing, the founder chatbot, and delegation scoring all stop. Buy credits / enable auto-reload before anything else.

---

## 2. Verified Current Costs (July 2026)

| Service | Monthly cost | Source |
|---|---|---|
| Maytapi (2 WhatsApp numbers) | **₹5,600** (₹2,800 × 2) | User-confirmed price |
| Claude API credits | **~₹4,900** ($28.59 in 15 days → ~$57/mo pace) | Console billing page |
| Supabase (Pro org, 3 projects) | **₹3,800** ($43.92 projected) | Org billing page |
| Railway (n8n + Finance backend) | **₹1,100** ($12.63, rising: $9.80 → $11.43 → $12.63) | Billing history |
| **Total** | **~₹15,400 (~$178)** | |

Also discovered: the Hiring System's `screen-resume` function calls **OpenAI GPT-4o** — a separate OpenAI bill not yet reviewed.

---

## 3. Service-by-Service Findings & Plan

### 3.1 Maytapi — ₹5,600 → ~₹500–1,100 (biggest saving)

**Why two numbers exist (verified in code — this is deliberate, not waste):**
- **Business number (phone 46821):** transactional 1:1 sender — imprest confirmations, founder/director approval requests *and their YES/OK replies*, RFQ/PO dispatches to suppliers, task alerts.
- **"Ma'am's number" (phone 141590 / 918882979328):** a member of **all HSIPL WhatsApp groups** — GIE/Command Center captures every group message through it (~5,700/month) and posts @mention task assignments. Chosen because it was already trusted inside every group.
- One number can't trivially do both: each Maytapi phone has a single inbound webhook (group capture vs approval replies would collide), the business number isn't in the groups, and a single number concentrates ban/logout risk — a logout already silently killed GIE capture once.

**Plan (two phases):**
1. **Business number → Meta's official WhatsApp Cloud API.** India pricing: utility templates ₹0.115–0.145/msg, all replies + 24-h service-window messages free. At ~2,000 msgs/month ≈ **₹250/mo vs ₹2,800**. Bonus: approval flows become **ban-proof** (official rails). Work: Meta business verification, ~6–8 utility templates, rewrite `sendWhatsApp()` in `_shared/maytapi.ts` + n8n send/reply nodes.
2. **Group number → self-hosted Evolution API or WAHA** (free, open-source, Docker on existing Railway; full group capture/send/@mention support; REST + webhooks like Maytapi). Incremental cost = a few hundred ₹ of compute. Same ban risk as Maytapi (both unofficial); run in parallel 2 weeks before cutover and wire the existing session-status check to alert on logout. Hosted fallback if self-managing is unwanted: WAAPI at ~$10/number.
- **Rejected — Slack/Teams company-wide:** Slack Pro ≈ ₹245/user/mo × 50–100 staff = ₹12,000–25,000/mo (costs *more* than the entire current stack), free tier hides history after 90 days, and vendors/directors/site groups live on WhatsApp — GIE would lose its data source. Not a cost-reduction path.
- Quick wins meanwhile: switch Maytapi to annual billing ($24 vs $29/number ≈ ₹950/mo saved); confirm dead sandbox slot 145466 isn't billed.

### 3.2 Claude API — ~₹4,900 → ~₹2,200–2,600 (no model downgrades needed)

**Complete model inventory (verified in code + n8n):**

| Component | Model | Notes |
|---|---|---|
| GIE summarise (30-min cron) | Sonnet 4.6 | ~₹1,600/mo measured via `gie_summaries` token log. **Must stay Sonnet** — Haiku tested at 74% recall on director instructions |
| Founder chatbot | Sonnet 4.6 | 34 msgs/month — negligible |
| Delegation scoring (n8n) | Haiku 4.5 (800 max tokens) | already cheapest |
| CPS: all 15 document-parse flows | **claude-proxy forces Haiku 4.5** regardless of requested model | already cheapest |
| CPS: market-rate-search | Haiku 4.5 + web_search | **438 web searches** in 15 days ≈ ₹400 |
| CPS: InvoiceUpload.tsx | Haiku 4.5 — **direct browser call with `VITE_`-exposed API key** | security + unbounded cost leak |
| PMS Daily Digest (n8n) | Sonnet 4.6 | inactive — ₹0 |
| Hiring: screen-resume | **OpenAI GPT-4o** (separate bill) | ~8× Haiku's input price |

**Key insight from the usage page:** 8.8M tokens IN vs 1.06M OUT — cost is dominated by *what is sent* (document images, repeated prompts), not by model tier. Everything high-volume is already on Anthropic's cheapest model.

**Rejected — self-hosting open models:** a vision-capable model (Qwen-VL / Llama-vision class) needs a 24/7 GPU ≈ ₹12,000–25,000/mo — 3–5× the entire Claude bill. Self-hosting only pays above ~$500/mo API spend.

**Actions (in order of impact):**
1. Fix `InvoiceUpload.tsx`: rotate the exposed key, route through claude-proxy.
2. Downscale images (~1,500px) + send only relevant PDF pages before parse calls → est. 30–50% off the CPS input volume.
3. market-rate-search cache TTL 7 → 30 days; check the retry loop doesn't double the searches.
4. Verify prompt-cache hit rate (Console → Caching); a broken cache silently costs ~90% extra on repeated prompts.
5. Split the single `finance-mangement` key into per-system keys for attribution.
6. Move `screen-resume` off GPT-4o → GPT-4o-mini or Haiku via the proxy; disable the "BOQ-Testing-Model" key if testing is done.
7. *(Optional phase 2)* swap claude-proxy's upstream to Gemini Flash-Lite class for parses (5–10× cheaper than Haiku) — one file, but needs real testing of all 15 parse flows.

### 3.3 Supabase — ₹3,800 → ₹2,150 (zero code changes)

- Org is Pro ($25) + 3 Micro compute instances ($6.99 each, −$10 credit). All usage is tiny: DBs 69/12/12 MB, storage 2.1 GB.
- **Action: transfer Hager-Website + Hiring System (12 MB each) to a new Free-plan organization** via dashboard (Settings → General → Transfer project). Project refs/URLs unchanged → **no code or n8n edits**; 1–2 min downtime each. Pro org keeps only Hub; its compute is fully covered by the credit → flat **$25/mo**.
- Two free-tier caveats, both solvable: (a) 7-day inactivity pause → one n8n daily keep-alive query per project; (b) no backups → add both to the existing `pg_dump` routine (BACKUP_RUNBOOK.md).
- Hub itself stays Pro: 2.1 GB storage exceeds free cap, needs daily backups, must never auto-pause.
- **Rejected — platform migration** (Firebase / Neon / Appwrite / PocketBase / self-host): the stack is welded to Supabase (supabase-js in 3 frontends + backend, PostgREST schema routing, ~60 RLS policies, 15 edge functions, storage, pg_cron, 41 n8n workflows). Alternatives are the same price ($25), lack half the stack (Neon), or require a NoSQL rewrite (Firebase). Payback measured in years for a ₹1,650/mo ceiling.

### 3.4 Railway — ₹1,100 → ~₹800 (stay, tune)

- $12.63/mo = $5 Hobby fee + ~$7.63 usage for n8n + Finance Express backend. Normal band for this footprint; n8n Cloud alternative costs ₹2,100+.
- Bill is creeping because n8n stores **74,000+ executions** forever (GIE Capture fires per group message). **Actions:** `EXECUTIONS_DATA_PRUNE=true` + `EXECUTIONS_DATA_MAX_AGE=336`; turn off "save successful executions" on GIE Capture; right-size service memory.
- **Rejected — migration:** Hetzner VPS (~₹350/mo) saves only ~₹750 but makes you the 2 AM sysadmin for the pipeline that runs founder approvals; Oracle Cloud free tier (₹0) has documented instance reclamation — unacceptable for payment-critical flows. Optional later: Finance backend → Vercel free tier, leaving only n8n on Railway (~$8/mo).

---

## 4. Priority Roadmap — easiest first

| # | Action | Effort | Saves / value | Risk |
|---|---|---|---|---|
| 0 | **Claude credits top-up + auto-reload** | 5 min (dashboard) | Prevents total automation outage within days | none |
| 1 | Railway: execution pruning + save-success off on GIE Capture | 15–30 min (settings) | ~₹300/mo + stops bill creep | none |
| 2 | market-rate-search cache TTL 7→30 days | 1-line code change | ~₹300–400/mo | none |
| 3 | Maytapi annual billing + verify 145466 not billed | 10 min (dashboard) | ~₹950/mo (until migration lands) | none |
| 4 | Supabase: transfer 2 projects to free org + keep-alive + backup jobs | ~1 hour | ₹1,650/mo | 1–2 min downtime each |
| 5 | Rotate exposed `VITE_ANTHROPIC_API_KEY` + route InvoiceUpload via claude-proxy | 2–3 hours | Closes unbounded cost/security leak | low |
| 6 | Split Claude API keys per system; move screen-resume off GPT-4o; kill test keys | 2–3 hours | attribution + ~₹200–500/mo | low |
| 7 | Verify prompt-cache hit rate, fix invalidators if found | half day | up to ~₹500–800/mo if broken | low |
| 8 | Image downscaling + PDF page selection in CPS upload flows | 1–2 days | ~₹800–1,500/mo | needs parse-quality testing |
| 9 | **Maytapi Phase 1:** business number → Meta Cloud API | 1–2 weeks (verification + templates + rewiring) | ~₹2,550/mo + ban-proof approvals | medium — parallel-run before cutover |
| 10 | **Maytapi Phase 2:** group number → self-hosted Evolution API/WAHA on Railway | 1–2 weeks incl. 2-week parallel run | ~₹2,300–2,600/mo | medium — self-managed session; wire logout alerts |
| 11 | *(Optional)* claude-proxy upstream → Gemini Flash-Lite for parses | 2–3 days + testing | ~₹800–1,200/mo | medium — vision behavior differs |
| 12 | *(Optional)* Finance backend → Vercel free tier | 1–2 days | ~₹300/mo | medium — URL re-pointing everywhere |

**Items 0–4 are a single afternoon and lock in ~₹3,200/month before any real engineering starts.** Items 9–10 are the big prize (~₹4,900/mo combined) and should each run in parallel with the old path before cutover.

---

## 5. End State

| Service | Now | After |
|---|---|---|
| Maytapi → Meta Cloud API + Evolution/WAHA | ₹5,600 | ~₹500–1,100 |
| Claude API (optimized, same models) | ~₹4,900 | ~₹2,200–2,600 |
| Supabase (Hub on Pro, 2 projects free) | ₹3,800 | ₹2,150 |
| Railway (tuned) | ₹1,100 | ~₹800 |
| **Total** | **~₹15,400** | **~₹5,700–6,700 (≈ 60% cut)** |

*Numbers converted at ~₹86/$. Claude figures assume July's usage pace; re-baseline after the input-token fixes land.*

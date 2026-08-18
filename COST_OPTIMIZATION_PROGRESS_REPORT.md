# Hagerstone Hub — Cost Optimization Progress Report

**Report date:** 17 July 2026
**Covers:** work completed in this optimization session
**Baseline (before):** ~₹15,400/month (~$178) — per [COST_REDUCTION_REPORT.md](COST_REDUCTION_REPORT.md)

---

## 1. Executive Summary

| | |
|---|---|
| **Savings banked this session** | **~₹3,600–4,400 / month** |
| **Biggest single item done** | Command system taken down (~₹1,600/mo of Claude Sonnet) |
| **Biggest item still pending** | Cancel group Maytapi number (~₹2,800/mo — confirmed safe) |
| **New estimated bill** | ~₹11,000–11,800/mo (before Maytapi cuts) |
| **Risk profile** | All changes low-risk; nothing broke; all verified |

Everything below is **done and verified** unless explicitly marked pending.

---

## 2. Optimizations Completed

### 2.1 Command / WhatsApp system taken down — ~₹1,600/mo ✅
- The WhatsApp command system (GIE / Command Center) was disabled.
  - Frontend: Command Center route + nav button disabled (Hub repo commit `c928055`).
  - Backend: GIE Capture + Summary Schedule n8n workflows unpublished.
- **Verified from the database:** `gie_summaries` shows **zero new rows since 2026-07-16 04:07 UTC** and **zero after the disable** — proving the expensive Sonnet calls have actually stopped (not just a UI toggle).
- **Note:** this stops the *AI/variable* cost. The group Maytapi *subscription* (₹2,800/mo, fixed) keeps billing until cancelled — see §3.

### 2.2 CPS image downscaling — all 13 parse flows — ~₹800–1,500/mo ✅
- Created shared helper `src/lib/imageForClaude.ts` (downscales images to ≤1568px JPEG before sending to Claude — Anthropic discards pixels beyond that anyway, so full-size uploads were paying 4–8× the image tokens for nothing).
- Routed **all 13 document-parse call sites across 11 files** through it: invoices, vendor quotes, GRNs, legacy POs, cash vouchers, visiting cards, rate lists, vendor uploads, bulk ingestion.
- Added a white-background fix so transparent PNGs don't render black.
- **Repo:** hagerstone-cps · commits `46d6e1c`, `4567c89` (pushed to `main`).
- **Verified:** production build passes; tsc error count unchanged (no new errors introduced).

### 2.3 Exposed browser API key closed (bonus, part of 2.2) ✅
- `InvoiceUpload.tsx` was calling `api.anthropic.com` **directly from the browser** with a `VITE_`-exposed key. Rerouted it through the `claude-proxy` edge function.
- The exposed `VITE_ANTHROPIC_API_KEY` is now **unused anywhere in the CPS source** (grep-clean).
- **Pending (your side):** the old key still needs rotating in the Anthropic Console — it shipped in past JS bundles.

### 2.4 Hiring System → Supabase free tier — ~₹600/mo ✅
- Transferred the Hiring System project (`sgerslbmnwrltqrhsdir`, 12 MB DB / ~24 MB storage / 0 auth users) from the paid org to a new **Free** org ("Hagerstone Free").
- Built a **keep-alive** n8n workflow ("Supabase Free-Tier Keep-Alive", id `QjPCpztDmJ0ZmwFP`, **active**) — pings the DB daily at 07:00 to beat the free-tier 7-day auto-pause. Endpoint verified returning HTTP 200.
- Created a backup script `backup-hiring-system.ps1` (free tier has no auto-backups).
- **Pending (your side):** fill the pooler host in the script and run it once (then weekly).
- **Consequence:** the Supabase MCP token (scoped to the paid org) can no longer read the transferred project — use REST + keys or the dashboard for it.

### 2.5 market-rate-search cache TTL 7 → 30 days — ~₹300–400/mo ✅
- `market-rate-search` re-bills Anthropic web_search on cache misses; priced material rates are stable month-to-month.
- Raised priced-result cache from 7 to 30 days (no-data TTL left at 1 day).
- **Repo:** hagerstone-cps · commit `6792da4` (pushed). **Deployed** to the Hub Supabase project (edge function v11, ACTIVE).

### 2.6 Railway n8n execution pruning — ~₹300/mo + stops bill creep ✅
- n8n was storing 74,000+ executions forever (GIE Capture fired per group message).
- Set `EXECUTIONS_DATA_PRUNE=true` + `EXECUTIONS_DATA_MAX_AGE=336` (14 days) on both **Primary** and **Worker** n8n services (via Railway MCP).
- Turned off "Save successful executions" on GIE Capture (targeted, to preserve error logs on other workflows).

### 2.7 Prompt-cache health — verified, no leak ✅
- Checked GIE's prompt caching: ~55% of calls landed within the 5-min cache TTL → caching was working. The report's feared "broken cache costing ~90% extra" did **not** exist. No action needed.
- (A 1-hour cache-TTL tweak was written and committed as `8f5283c` but **never deployed**, and is now moot since the command system is down. Inert — no cleanup needed.)

---

## 3. Key Findings (research done this session)

### 3.1 Full Maytapi inventory
Two **separate Maytapi subscriptions** (~₹2,800 each = ₹5,600/mo):

| Product | Phone | Role | Verdict |
|---|---|---|---|
| `b8cce1b9-…471f0` | **46821** (business) | 1:1 transactional — imprest/founder/director approvals (n8n active), CPS RFQ/PO dispatch, delegation notifications, onboarding | **KEEP** — critical |
| `f09cb10a-…077b4` | **141590** (group) + **145466** (dead sandbox) | group messages + @mentions — **only** the (now-dead) command system | **SAFE TO CANCEL** → ₹2,800/mo |

- Every consumer was traced across code, DB, and n8n. Nothing except the dead command system uses the group number.
- **One caveat:** a separate `marketing` CRM (schema `marketing`) *can* send WhatsApp but is **email-only lately** (last WhatsApp 2026-06-25). Confirm it doesn't use the group number before cancelling (low risk, dormant).
- An **official Maytapi MCP server** exists (80+ tools) if live-account management is wanted later.

### 3.2 Other discoveries
- Railway MCP token was fixed/re-authorized this session (valid token now in gitignored `.mcp.json`).
- A previously-unknown `marketing` CRM (leads, campaigns, chatbot, email + WhatsApp) exists in the Hub DB — actively sending **email** campaigns.

---

## 4. Commits & Artifacts Produced

**hagerstone-cps (`main`):**
- `6792da4` — market-rate-search cache 7→30 days
- `46d6e1c` — image downscaling across all 13 parse flows (+ InvoiceUpload off exposed key)
- `4567c89` — transparent-PNG white-background fix
- New file: `src/lib/imageForClaude.ts`

**Hagerstone-Hub (`main`):**
- `8f5283c` — GIE prompt-cache TTL 1h (committed, **not deployed**, now moot)
- New file: `backup-hiring-system.ps1`

**Infrastructure:**
- Supabase edge function `market-rate-search` deployed (v11)
- n8n workflow "Supabase Free-Tier Keep-Alive" created + activated
- Railway env vars set on Primary + Worker

---

## 5. Pending / Recommended Next Steps

| Priority | Item | Saving/mo | Owner |
|---|---|---|---|
| **1** | Cancel group Maytapi number (deactivate dead GIE n8n workflows first) | **₹2,800** | You (Maytapi console) |
| 2 | Business number → Meta Cloud API | ₹2,550 | You (Meta verification) |
| 3 | Rotate the exposed `VITE_ANTHROPIC` key + kill unused/test Claude keys | security + ₹200–500 | You (Console) |
| 4 | Run the Hiring System backup once (fill host in `backup-hiring-system.ps1`) | — (safety) | You |
| 5 | Re-baseline the actual bill (Console/billing pages) to confirm savings landed | — | You |
| — | Website → free tier | ₹1,050 | **Parked** — staying on Pro |
| — | claude-proxy → Gemini for parses | ₹600–1,000 | **Rejected** — risk + new vendor not worth it |

**Open design item:** the command system was taken down for cost, but the *capability* (director WhatsApp instructions → tasks) still needs a cheaper replacement — see the leaner architecture proposed in chat (self-hosted capture + event-driven Haiku, ~₹300–600/mo).

---

## 6. Before / After

| Service | Before | Now | After Maytapi cuts (projected) |
|---|---|---|---|
| Maytapi | ₹5,600 | ₹5,600 | ~₹250 (Meta Cloud API + group cancelled) |
| Claude | ~₹4,900 | ~₹2,000–2,500 | same |
| Supabase | ₹3,800 | ~₹3,200 | ~₹3,200 (website stays Pro) |
| Railway | ₹1,100 | dropping | ~₹800 |
| **Total** | **~₹15,400** | **~₹11,000–11,800** | **~₹6,500–7,000** |

*Numbers at ~₹86/$. "Now" figures are estimates — confirm against live billing.*

# Hagerstone — Single-Domain (Subdomain) Unification Plan

> **Date:** 25 July 2026
> **Decision:** Keep each app as its own Vercel deployment, but serve them all as subdomains of one Hagerstone domain (Google-Workspace/Zoho pattern). No code merge, no monolith.
> **Basis:** Live Vercel MCP audit of the `AI Hagerstone's projects` team (28 projects) + Vercel pricing research (July 2026).
> **Companion doc:** `MULTI_TENANT_FINAL_PLAN.md` — this plan is a prerequisite for Stage-2 hostname-based tenant routing.

---

## 1. Current state (verified live, 25 Jul 2026)

**Zero custom domains exist anywhere in the Vercel team.** Every app — including the corporate website project — runs on `*.vercel.app`:

| App | Vercel project | Current production URL |
|---|---|---|
| Hub SPA | `hagerstone-hub` | `hagerstone-hub.vercel.app` |
| CPS (procurement) | `hagerstone-cps` | `hagerstone-cps.vercel.app` |
| Finance web dashboard | `expense-automation` | `expense-automation-three.vercel.app` |
| Finance mobile | `expense-automation-mobile` | `expense-automation-mobile.vercel.app` |
| Hiring / attendance | `hr-hiring-automation` | `hr-hiring-automation.vercel.app` |
| LCS | `hagerstone-lcs` | `hagerstone-lcs.vercel.app` |
| Marketing ERP | `hagerstone-marketing-erp` | `hagerstone-marketing-erp.vercel.app` |
| Scraper | (separate) | `scraper-application-v2.vercel.app` |

**Where the URLs are hardcoded (found by grep):**
- Hub frontend: `src/config/modules.ts` — all 8 launcher entries point at `*.vercel.app`.
- **6 Supabase edge functions** embed `vercel.app` links in outbound WhatsApp/email messages: `del-notify-assign`, `gie-task-reminders`, `send-onboarding`, `imprest-ageing-digest`, `del-verify-task`, `del-task-followup`.
- n8n workflows: assume several embed app links too — must be grepped in n8n before cutover.
- Supabase Auth: redirect/site URLs (Dashboard → Auth → URL Configuration) currently list vercel.app origins.

**Plan/billing status:** the team is on the free **Hobby** tier (no Vercel line item in the July cost baseline).

---

## 2. Vercel costing — the straight answer

| Question | Answer |
|---|---|
| Do custom domains cost money on Vercel? | **No. Custom domains (incl. subdomains) are free on every plan, SSL automatic.** |
| Does this plan change our Vercel bill? | **₹0 today.** Adding subdomains to existing free projects costs nothing. |
| The catch | **Vercel Hobby is licensed for personal, non-commercial use only.** Running a company's internal ops on it is a grey zone Vercel rarely polices — but **selling the product to paying clients (Stage 2 of the multi-tenant plan) clearly requires Pro: $20/member/month** (one member = $20 ≈ ₹1,720/mo, includes 1 TB bandwidth vs 100 GB). |
| Hidden limits that matter later | Hobby: 100 GB bandwidth/mo, 1 concurrent build, feature *pauses* (no pay-to-continue) if a cap is hit mid-cycle. Fine for internal use; not acceptable once clients depend on it. |
| Domain purchase | Not needed — Hagerstone already owns `hagerstone.com` (company email runs on it). We only add DNS records. If a separate product domain is wanted later (e.g. `hagerstonehub.com`), that's ~₹800–1,500/yr at any registrar — optional. |

**Bottom line: this unification is free now. Budget $20/mo for Vercel Pro at the moment the first paying client goes live — treat it as part of Stage-2 cost-to-serve (already covered ~8× over by one client's subscription).**

---

## 3. Target state

```
hagerstone.com            → corporate website (wherever it lives today — unchanged)
hub.hagerstone.com        → project hagerstone-hub          (the launcher / identity home)
cps.hagerstone.com        → project hagerstone-cps
finance.hagerstone.com    → project expense-automation
m.finance.hagerstone.com  → project expense-automation-mobile   (or finance-m.)
hiring.hagerstone.com     → project hr-hiring-automation
lcs.hagerstone.com        → project hagerstone-lcs
marketing.hagerstone.com  → project hagerstone-marketing-erp
```

Internal tools that aren't part of the product suite (scraper, pitch decks, calculators) stay on `vercel.app` — no need to pollute the domain.

**Multi-tenant payoff (why this exact shape):** at Stage 2/3, tenant URLs become `cps.clientname.com` (their domain, CNAME to us) or `clientname-cps.ourproductdomain.com` — both are just more rows in the same Vercel domain list, resolved by hostname. This plan builds the muscle and removes the `vercel.app` strings from every message template once, instead of per-client later.

---

## 4. Implementation steps (half a day of work + DNS propagation)

### Step 1 — DNS (15 min, in GoDaddy)
**Verified 25 Jul 2026:** DNS for hagerstone.com is hosted at **GoDaddy** (`ns59/ns60.domaincontrol.com`). Add one CNAME per subdomain there — **no nameserver change; website, www, and email MX records untouched**:
```
hub       CNAME  cname.vercel-dns.com
cps       CNAME  cname.vercel-dns.com
finance   CNAME  cname.vercel-dns.com
...etc
```
> ⚠️ **Also verified:** hagerstone.com is ALREADY served by Vercel (`www` CNAMEs to `vercel-dns-017.com`) — but by a **different Vercel account/team** than ours ("AI Hagerstone's projects" has zero custom domains). Consequences:
> 1. When adding subdomains to our team's projects, Vercel may require a one-time **TXT verification record** in GoDaddy (it shows the exact record during Add Domain). 5 minutes, zero risk to the live site.
> 2. **Action item:** identify who controls the other Vercel account hosting the corporate website (agency/marketing?) and document it — ideally consolidate under one team later.

### Step 2 — Attach domains in Vercel (10 min)
Each project → Settings → Domains → Add (`hub.hagerstone.com` on hagerstone-hub, etc.). Vercel verifies the CNAME and issues SSL automatically. **The old `*.vercel.app` URLs keep working** — nothing breaks during rollout; Vercel serves both, and we set the custom domain as primary (old URL 307-redirects to it).

### Step 3 — Supabase Auth config (10 min — do BEFORE announcing)
Dashboard → Auth → URL Configuration on the Hub project:
- Site URL → `https://hub.hagerstone.com`
- Add all new subdomains to Additional Redirect URLs (keep the vercel.app ones during transition).
Missing this = broken magic-link/OAuth redirects. This is the only genuinely breakable thing in the whole plan.

### Step 4 — Update hardcoded URLs (1–2 h, one commit per repo)
1. Hub `src/config/modules.ts` — 8 URLs → new subdomains.
2. The 6 edge functions — replace `*.vercel.app` links with the new subdomains. Better: introduce one `APP_BASE_URLS` shared constant (or env var) so Stage-2 tenants can override it — de-hardcoding these is already on the multi-tenant Phase-1 list, so do it the configurable way now and the work counts twice.
3. Redeploy the 6 edge functions.
4. Grep n8n workflows for `vercel.app` and patch message templates (drafts → publish, per the known n8n draft-vs-active gotcha).
5. Finance backend (Railway) — check CORS allow-list / any FRONTEND_URL env var and add the new origins.

### Step 5 — Verify (30 min)
- Each subdomain loads, SSL valid, old URL redirects.
- Login flow on Hub (password + any magic-link path).
- One WhatsApp notification end-to-end — link in message opens the new domain.
- Launcher tiles from Hub open the right apps.

### Step 6 — Later, not now (flagged for Stage 2)
- **SSO cookie on `.hagerstone.com`** — share the Supabase session across sibling subdomains (cookie-based storage adapter) so login-once works suite-wide. Prerequisite (this plan) done; implementation is its own small project.
- **Vercel Pro upgrade ($20/mo)** — trigger: first paying client, or first time a usage cap warning appears, whichever comes first.
- Wildcard domain (`*.hagerstone-product.com`) for per-tenant URLs — requires moving that domain's nameservers to Vercel; decide when Stage-2 tenant #1 signs.

---

## 5. Rollback

Trivial at every step: the `vercel.app` domains never stop working, DNS records can be deleted, and the code change is one commit per repo. No data, schema, or backend involvement. Risk concentrates only in Step 3 (auth redirects) — mitigated by *adding* new URLs alongside old ones rather than replacing.

---

## 6. Summary

| | |
|---|---|
| Cost now | **₹0** (custom domains free; stay on Hobby) |
| Cost at first paying client | **$20/mo Vercel Pro** (mandatory by ToS — non-commercial Hobby restriction) |
| Effort | ~half a day + DNS propagation |
| Breakage risk | Low; only auth redirect config needs care; full rollback available |
| Industry alignment | Google Workspace / Zoho subdomain-suite pattern; hostname routing is how Odoo/Frappe resolve tenants |
| Multi-tenant leverage | Prerequisite for Stage-2 per-tenant URLs; the edge-function URL de-hardcoding double-counts as multi-tenant Phase-1 work |

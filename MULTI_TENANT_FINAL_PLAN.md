# Hagerstone Hub — Multi-Tenant Final Plan

> **Date:** 25 July 2026
> **Status:** FINAL — this supersedes the exploratory discussion in `HAGERSTONE_MULTI_TENANT_STRATEGY.md`.
> **Basis:** Live audit of the Hub system + web research (July 2026) on how Odoo, ERPNext/Frappe, Zoho, NetSuite and SAP B1 actually run multi-tenancy, India SME pricing benchmarks, and GTM models for small teams.
> **One-line summary:** Sell first with what we have, add tenants as isolated copies, and build the superadmin control plane only when client #10 forces us to — exactly the way the industry grew.

---

## 1. The model we are following (and why it's the industry-real one)

Every successful ERP company runs one of three shapes:

| Shape | Who uses it | What it means |
|---|---|---|
| **Silo** — separate DB per client | SAP Business One | Strongest isolation, ops repeated per client |
| **Pool** — one shared DB, tenant_id rows | NetSuite, Zoho | Cheapest infra, hardest/riskiest retrofit |
| **Bridge** — shared compute, one DB per tenant, control plane on top | **Odoo (millions of tenant DBs), Frappe Cloud (ERPNext)** | The proven middle path |

**We follow the Bridge path — but we grow into it in 3 stages instead of building it upfront.**
Microsoft's official multi-tenant guidance says: below ~10 tenants, a full control plane is optional — a simple tenant registry + runbooks is correct practice. Frappe Cloud proves the end-state economics: a full ERP tenant runs on ~$1–3/mo of real infra and sells for $5–25/mo with unlimited users.

```
STAGE 1 (clients 1–3)      STAGE 2 (clients 3–10)       STAGE 3 (clients 10+)
Ops-as-a-service           Deploy-per-client (silo)      Bridge + Superadmin panel
────────────────           ─────────────────────────     ─────────────────────────
We RUN it for them         Own Supabase project each     Shared clusters,
on our existing system.    + tenant registry table       DB-per-tenant, full
ZERO new engineering.      + provisioning checklist.     control-plane console.
Revenue starts NOW.        De-hardcoded codebase.        Built with knowledge of
                                                         10 real clients' needs.
```

**Rule that makes this work: every stage's work is reused by the next stage. Nothing is thrown away.**

---

## 2. Stage 1 — First revenue with zero engineering (Month 0–3)

**Model:** "Ops-as-a-service." We do not sell software. We sell: *"We run your procurement + expense approvals + employee hub. You get WhatsApp approvals, AI document parsing, dashboards. Our team operates it."*

- **Why:** Pilot.com proved this at $43M ARR / 60% margins. Indian SMEs buy outcomes, not subscriptions. And our system works TODAY for this — hardcoded strings don't matter when *we* are the operator.
- **Price anchor:** against the ops staff they'd hire (₹25–60K/month per head), not against software. Charge **₹20–40K/month per client**, setup fee ₹50K–1L.
- **Target:** 2–3 design-partner clients from the fit-out/construction network (companies Hagerstone already knows — vendors, sister firms, industry contacts).
- **What we learn:** which features clients actually use, what their approval chains look like, what breaks. This de-risks every later engineering decision.

**Engineering needed: none.** Sales effort only.

### Stage 1 exit gate → go to Stage 2 when: 2+ clients are paying and asking for "their own system."

---

## 3. Stage 2 — Deploy-per-client with a light registry (Month 3–12, clients 3–10)

**Model:** Each client gets their own isolated copy — **one Supabase project (~$10/mo), one Vercel deploy, cloned n8n workflows, their own WhatsApp number.** Supabase officially markets this exact "project-per-client" pattern to agencies. This is SAP-B1-style silo — the strongest sales pitch to nervous Indian SMEs: *"your data lives in your own database."*

**Commercial structure (India-standard, familiar to Tally-minded buyers):**
- **Setup/implementation fee:** ₹75K–1.5L one-time (covers provisioning + onboarding + training)
- **Monthly:** flat **₹7,999–14,999/mo for ≤50 employees** (+₹100–150/extra employee), **annual prepaid** with ~2 months free — mirrors Keka/greytHR/TranZact/Powerplay psychology. Powerplay at ₹72K/yr proves our exact ICP pays this.
- Module-based tiers (this is the cost-safety mechanism):

| Tier | Modules | AI/WhatsApp | Why priced this way |
|---|---|---|---|
| **Basic** | Hub + 1 module, manual entry | None | Near-zero marginal cost → high margin |
| **Pro** | Hub + chosen modules | AI doc parsing, chatbot | Priced to cover Claude usage + margin |
| **Enterprise** | All modules | WhatsApp approvals, dedicated DB pitch | Highest cost features → highest price |

> **AI/WhatsApp costs only ever land on tiers that pay for them. We never subsidize usage.**

**Engineering needed (the ONLY build of this stage — 3–6 weeks total):**

1. **De-hardcode the Hub** (~10 strings: branding, `admin@hagerstone.com`, founder allowlist in `src/config/founderSpend.ts`, module directory in `src/config/modules.ts`) → move to a per-tenant config file/table. *Small.*
2. **Generalize the approval-chain n8n workflows** — the ones hardcoding Dhruv/Bhaskar's phone numbers. One generic workflow reading "who approves, at what threshold, via what channel" from a per-tenant config table. **This is the single biggest item and it is mandatory before client #2's deployment — otherwise every client becomes a bespoke n8n fork.**
3. **Reconstruct the migration history** — dump the current schema once into a versioned `supabase/migrations/` folder, and track every future change as a file. Without this we cannot reliably create client #3's database. *(No migration history exists today — this is a known gap.)*
4. **Tenant registry (the "superadmin panel v0")** — one table in our own project: `tenants (slug, company_name, branding, modules[], supabase_project_ref, n8n_prefix, approval_chain_config, whatsapp_number, plan_tier, billing_status)` + a simple internal admin page to view/edit it. Hagerstone itself becomes **tenant zero** — a registry row pointing at the existing project. **No migration, no downtime.**
5. **Provisioning script/checklist** — `new-tenant.ps1`: create Supabase project → run migrations → deploy edge functions → clone n8n workflows with tenant prefix → create Vercel deploy → register in tenant table. Manual-assisted is fine at this stage.

**Discipline rules (from documented white-label failures):**
- **ONE codebase. Config flags only. No per-client forks. Ever.** Custom requests are paid change-requests that ship to all tenants or don't ship.
- Every client change goes through the migrations folder — never hand-edited on a live DB.
- Per-client backups follow the existing runbook pattern (auto-backup on Pro + monthly pg_dump).

**Unit economics at Stage 2 (per client):**

| | ₹/month |
|---|---|
| Revenue (flat plan) | 8,000–15,000 |
| Supabase project | ~860 ($10) |
| Vercel + n8n share | ~200–400 |
| WhatsApp (Meta utility msgs, <₹1/approval) | ~100–300 |
| Claude AI (Pro/Enterprise tiers only, Haiku-parsing) | ~300–1,000 |
| **Cost to serve** | **~₹1,500–2,500** |
| **Gross margin** | **~80%+ (at SaaS industry benchmark)** |

### Stage 2 exit gate → go to Stage 3 when: ~10 paying clients, provisioning/updates consume >1 day per week, or a big client demands self-serve.

---

## 4. Stage 3 — The real Superadmin Control Plane (client 10+, ~Year 2)

Now — and only now — we build what Odoo/Frappe have, knowing exactly what 10 real clients need:

**Architecture (the Bridge / "multi-cluster" end-state):**

```
            SUPERADMIN CONTROL PLANE  (isolated project — most privileged system)
            tenant registry · provisioning · entitlements · metering · billing
                                     │
        ┌────────────────────────────┼────────────────────────────┐
   Enterprise tier                 Standard tier               Hagerstone
   (dedicated Supabase          (clustered: several            (tenant zero,
    project per client —         tenants share one              existing project,
    the upsell pitch)            project/VPS, DB-per-           untouched)
                                 tenant, hostname routing)
```

- **Superadmin console features:** create/suspend tenant, module entitlements per tenant, branding editor, approval-chain configurator (the wizard version of the Stage-2 config table), usage metering (AI calls, WhatsApp messages, storage per tenant), billing status → auto-suspension, fleet dashboard (which tenant on which version).
- **Fleet automation:** one pipeline that applies migrations + redeploys the 19 edge functions + frontends across every tenant on merge to main.
- **Infra cost lever:** standard-tier tenants move onto shared clusters (a few Supabase projects, or self-hosted Postgres on a VPS at this scale — this is where Sir's "no super control / small instance / overage" concerns become real and where self-hosting finally pays). Dedicated projects become the **Enterprise upsell**, not the default.
- **WhatsApp at scale:** move fully onto Meta's official Cloud API (ban-proof, ~₹0.12/message) — pooled/assigned numbers per tenant. (Already planned as the Maytapi replacement — same work, reused.)
- **Billing:** Stripe/Razorpay subscription driving `billing_status` in the registry automatically.

**Frontend note:** true zero-redeploy multi-domain serving needs runtime config fetch (tenant resolved by hostname → config from control plane), replacing build-time `VITE_*` vars. This lands here, not earlier.

---

## 5. What we are explicitly NOT doing (and why — evidence-based)

| Rejected | Why |
|---|---|
| **Building the full superadmin panel first** | Months of engineering before any revenue; Microsoft guidance says unnecessary <10 tenants; we'd guess features instead of knowing them |
| **Pool retrofit now** (tenant_id on ~100 tables + rewrite 631 RLS policies) | The "very high cost" path; one RLS bug leaks across all clients; kills the "own database" sales pitch. Deferred to Stage 3 clusters, where it's a deliberate choice |
| **Leaving Supabase / VPS now** | Stack is welded to Supabase (auth, RLS, edge functions, PostgREST, 3 frontends); saving ~₹2.5K/mo isn't worth becoming the 2AM DBA for payment-critical flows. Revisit as the Stage-3 cluster substrate |
| **Selling the codebase / template** | No developer audience for this niche; zero recurring revenue; unenforceable licensing |
| **Formal reseller/partner program** | Documented pattern: 50 partners signed, 2 produce. Keep 1–2 informal referral partners (CA firms, industry consultants) on revenue share until 10+ direct clients |
| **Merging Hub+CPS+Finance into one monolith** | Modular sales ("buy what you need") is the model; separate apps = smaller blast radius; the launcher pattern already exists |

---

## 6. Our differentiators (validated by market research)

1. **WhatsApp-native approvals** — approve imprest/PO inside WhatsApp. Almost nobody does this as a first-class feature in India (only one small player found). Tally/TranZact do notifications only. Cost per approval <₹1 → margin-safe to bundle.
2. **Vertical focus** — interior fit-out / construction / project-based SMEs. Vertical SaaS commands 2–4× horizontal pricing (ACV $12–40K vs $3–8K) and there's a real gap between ₹72K/yr Powerplay-class tools and enterprise P2P — nothing sells AI-parsing procurement to 20–200-employee fit-out firms.
3. **AI document parsing** built-in (invoices, quotes, GRNs) — enterprise-grade capability at SME price.
4. **"Your data in your own database"** (Stage 2 silo) — a genuine trust-winning pitch for Indian SMEs, and later the Enterprise-tier upsell.
5. **We run our own company on it** — Hagerstone is tenant zero. Living proof, permanent dogfood.

---

## 7. Timeline & money at a glance

| When | What | Eng. effort | New infra cost | Revenue potential |
|---|---|---|---|---|
| **Month 0–3** | Stage 1: 2–3 ops-as-a-service clients | None | ₹0 | ₹40K–1.2L/mo |
| **Month 3–5** | Stage 2 build: de-hardcode, generic approvals, migrations, registry v0, provisioning script | 3–6 weeks | ₹0 | — |
| **Month 5–12** | Stage 2: onboard to ~10 clients | Provisioning only | ~₹1K/client/mo | ₹80K–1.5L/mo at 10 clients |
| **Year 2** | Stage 3: superadmin console, clusters, billing, fleet automation | 2–3 months | Control-plane project + cluster infra | Scales past 10 clients with flat ops |

**Break-even reality check:** the entire current infra bill (~₹11–15K/mo) is covered by the FIRST client. Everything after client #1 is gross margin ~80%.

---

## 8. Immediate next actions (this month)

1. ☐ **Finish the cost cleanups already planned** (cancel group Maytapi ₹2,800/mo; Meta Cloud API migration — it's also Stage-3 prep).
2. ☐ **Pick 2–3 design-partner prospects** from the Hagerstone network and pitch Stage-1 ops-as-a-service.
3. ☐ **Start the migration-history reconstruction** (schema dump → versioned folder) — needed regardless of path, zero risk.
4. ☐ **Spec the approval-chain config schema** (who approves, threshold, channel — per tenant) — the one piece of design work that unblocks everything in Stage 2.
5. ☐ Keep runbook discipline: every tenant-zero operational fact goes in a runbook, because at Stage 2 runbooks become the provisioning manual.

---

*Research basis: Odoo/Frappe/Zoho/NetSuite/SAP architecture & pricing docs, Microsoft Azure multi-tenant control-plane guidance, AWS SaaS Factory silo/pool/bridge model, India SME pricing (Zoho/Keka/greytHR/Tally/Powerplay/TranZact), WhatsApp Business API India pricing, SaaS margin benchmarks, white-label/AMC conventions, and the live Hub audit in `HAGERSTONE_MULTI_TENANT_STRATEGY.md`. All ₹ figures ex-GST, ~₹86/$.*

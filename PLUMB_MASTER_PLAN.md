# PLUMB — Master Plan: From Internal System to Sellable Product

> **Date:** 25 July 2026
> **Status:** FINAL master plan. This is the one document that contains everything — it absorbs and sequences `MULTI_TENANT_FINAL_PLAN.md`, `DOMAIN_UNIFICATION_PLAN.md`, and `SSO_SINGLE_LOGIN_PLAN.md` (kept as technical detail annexes).
> **Written in plain business language.** Every known problem has its solution listed in Part 8.
>
> **The decision this plan implements:** We take a product name (working name: **plumb.ai**), make our system multi-tenant, register **Hagerstone as Client #1**, and sell self-operated systems to other companies — each client's own team runs their own copy, branded with the client's name, with their data in their own database.

---

## The whole plan on one page

```
STEP 1  Brand           → Secure "Plumb" name + domain. Rename modules to product names.
STEP 2  Fix our house   → One domain for all our apps + login-once (SSO). Hagerstone becomes the showcase.
STEP 3  Make it a       → Remove every "Hagerstone" hardcoding. Approval chains become settings.
        product           Database becomes copy-able. One script sets up a new client.
STEP 4  Hagerstone =    → Register ourselves as the first tenant. We forever use what we sell.
        Client #1
STEP 5  Onboard         → Each new client: own database, own branded apps, own approvers,
        clients 2,3,4…    own WhatsApp — set up in ~1 day from the script.
STEP 6  Sell            → Module menu + 3 price tiers. Warm network first, then marketing site.
STEP 7  Scale           → At ~10 clients: build the Superadmin control panel (fleet management).
```

**Money summary:** Cost to serve one client ≈ ₹1,500–2,500/month. Price to client ≈ ₹8,000–15,000/month + setup fee. Margin ≈ 80%. Our entire current infra bill is covered by the first client.

---

# STEP 1 — The Brand (Week 1, runs in parallel with everything)

**Why first:** the client's team will *see* this software. Every screen, email, and WhatsApp message needs a name that isn't "Hagerstone" — no competitor will run their business on a rival's name.

**The two-brand rule (how the industry does it):**
- **Plumb** = the product company name (our name, on the marketing site and invoices).
- **Each client's instance wears the CLIENT's name** — "ABC Procurement" at `procure.abccompany.com`. White-label. The client feels it's *their* system.
- Hagerstone's own instance stays on `hagerstone.com` — it is just Client #1.

**Checklist:**
1. ☐ **Verify the name is actually usable** — check `plumb.ai` availability + price (`.ai` domains cost ~₹5–8K/year); check existing "Plumb" software trademarks (there are Plumb-named accounting tools abroad — a quick conflict check protects us). Have 2–3 backup names ready. Also buy the matching `.com` if available (Indian SME buyers trust `.com`).
2. ☐ Buy domain(s) in a **company-owned** registrar account (see Problem #10 — not in any individual's personal account).
3. ☐ **Rename the modules to product names.** Working scheme (finalize in the naming session):

| Today (internal name) | Product name (proposal) | What it does |
|---|---|---|
| Hub | **Plumb Workspace** | Employee home, launcher, identity, approvals inbox |
| CPS | **Plumb Procure** | Procurement: PRs, POs, RFQs, vendors, AI invoice/quote parsing |
| Expense/Imprest (Finance) | **Plumb Expense** | Imprest, expense approvals, ageing, WhatsApp approvals |
| Hiring system | **Plumb Hire** | Resume collection, screening, attendance |
| Marketing ERP | **Plumb Reach** | Leads, campaigns (later — not in v1 sales menu) |

4. ☐ These names go into the **tenant config as text settings** (Step 3), so the UI shows "Plumb Procure" for a generic client, "ABC Procurement" for a white-labeled one, and "Hagerstone CPS" for us — same code, three labels.

**Cost:** ~₹6–10K/year domains. **Effort:** one naming decision + a purchase.
**Important:** nothing else in this plan waits for the name. Steps 2–3 proceed regardless; the name is inserted as a config value at the end.

---

# STEP 2 — Fix Our Own House First (Weeks 1–2)

Before selling to anyone, our own system must look professional and log in once. Hagerstone is the permanent demo — a prospect will judge the product by watching ours run.

### 2a. One domain for all our apps *(detail: `DOMAIN_UNIFICATION_PLAN.md`)*
- Today every app is on a different ugly `something.vercel.app` address. Move them to:
  `hub.hagerstone.com` · `cps.hagerstone.com` · `finance.hagerstone.com` · `hiring.hagerstone.com` etc.
- **How:** add DNS records at **GoDaddy** (verified: that's where hagerstone.com DNS lives) → attach domains in Vercel → update login-redirect settings in Supabase → update the hardcoded links (launcher + 6 edge functions + n8n message templates).
- **Rules:** only ADD records at GoDaddy — never touch email (MX), the website, or existing TXT records. Old addresses keep working and redirect, so nothing breaks mid-move.
- **Cost: ₹0** (custom domains are free on Vercel). **Effort: ~half a day** + getting the GoDaddy login.
- ⚠️ One discovery: the corporate website already runs on Vercel under a **different account** than ours — find who owns it, and expect a one-time TXT verification record.

### 2b. Log in once, use everything (SSO) *(detail: `SSO_SINGLE_LOGIN_PLAN.md`)*
- Today users log in to Hub, then AGAIN in each module. Cause: each web address keeps its own login token. Proof of pain from our own database: **874 active sessions for just 60 users** (one user has 410!).
- **Fix:** store the login in a shared cookie on `.hagerstone.com` — log in once at Hub, every module opens already signed in. Same mechanism Google/Zoho use.
- **Verified against the live database:** one shared user pool (66 people already linked in both Hub and Finance), all access rules key off the same login token — the backend is already SSO-ready; only browser storage changes.
- **Order is fixed: 2a must finish before 2b** (shared cookies are impossible on vercel.app addresses).
- **Cost: ₹0. Effort: ~1 day** + the 9-point test list in the annex.
- **Bonus:** the same code automatically gives every future client login-once on *their* domain. Built once, works for all.

---

# STEP 3 — Turn the System into a Product (Weeks 2–8, the core build)

This is the real engineering. Because clients' **own teams** will operate their copies, every "Hagerstone-only" assumption must become a setting. Five jobs:

### 3a. Remove hardcoded Hagerstone content (~1 week)
~10 hardcoded strings in the Hub (company name, logo, `admin@hagerstone.com`, the 3-email founder allowlist, the module directory) + links inside 6 edge functions → all become values read from **tenant config**. Default values = Hagerstone's current ones, so nothing changes for us.

### 3b. Approval chains become settings, not code (~2–3 weeks — the single biggest job)
Today the n8n approval workflows literally contain **Dhruv's and Bhaskar's phone numbers** and a fixed two-director chain. A client needs *their* directors, *their* thresholds, *their* WhatsApp numbers.
- Build one **approval-chain config** per tenant: *who approves → at what amount → via which channel (WhatsApp/email)* — stored as data.
- Rewrite the founder-gate / imprest / PO-approval workflows to **read that config** instead of containing names.
- Hagerstone's config is entered first (Dhruv + Bhaskar, current thresholds) — behavior stays identical for us, but now it's data, and client ABC just gets different rows.
- ⚠️ n8n gotcha (known): publishing drafts must be done in the n8n UI — verify `activeVersionId`, not just saved drafts.

### 3c. Make the database copy-able (~3–5 days)
We have **no versioned migration history** — the schema only exists inside the live database. Without fixing this we cannot reliably create client #2's database.
- Dump the current schema once into a `supabase/migrations/` folder; from now on every change is a numbered file.
- Result: "create a fresh, correct, empty database" becomes a command, not archaeology.

### 3d. Tenant registry — the seed of the future Superadmin (~2–3 days)
One table listing every client: name, branding, which modules are on, database address, approval config, WhatsApp number, plan, billing status — plus a simple internal admin page to view/edit. This is deliberately small now; it grows into the full Superadmin panel at Step 7.

### 3e. One-command client setup (~1 week)
A provisioning script/checklist that does: create client's Supabase project → run migrations → deploy their branded frontends → point their domain → clone n8n flows with their config → create their admin user → register them in the tenant registry. Target: **new client live in ~1 day.**

**Total Step 3: ~4–6 weeks of focused work. This is the price of "client runs it themselves" — paid once, reused for every client.**

---

# STEP 4 — Hagerstone Becomes Client #1 (1 day, after Step 3)

- Add Hagerstone as the first row in the tenant registry, pointing at the **existing** database — **no data migration, no downtime, nothing moves.**
- Its config holds current branding, all modules on, Dhruv+Bhaskar approval chain.
- From this day: **we permanently use exactly what we sell.** Every improvement for a client benefits us; every bug bites us first (before clients). This is the strongest sales line we have: *"we run our own company on it."*

---

# STEP 5 — Onboarding Clients 2, 3, 4… (~1 day each)

Per new client, using the Step-3e script:

1. ☐ Their own Supabase database project (~₹860/mo) — **complete data isolation**; sales line: *"your data lives in your own database, not mixed with anyone's."*
2. ☐ Their branded apps deployed (their logo, their company name on every screen).
3. ☐ Their domain: `procure.clientname.com` (a few DNS records on THEIR domain — same simple steps as our GoDaddy work) — or a temporary neutral address if they have no domain.
4. ☐ Their approval chain configured (their directors, their limits, their WhatsApp).
5. ☐ Their WhatsApp number connected (official Meta API — approval messages cost <₹1 each).
6. ☐ Their admin user created → **their admin adds/manages their own staff** (self-service from day 1).
7. ☐ Training session + handover doc. Backups scheduled (their project follows our backup runbook).

**Iron rule (from documented failures of others): ONE codebase for all clients. Client requests become config options or paid features that ship to everyone — never a special per-client version. The day we fork per client, we stop having a product and start having N support burdens.**

---

# STEP 6 — How We Sell (parallel from Step 3 onward)

### The menu (modules are sold separately — buy what you need)
| Module | Sold to | Notes |
|---|---|---|
| Plumb Workspace | everyone (base) | Identity + launcher + approvals inbox — always included |
| Plumb Procure | procurement-heavy firms (fit-out, construction, manufacturing) | Flagship — AI invoice/quote parsing is the wow demo |
| Plumb Expense | everyone | WhatsApp imprest approvals — the differentiator nobody else has |
| Plumb Hire | growing firms | Add-on |

### The 3 tiers (protects our margins — AI/WhatsApp costs only land on plans that pay for them)
| Tier | What's on | Monthly (≤50 employees) |
|---|---|---|
| **Basic** | Chosen modules, manual entry, email notifications | ₹7,999 |
| **Pro** | + AI document parsing, dashboards, chatbot | ₹11,999 |
| **Enterprise** | + WhatsApp approvals, priority support, "own database" pitch | ₹14,999+ |

Plus: **one-time setup fee ₹75K–1.5L** (covers provisioning + training — Indian SMEs accept setup+AMC psychology), **annual prepaid** (~2 months free), +₹100–150/extra employee.
*Market evidence: our target firms already pay ₹8–25K/month for the fragmented stack we replace (Keka + Zoho Expense + Tally + Powerplay-class tools). Powerplay alone charges ₹72K/year in our exact vertical.*

### Where clients come from
1. **First 2–3: Hagerstone's warm network** — vendors, sister companies, industry contacts. Demo = our live system. No marketing spend.
2. **Then:** the plumb.ai marketing site + WhatsApp-first sales; 1–2 informal referral partners (CA firms, industry consultants) on commission. NO formal reseller program until 10+ clients (evidence: small vendors sign 50 partners, 2 produce).
3. **Positioning:** vertical-first — "built by a fit-out company for fit-out/construction/project businesses" (vertical products command 2–4× generic pricing).

---

# STEP 7 — At ~10 Clients: the Superadmin Control Panel (Year 2)

When manual provisioning starts eating >1 day/week, promote the Step-3d registry into a full **Superadmin panel** (the Frappe/Odoo pattern): one screen to create/suspend clients, flip modules, edit approval chains, meter usage (AI calls, WhatsApp messages), watch billing, and push updates to every client at once. Also then: move standard-tier clients onto shared clusters (cheaper), keep "own database" as the Enterprise upsell, automate billing (Razorpay/Stripe), upgrade Vercel to Pro. **Deliberately deferred until real client count justifies it — by then we'll know exactly what 10 real clients need.**

---

# PART 8 — Every Known Problem → Its Solution

| # | Problem (plain words) | Solved by | Status |
|---|---|---|---|
| 1 | Users must log in twice (Hub, then each module) | Step 2a+2b (one domain + shared login cookie) | Plan verified vs live DB ✅ |
| 2 | Apps live on unprofessional vercel.app addresses | Step 2a | GoDaddy identified ✅ |
| 3 | "Hagerstone" hardcoded across screens/emails | Step 3a (tenant config) | Sized: ~10 strings + 6 functions |
| 4 | Approval flows contain Dhruv/Bhaskar's actual phone numbers | Step 3b (approval-chain settings) | Biggest job, ~2–3 weeks |
| 5 | No versioned database history — can't create a client DB reliably | Step 3c (migrations folder) | ~3–5 days |
| 6 | No concept of "a client" in the system at all | Step 3d (tenant registry) | Small build |
| 7 | Client setup would be manual archaeology | Step 3e (provisioning script) | ~1 week |
| 8 | Product name can't be "Hagerstone" for competitors | Step 1 (Plumb) + white-label rule (client's name on their instance) | Name TBC — check trademark |
| 9 | Vercel free plan forbids commercial use | Upgrade to Vercel Pro ($20/mo ≈ ₹1,720) at first paying client | Budgeted |
| 10 | hagerstone.com is registered to an individual, not the company | Move to company-controlled registrar account; buy plumb.ai company-owned from day 1 | Raise with directors |
| 11 | Corporate website runs on an unknown second Vercel account | Identify owner, document, later consolidate | Action item |
| 12 | WhatsApp runs on unofficial Maytapi (ban risk, ₹cost) | Already-planned move to official Meta Cloud API (<₹1/approval, ban-proof) — reused as the product's WhatsApp rail | In cost plan ✅ |
| 13 | AI (Claude) costs could eat margins | Tier gating (Step 6): AI features exist only on Pro/Enterprise prices that cover them | Designed in |
| 14 | Free-tier/child projects have no automatic backups | Every client project gets the backup runbook treatment (auto-backup on paid plan + monthly offline dump) | Runbook exists ✅ |
| 15 | Old storage bucket issue (cps-quotes public/orphan uploads) | Fix during Step 3 cleanup — must be clean before copying to clients | Open item from status doc |
| 16 | Runbook files with secrets sit in the repo folder | Move runbooks to a gitignored folder before any code-sharing with clients; never `git add .` | Standing rule |
| 17 | One dev team, many clients — support overload risk | One-codebase rule, self-service client admins, tiered support, config-not-code customization | Policy |

---

# PART 9 — Money & Timeline Summary

### Costs (what changes)
| Item | When | Amount |
|---|---|---|
| Plumb domains | Step 1 | ~₹6–10K/year |
| Domain unification + SSO | Step 2 | ₹0 |
| Step-3 build | Weeks 2–8 | Time, not cash |
| Vercel Pro | First paying client | ~₹1,720/mo |
| Per-client infra | Per client | ~₹1,500–2,500/mo |

### Revenue vs cost per client
- Client pays: **₹8,000–15,000/month** + setup fee
- Client costs us: **~₹1,500–2,500/month**
- **Margin ≈ 80%.** Client #1's subscription alone covers our entire current infrastructure bill.

### Timeline
| Weeks | What happens |
|---|---|
| 1–2 | Name/domain secured · GoDaddy access · domain unification · SSO |
| 2–8 | Step-3 product build (de-hardcode → approval config → migrations → registry → script) · sales conversations start in parallel |
| 8–9 | Hagerstone registered as Client #1 · full self-test |
| 9–12 | Client #2 and #3 onboarded (~1 day each) · revenue starts |
| Month 4+ | Clients 4–10 · marketing site on plumb.ai |
| ~Year 2 | 10+ clients → Superadmin panel + clusters + billing automation |

---

# THIS WEEK — the first five actions

1. ☐ **Get the GoDaddy login** for hagerstone.com (ask: Dhruv / Google-Workspace admin / whoever renewed in Feb 2025).
2. ☐ **Check plumb.ai availability + trademark**; shortlist 2 backups; buy company-owned.
3. ☐ **Find who owns the second Vercel account** hosting the corporate website.
4. ☐ **Start the migrations dump** (Step 3c) — zero risk, needed by everything.
5. ☐ **Present this plan to Sir/directors** for sign-off on: the name, the "clients self-operate" model, and the Step-3 build window.

---

*Technical annexes: `DOMAIN_UNIFICATION_PLAN.md` (DNS/Vercel detail), `SSO_SINGLE_LOGIN_PLAN.md` (login-once implementation + live-DB verification), `MULTI_TENANT_FINAL_PLAN.md` (original staged strategy + market research). Research base: Odoo/Frappe/Zoho/NetSuite architecture study, Microsoft/AWS control-plane guidance, India SME pricing benchmarks (Keka, Zoho, Tally, Powerplay, TranZact), WhatsApp Business API pricing. All ₹ ex-GST.*

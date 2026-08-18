# Hagerstone Hub — Complete System Report

> **Generated:** 2026-06-11
> **Repo:** `Ai983/Hagerstone-Hub`
> **Supabase project:** `tpfvnerrjhqwipyonngf` (region `ap-northeast-1`)
> **Scope:** Full technical + business overview compiled from a complete read of all 104 tracked files (source, specs, configs, Edge Functions).

---

## Table of Contents

1. [What This System Is](#1-what-this-system-is)
2. [Complete Tech Stack](#2-complete-tech-stack)
3. [System Overview — Building Blocks](#3-system-overview--building-blocks)
4. [Complete Working Flows](#4-complete-working-flows)
5. [Business Problems It Solves](#5-business-problems-it-solves)
6. [The Founder Dashboard — Deep Dive](#6-the-founder-dashboard--deep-dive)
7. [Delegation + Gamification Engine — Reference](#7-delegation--gamification-engine--reference)
8. [Edge Functions Reference](#8-edge-functions-reference)
9. [Data Model Highlights](#9-data-model-highlights)
10. [Environment Variables](#10-environment-variables)
11. [Risks & Open Items](#11-risks--open-items)

---

## 1. What This System Is

**Hagerstone Hub** is the single sign-on **operations portal** for Hagerstone (an interior / construction / fit-out company). It was created by collapsing **three separate Supabase projects into one** (`tpfvnerrjhqwipyonngf`), so that one login gives every employee a role-appropriate launchpad into ~8 business apps (Procurement, Finance, HR/Hiring, Attendance, Labour, Marketing, Data Scraper).

On top of being a launcher, the Hub itself hosts **three first-party products**:

- An **employee admin / onboarding console**
- A company-wide **delegation + gamified points engine**
- A real-time **Founder analytics dashboard** unifying live finance + procurement + delegation KPIs

**Architecture pattern:** A single React SPA talks to one Supabase client → cross-schema reads via `Accept-Profile`/`Content-Profile` headers → heavy/sensitive analytics go through guarded `SECURITY DEFINER` RPCs (never raw table reads) → external apps are launched by URL with a shared auth identity.

---

## 2. Complete Tech Stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | **React 19** + **TypeScript 6** |
| Build tool | **Vite 8** (`@vitejs/plugin-react`, Oxc) |
| Routing | **react-router-dom 7** (SPA, `BrowserRouter`) |
| Server state | **TanStack React Query 5** (polling + cache invalidation) |
| Forms + validation | **react-hook-form 7** + **Zod 4** (`@hookform/resolvers`) |
| UI primitives | **Radix UI** (dialog, select, dropdown, switch, tooltip, avatar, etc.) — shadcn-style |
| Styling | **Tailwind CSS 3** + `tailwind-merge`, `class-variance-authority`, `tailwindcss-animate`; brand palette = brown/amber/gold |
| Charts | **Chart.js 4** + **react-chartjs-2** (line / bar / doughnut / stacked) |
| 3D / motion | **three.js** + `@react-three/fiber` + `@react-three/drei` (podium/orb scenes for leaderboards); **framer-motion** for animations |
| Icons | **lucide-react** |
| Toasts | **sonner** |
| Dates | **date-fns 4** |

### Backend / Platform

| Layer | Technology |
|---|---|
| DB + Auth + Storage + Realtime | **Supabase** (Postgres), project `tpfvnerrjhqwipyonngf`, region `ap-northeast-1` |
| Schemas | `public` (identity/delegation), `cps` (procurement, 64 tables), `finance` (expenses, 10 tables) |
| Server logic | **Supabase Edge Functions** (Deno / TypeScript) — 7 functions |
| Aggregation | **Postgres `SECURITY DEFINER` RPCs** (founder summaries, drill-downs, scoring) |
| Workflow automation | **n8n** (Railway-hosted) — AI scoring pipeline, WhatsApp notifications |
| AI scoring | **Claude Haiku** via n8n (scores delegation task submissions) |
| Messaging | **Maytapi** WhatsApp API (onboarding invites, task-assignment alerts) |
| Hosting | **Vercel** (SPA at `hagerstone-hub.vercel.app`; all spoke apps also on Vercel) |

---

## 3. System Overview — Building Blocks

### A. Identity & Access

- **`public.employees`** is the spine: `auth_user_id`, `name`, `email`, `role`, `is_head`, `is_active`, `must_change_password`, `employee_code` (HAG-XXX), `onboarded_at`.
- **14 roles:** `founder, admin, management, procurement, finance, hr, project_manager, site_engineer, ai, mis, design, ea, sales, crm`.
- **Route guards:**
  - `ProtectedRoute` — any logged-in user; **forces password change** if `must_change_password`.
  - `AdminRoute` — admin only.
  - `HeadRoute` — department head (`is_head`) OR founder/admin.
- **Module access:** `employee_module_access` table + role-default presets decide which of the 8 app cards a user sees.

### B. The 8 Spoke Modules (Launchpad)

| Module | Purpose | URL |
|---|---|---|
| 🕐 Attendance | Check-in/out, leave records | `hr-hiring-automation.vercel.app/attend.html` |
| 💰 Finance — Employee | Submit imprest, track expenses | `expense-automation-mobile.vercel.app` |
| 💼 Finance — Admin | Approvals, PO payments, reports | `expense-automation-three.vercel.app` |
| 📦 Procurement (CPS) | PR → RFQ → Quote → PO → GRN | `hagerstone-cps.vercel.app` |
| 👥 HireFlow (HR) | Hiring pipeline, AI screening | `hr-hiring-automation.vercel.app` |
| 👷 Labour & Contractor (LCS) | Daily-wage labour, AI verify → pay | `hagerstone-lcs.vercel.app` |
| 📣 Marketing (ERP) | Campaigns, proposals, leads | `hagerstone-marketing-erp.vercel.app` |
| 🔍 Data Scraper | Web scraping, data extraction | `scraper-application-v2.vercel.app` *(newest, just merged)* |

Each is an external Vercel app opened by URL, with a shared Supabase auth identity.

### C. Three First-Party Products Inside the Hub

1. **Employee Admin Console** (`/admin/employees`) — create/edit/onboard staff.
2. **Delegation + Gamification engine** (`/delegation/*`) — assign work, AI-score it, verify, award points, leaderboards.
3. **Founder Analytics Dashboard** (`/founder`) — the executive cockpit (see §6).

### D. Route Map

| Route | Guard | Purpose |
|---|---|---|
| `/login` | public | Login |
| `/change-password` | public | First-login password reset |
| `/dashboard` | ProtectedRoute | Module launchpad (role-aware) |
| `/founder` | ProtectedRoute (founder/admin/management) | Executive analytics |
| `/admin/employees`, `/add`, `/:id/edit` | AdminRoute | Employee CRUD |
| `/delegation/my-day` | ProtectedRoute | Personal task Kanban |
| `/delegation/my-points` | ProtectedRoute | Unified points history |
| `/delegation/verify` | HeadRoute | Head verification queue |
| `/approvals` | HeadRoute | Imprest approval gate |

---

## 4. Complete Working Flows

### Flow 1 — Onboarding a New Employee

1. Admin fills the Add-Employee form (name, email, role, module toggles).
2. `admin-create-user` Edge Function runs: checks if the email already has a Supabase auth identity (from CPS/Expense) via `auth_user_id_by_email`.
   - If **yes** → **links** the existing account (no new password).
   - If **no** → creates auth user + a mobile-friendly **temp password** (`Hager` + 4 digits + 3 letters), sets `must_change_password = true`, assigns `HAG-NNN` code.
3. `sync_module_access` RPC provisions matching profile rows in the CPS/Finance schemas and sets access flags.
4. `send-onboarding` Edge Function sends a **WhatsApp invite** (via Maytapi) with login + temp password + a "open in Chrome, not inside WhatsApp" warning; logs to `onboarding_log`; stamps `onboarded_at`.
5. On first login, `ProtectedRoute` sees `must_change_password` and forces `/change-password` before anything else.

### Flow 2 — Login → Role-Aware Dashboard

`useAuth` restores the session (with a deliberate `setTimeout(0)` to dodge a Supabase auth-lock deadlock), loads the active employee row, and the dashboard renders buttons conditionally:

- **All delegation roles** → My Points / Mera Din
- **Heads** → Verify Queue
- **Founder/admin** → Approvals + Founder Overview
- **Admin** → Admin Panel

### Flow 3 — Delegation Task Lifecycle (the gamified core)

**assign → start → submit → AI score → head verify → points → leaderboard**

1. A head/founder creates a task (title, date, type, assignee). If assigned to someone else → `del-notify-assign` fires a WhatsApp alert.
2. Assignee works a Hinglish **Kanban** (`MyDayPage`): 🆕 Naya Kaam → ⏳ Chal Raha Hai → 👀 Review Mein → ✅ Ho Gaya.
3. On submit, `del-submit-task` computes a **points ceiling** from the task's effort tier and timeliness, then routes scoring:
   - **Agent-scored** → fires n8n webhook → **Claude Haiku** scores the write-up + attachments → writes proposed points.
   - **External-scored** → points come from CPS/Finance engines instead.
4. A department **head** uses `VerifyQueuePage` and `del-verify-task` to **approve / adjust / reject** the AI's proposal. Only then do points lock as `verified`.
5. `gamification_pulse` table bumps → **Realtime** pushes refreshed scores/leaderboards to every client.
6. `del-finalize-period` snapshots weekly/monthly **top-5 winners** per role into `del_period_winners`.

### Flow 4 — Imprest (Cash Advance) Approvals

`/approvals` (founder/admin) calls the external **Finance API** (`/api/imprest/founder/queue`, `…/founder-gate-approve`, `…/founder-gate-reject`). It renders the full multi-stage approval trail (S1 Avisha → S2 Ritu → Director routes), rejection history, and net-approved-after-old-balance.

---

## 5. Business Problems It Solves

| Problem before | What the Hub does |
|---|---|
| 3 disconnected Supabase systems, separate logins | One identity, one portal, role-based module launchpad |
| Manual, error-prone onboarding | One-click create → cross-schema provision → WhatsApp invite → forced password reset |
| No accountability on daily work | Delegation engine: every task assigned, submitted, AI-scored, head-verified, audited |
| Disengaged staff | Gamification: points, streaks, weekly/monthly leaderboards, podium 3D scenes |
| Founder flying blind across finance + procurement | Real-time executive dashboard unifying spend, commitments, cash-flow, pipeline, and team performance |
| Slow imprest approvals, no visibility | Founder approval gate with full stage trail and turnaround metrics |
| Fairness/consistency in scoring | AI (Claude Haiku) proposes, human head decides — consistent + accountable |

---

## 6. The Founder Dashboard — Deep Dive

**Route** `/founder`, guarded to `founder / admin / management`. All data comes from guarded `SECURITY DEFINER` RPCs (`founder_*`), aggregated **server-side** (compact JSON, never raw rows), polled every **90–120s** and **push-refreshed** via Supabase Realtime on `finance.expenses`, `cps.cps_purchase_orders`, and `finance.imprest_requests`. Heavy sections are lazy-loaded and deferred until scrolled into view.

**Filters (sticky):** period (Week / Month / Quarter / YTD / All) × site × person × team, plus a "Live · updated X ago" indicator and manual refresh.

### 6A. Headline Band — the 9 numbers a founder checks first

`founder_headline_kpis`:

- **Total Spend** (with % trend vs previous period)
- **Committed PO Value**
- **Imprest Outstanding** ("money on the street")
- **Payments Due 30d** (+ overdue callout)
- **Pending Approvals**
- **Active Employees**
- **Due in 7 Days**
- **Imprest Blocked**
- **Payments Overdue**

### 6B. Finance Section (`founder_finance_summary`)

- **Spend Trend** (line, clickable to drill into the expenses behind any point)
- **Spend by Category** (doughnut) and **Spend by Site — Top 10** (bar)
- **Imprest Flow** funnel: Requested → Approved → Paid → **Outstanding**, + avg approval turnaround (days) + blocked-staff count
- **Vendor Payments** trio: Overdue / Due-in-7d / Paid-to-date
- **Top 5 Spenders** (ranked, drillable)
- **Expense Status Mix** (approved/verified/manual/blocked/pending/rejected pills)

### 6C. Procurement / CPS Section (`founder_cps_summary`)

- Stat cards: **Open POs** (count + value) · **PR→PO avg cycle time** · **POs pending finance dispatch** · **Stale stock** (>24h no movement)
- **PR Pipeline by status** (bar) · **Committed Spend by Project** (bar)
- **Vendor Intelligence**: active vendors, new this period, **Top 5 vendors by PO value**
- **RFQ & Quotes** (total/reviewed/pending) + **stale-stock project list**

### 6D. Per-Project Cost Rollup (`founder_project_costs`)

The "what is each project actually costing me" view: **Finance actual spend + CPS committed PO value = grand total**, per project, as a stacked bar (Top 10) + full table / mobile cards. Joins the finance `site` to the CPS project code — historically the riskiest join in the system.

### 6E. Delegation Analytics (`founder_delegation_summary`)

Team-performance lens: Total / Completed / Under-Review / Submitted / Assigned tasks + **Done Rate**; status doughnut; **weekly completion trend**; **tasks by team** (stacked); **completion rate by person** (Top 10); a **person-level status table** (with points); and a **🏆 Top Performers** leaderboard.

### 6F. Operational Tails

Pending **imprest** and **PO** approval queues, the delegation founder operations view, and the CPS/Finance reward leaderboards.

### Drill-Down System

Every chart point is clickable and opens a modal showing the underlying rows via `founder_drill_*` RPCs, with CSV export:

| RPC | Drills into | Filters |
|---|---|---|
| `founder_drill_expenses` | Individual expenses | period, site, category, employee |
| `founder_drill_pos` | Purchase orders | period, project, vendor, status |
| `founder_drill_prs` | Purchase requisitions | period, status, project |
| `founder_drill_tasks` | Delegation tasks | period, status, person, team |

### Why It's Useful for the Founder

- **One screen, whole company**: cash position, committed-but-unpaid money, approval bottlenecks, procurement pipeline, and people-performance — without opening three apps.
- **Cash-flow control**: "outstanding imprest," "payments due 7/30d," and "overdue" are the levers that prevent surprises.
- **Drill-down everywhere**: click a spike, see exactly which transactions caused it, export to CSV.
- **Project P&L visibility**: actual + committed per project — the number that tells whether a job is bleeding.
- **Accountability**: completion rates and points per person/team turn "are people delivering?" into a number.
- **Live + mobile**: near-real-time, phone-friendly — usable from a site visit.
- **Safe**: read-only, founder/admin-gated, server-aggregated, indexed — fast as data grows.

---

## 7. Delegation + Gamification Engine — Reference

### Points Economy

| Effort Tier | On-Time | Late (≤1d grace) | Beyond Grace |
|---|---|---|---|
| **S** (Small) | 5 | 2 | 0 |
| **M** (Medium) | 10 | 5 | 0 |
| **L** (Large) | 20 | 10 | 0 |
| **XL** (Extra Large) | 40 | 20 | 0 |

- **Grace period:** 1 day after `task_date`.
- **Daily cap:** optional per task type (`del_task_types.daily_cap`).
- **Streak bonus:** +5 points per full on-time week, capped at +15/week.

### CPS / Finance Scoring Rules (separate engines, unified in UI)

| Rule | Points | Who |
|---|---|---|
| Daily stock update (per project/day) | +10 | Site engineer |
| Quote win (per winning PO) | +10 | Site engineer |
| PR dispatched ≤ 3 days | +10 | Procurement |
| PR dispatched ≤ 7 days | +5 | Procurement |
| Imprest filed within 3 days | +5 | Site engineer |
| Imprest processed within 3 days | +5 | Finance |

### Task Status Lifecycle

| Status | Meaning | Hinglish Label | Head can act? |
|---|---|---|---|
| `assigned` | Created | 🆕 Naya Kaam | Cancel |
| `in_progress` | Started | ⏳ Chal Raha Hai | Cancel |
| `submitted` | Submitted; AI scoring in flight | 👀 Review Mein / 🤖 Points lag rahe hain | No (waiting for AI) |
| `under_review` | AI done; ready for head | 👀 Review Mein / 🕐 Head check baaki | ✅ Approve / Adjust / Reject |
| `completed` | Head approved | ✅ Ho Gaya | — |
| `rejected` | Head rejected | ↩️ Wapas Aaya | — (worker can re-submit) |
| `cancelled` | Head cancelled | ✅ Ho Gaya | — |

### Point Status Lifecycle

| Status | Counts in total? |
|---|---|
| `pending` | ✗ (shown separately) |
| `verified` | ✓ |
| `rejected` | ✗ |
| `reversed` | ✗ |

### Leaderboards

- `get_delegation_scores(period)` → per-user, per-role totals (verified + streak; pending excluded), ranked.
- `del_period_winners` → finalized weekly/monthly top-5 snapshots per role.
- Realtime via `gamification_pulse` table (60s interval fallback).
- 3D podium/orb visualizations via three.js.

### Key Pages

- **MyDayPage** — Kanban of assigned/in-progress/under-review/done; create/submit/cancel.
- **MyPointsPage** — unified history across delegation/CPS/finance with filters.
- **VerifyQueuePage** — head-only verification interface.

---

## 8. Edge Functions Reference

| Function | Purpose | Key behavior |
|---|---|---|
| `admin-create-user` | Create/link auth user + employee row | Reuses existing CPS/Expense identity; generates `HAG-NNN` + temp password |
| `send-onboarding` | WhatsApp onboarding invite | Resets/creates password, sends via Maytapi, logs to `onboarding_log` |
| `del-submit-task` | Submit a delegation task | Computes points ceiling (tier × timeliness × daily cap), routes to n8n AI or external scoring |
| `del-verify-task` | Head approves/adjusts/rejects | Locks `del_points` as verified/rejected, writes audit log |
| `del-score-task` | **DEPRECATED stub** | AI scoring moved to n8n "Del Score Task" workflow |
| `del-finalize-period` | Weekly/monthly winner snapshots | Calls `get_delegation_scores`, upserts top-5 to `del_period_winners` |
| `del-notify-assign` | WhatsApp on task assignment | Best-effort via n8n webhook → Maytapi; in-app fallback row |

### Authorization Patterns

- **Admin operations** → verify `role === 'admin'` after auth token.
- **Head verification** → global (`founder`/`admin`) OR department head (`role === task.role_group && is_head`).
- **Webhooks** (scoring, notifications) → fire-and-forget; task state updated regardless.

---

## 9. Data Model Highlights

### `public.employees`

`id`, `auth_user_id`, `name`, `email`, `phone`, `designation`, `department`, `role`, `employee_code` (HAG-XXX), `is_active`, `is_head`, `must_change_password`, `onboarded_at`, `created_at`.

### Delegation tables (`public`)

- `del_task_types` — `code`, `label`, `role_group`, `effort_tier` (S/M/L/XL), `daily_cap`, `scored_by` (agent/external)
- `del_tasks` — task instances with status, assignment, timing
- `del_submissions` — raw submission text + attachments
- `del_points` — `points`, `proposed_points`, `status`, `source_type`, `period_week`, `period_month`, `verified_by`
- `del_period_winners` — finalized leaderboard snapshots
- `del_audit_log` — full state-transition trail
- `del_notifications` — WhatsApp/in-app notification log
- `gamification_pulse` — realtime invalidation trigger

### Schema routing rules (project conventions)

- Schema names are **case-sensitive lowercase**: `cps`, `finance`.
- Two `employees` tables: `finance.employees` → `auth_id`; `public.employees` → `auth_user_id`.
- Cross-schema PostgREST needs `Accept-Profile`/`Content-Profile` headers, or `createClient(url, key, { db: { schema } })`.

---

## 10. Environment Variables

### Frontend (Vite)

| Var | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_FINANCE_API_URL` | Finance API base (default `http://localhost:4000`) |

### Edge Functions (Deno)

| Var | Purpose |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Admin DB access |
| `MAYTAPI_API_KEY` / `MAYTAPI_PRODUCT_ID` / `MAYTAPI_PHONE_ID` | WhatsApp send |
| `HUB_PUBLIC_URL` | Onboarding deep links (default `https://hagerstone-hub.vercel.app`) |
| `N8N_DEL_SCORING_WEBHOOK` | AI task-scoring pipeline |
| `N8N_DEL_ASSIGN_WEBHOOK` | Assignment notifications |

---

## 11. Risks & Open Items

1. **Finance-site ↔ CPS-project join** (§6D) is the system's most fragile dependency — per-project rollup accuracy depends on it.
2. **`del-score-task` is deprecated** — AI scoring now depends on the n8n webhook being reachable (best-effort, fire-and-forget).
3. **n8n MCP edits create drafts, not activations** — must publish in the UI (`versionId` vs `activeVersionId`).
4. **Runbook files leak secrets** — operational `HAGERSTONE_*.md` files contain JWTs and are **not** gitignored; never `git add .` in that repo.
5. **Staged-but-not-live roles** — design, ea, hr, ai, digital_marketing are defined but not yet live for delegation (per PHASE-1-REPORT §7).
6. **Edge Functions need separate deploy** — pulling source changes to `admin-create-user` / `send-onboarding` does not deploy them; they must be pushed to Supabase.

---

*End of report. Compiled from a complete read of the repository source, specs, and Edge Functions on 2026-06-11.*

# SPEC — Founder Analytics Dashboard (Finance + CPS, Real-Time KPIs)

**For:** Claude Code (hagerstone-hub repo) — the **Founder Overview** page
**Reconcile with:** the existing `FOUNDER_DASHBOARD.md`. If it already defines per-project cost, employee assignments, or a Kanban, **extend those — do not rebuild**. This spec adds the **Finance + CPS analytics/KPI layer** and the mobile-responsive treatment.
**Project topology:** Case A — `cps` and `finance` are schemas in the **same** Supabase project (`tpfvnerrjhqwipyonngf`), so cross-schema reads work with one client.

---

## 0. Honesty + scope (read first)

| # | Item | Status |
|---|---|---|
| 1 | **All KPI column names below are UNVERIFIED.** | I know the schemas + likely tables, not exact columns. Every metric is marked `⚠️ VERIFY`. **Run STEP 0 first** and replace placeholders with real columns. Do not ship a query built on a guessed column. |
| 2 | **"Real-time" = live query + refresh (+ optional Realtime subscription).** Finance/CPS store no precomputed metrics. | Instant push only on tables we explicitly subscribe to; everything else refreshes on load + interval. I will not claim full live push everywhere. |
| 3 | **Finance↔CPS project join is fragile.** Finance uses free-text `site`; CPS uses project codes. | The per-project rollup depends on a reliable join key. `⚠️ VERIFY` and, if they don't match, add a `project_map` table. This is the biggest risk — confirm before building §4D. |
| 4 | **Sensitive financial data.** | Founder/admin only. All reads go through `SECURITY DEFINER` RPCs guarded by an `is_founder()` check (§5). |
| 5 | **Chart library** | Recommend recharts / shadcn chart (lightweight, responsive). `⚠️ CONFIRM` what's installed; do not add WebGL or heavy 3D. |

> Items 1–3, 5 are unverified/proposals. Confirm before relying on them.

---

## 1. STEP 0 — schema discovery (run before any query)

Run in the Supabase SQL editor; paste results back to replace every `⚠️ VERIFY`:

```sql
-- FINANCE columns
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='finance'
  AND table_name IN ('expenses','imprest_requests','imprest_expense_reminders',
                     'po_payments','po_vendor_quotes','employees','verification_logs')
ORDER BY table_name, ordinal_position;

-- CPS columns (core analytics tables)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='cps'
  AND table_name IN ('cps_purchase_requisitions','cps_purchase_orders','cps_quotes',
                     'cps_rfqs','cps_stock','cps_stock_movements','cps_suppliers',
                     'cps_vendor_registrations','cps_projects','cps_invoices','cps_work_orders')
ORDER BY table_name, ordinal_position;

-- THE JOIN KEY probe (critical for §4D): how do finance sites map to cps projects?
SELECT DISTINCT site FROM finance.expenses ORDER BY site;          -- free-text site names
SELECT * FROM cps.cps_projects LIMIT 20;                           -- project codes/names
-- Decide: do these join on a shared value, or is a project_map table needed?
```

**Output to produce:** a confirmed column list per table + a clear verdict on whether finance `site` ↔ cps project joins natively or needs `project_map`.

---

## 2. Page structure (Founder Overview = analytics)

Keep the existing **Team Standings / Leaderboards** (gamification) where they are. Add the analytics dashboard as the Founder Overview content, organized top-down:

1. **Period + scope filters** (sticky): This Week · This Month · This Quarter · YTD · All; plus an optional **Project/Site** filter. Drives every KPI below.
2. **Company headline band** — the 5–6 numbers a founder checks first (§4A).
3. **Finance section** — spend, imprest, approvals, vendor payments (§4B).
4. **CPS / Procurement section** — PR pipeline, POs, quotes, stock, vendors (§4C).
5. **Per-project cost rollup** — Finance actual + CPS committed per project (§4D). *(Reconcile with FOUNDER_DASHBOARD.md if present.)*
6. **Live indicator** — last-updated timestamp + a subtle "Live" dot (already in the UI).

---

## 3. Real-time mechanics (honest)

- **Default:** each section calls a `SECURITY DEFINER` aggregation RPC on load, and **re-pulls on an interval** (e.g. 60–120s) + manual refresh. SQL does the aggregation; the client gets compact JSON (not raw rows).
- **Optional true-push:** subscribe via Supabase Realtime to the few high-signal tables (e.g. `finance.expenses`, `finance.po_payments`, `cps.cps_purchase_orders`) so a new expense/PO bumps the headline without waiting for the interval. If you already use the `gamification_pulse` pattern, mirror it. Subscribe only to what's worth it — don't flood the client.
- **What's instant vs refresh:** subscribed tables = near-instant; everything else = interval/refresh. State this in the UI ("Updated 2 min ago").

---

## 4. KPI catalog (what to show + likely source + ⚠️ VERIFY)

> Tiers of certainty: the **metric** and **likely table** are my design; the **column** is to be confirmed in STEP 0. Compute all aggregations **server-side in the RPC**.

### 4A. Company headline band
| KPI | Likely source | Note |
|---|---|---|
| **Total spend (period)** + trend vs prev | `finance.expenses` (amount, date, status='approved') `⚠️` | the headline financial number |
| **Committed PO value (open POs)** | `cps.cps_purchase_orders` (value/amount, status) `⚠️` | money committed but maybe not yet paid |
| **Imprest outstanding** (advances not settled) | `finance.imprest_requests` vs settled `finance.expenses` `⚠️` | "money on the street" — key control metric |
| **Payments due (next 7/30 days)** | `finance.po_payments` (payment_due_date, paid_at) `⚠️` | cash-flow heads-up |
| **Pending approvals** (S1/S2/founder) | `finance.imprest_requests` (approval-stage columns) `⚠️` | bottleneck count |
| **Active employees** | `public.employees` (is_active, role) | headcount by role |

### 4B. Finance section
| KPI | Chart | Likely source |
|---|---|---|
| Spend trend (period buckets) | line | `finance.expenses` (amount, date) `⚠️` |
| Spend by **category** | donut/bar | `finance.expenses.category` (Food/Site/Travel/Porter/Office/Labour/Site Room) |
| Spend by **site/project** | bar | `finance.expenses.site` `⚠️` |
| Imprest: requested → approved → settled; **outstanding**; **overdue/blocked** | stacked bar + stat | `imprest_requests` (amount_requested/approved) + `expenses` settlement + `employees.imprest_blocked` `⚠️` |
| Approval pipeline + **avg turnaround** | funnel + stat | `imprest_requests` timestamps (submitted→s1→s2) `⚠️` |
| Vendor payments: due / overdue / paid (period) | stat trio | `po_payments` (payment_due_date, paid_at) `⚠️` |
| **Top 5 spenders** & **Top 5 sites** | ranked list | `expenses` grouped by employee / site `⚠️` |
| Expense status mix | small donut | `expenses.status` (approved/blocked/manual) |

### 4C. CPS / Procurement section
| KPI | Chart | Likely source |
|---|---|---|
| **PR pipeline** by status | funnel/bar | `cps_purchase_requisitions.status` `⚠️` |
| **PR→PO cycle time** (avg days) | stat | PR created_at → PO created `⚠️` |
| **Open POs** + total PO value | stat | `cps_purchase_orders` `⚠️` |
| POs **pending finance dispatch** | stat | `cps_purchase_orders.finance_dispatch_status` `⚠️` |
| RFQs / quotes open vs closed | bar | `cps_rfqs`, `cps_quotes` `⚠️` |
| **Stock freshness** (projects stale >24h) | stat + list | `cps_stock` / `cps_stock_movements` (last update ts) `⚠️` |
| Active vendors / new registrations | stat | `cps_suppliers`, `cps_vendor_registrations` `⚠️` |
| **Top vendors by PO value** | ranked list | `cps_purchase_orders` grouped by supplier `⚠️` |
| Committed spend **by project** | bar | `cps_purchase_orders` by project `⚠️` |

### 4D. Per-project cost rollup (the founder's "what is each project costing me")
- Per project/site: **Finance actual spend** + **CPS committed PO value** → **total**, with a small trend.
- **⚠️ BLOCKER until §0 item 3 resolved:** requires a reliable key joining `finance.expenses.site` to a CPS project. If they don't match natively, create `public.project_map (finance_site TEXT, cps_project_code TEXT, display_name TEXT)` and join through it. Do **not** fabricate the join.
- Reconcile with `FOUNDER_DASHBOARD.md` — if it already has per-project cost, extend it with the CPS-committed side rather than duplicating.

---

## 5. Data access + security

- **RPCs, not raw table reads.** For each section, create a `SECURITY DEFINER` function (e.g. `founder_finance_summary(period, site)`, `founder_cps_summary(period)`, `founder_project_costs(period)`) that does the SQL aggregation and returns compact JSON. Pin `search_path`.
- **Guard every RPC** with an `is_founder()` check at the top:
  ```sql
  -- ⚠️ VERIFY pattern for your project
  CREATE OR REPLACE FUNCTION public.is_founder() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT EXISTS (SELECT 1 FROM public.employees
                   WHERE auth_user_id = auth.uid() AND is_active
                     AND role IN ('founder','admin'));
  $$;
  ```
  Each founder RPC: `IF NOT public.is_founder() THEN RAISE EXCEPTION 'not authorized'; END IF;`
- **Route guard:** the Founder Overview page uses the existing `AdminRoute`/founder check; non-founder/admin can't reach it.
- These RPCs **read** cps/finance — they never write. No change to CPS/Finance schemas or logic.

---

## 6. Charts & visualization
- Recommend **recharts** (or shadcn's chart wrapper) — responsive, lightweight. `⚠️ CONFIRM` installed; **no WebGL/3D**.
- Chart-type per KPI as in §4 (line for trends, donut/bar for breakdowns, funnel for pipelines, ranked lists for tops, stat cards for single numbers).
- Every chart: a clear title, the period it reflects, and an **empty state** ("Is period mein data nahi 📊") — never a blank canvas.
- Keep colors on brand tokens / CSS vars (brown/gold), not hardcoded.

---

## 7. Mobile responsiveness (founder uses this on a phone too)
- **Headline band:** 2 columns on phones, 4 on desktop (`grid grid-cols-2 lg:grid-cols-4 gap-3`). Each KPI is a compact stat card: big number, tiny label, small trend arrow.
- **Charts:** wrap in a responsive container with a fixed height; on narrow screens reduce x-axis label density (show every Nth label) so they don't overlap; allow a chart to be full-width single-column.
- **Tables (top vendors/sites, project rollup):** on mobile, render as **stacked cards** (label + value per row) OR a horizontal-scroll table with a sticky first column — not a squished grid.
- **Filters:** sticky at top; a compact segmented control or dropdown for the period on mobile; project filter as a select.
- Tap targets ≥44px; section headers with an emoji (💰 Finance, 🛒 Procurement, 🏗️ Projects) for quick scanning.
- Test at ~360–390px: no horizontal overflow, numbers legible, charts readable.

---

## 8. Performance (so it stays fast as data grows)
- **Aggregate in SQL** (GROUP BY in the RPC); return small JSON. Never pull thousands of raw rows to the client to sum them.
- **Index** the group-by/filter columns once confirmed: `expenses(date)`, `expenses(site)`, `expenses(category)`, `expenses(status)`, `po_payments(payment_due_date)`, `cps_purchase_orders(status)`, etc. `⚠️ VERIFY` exact columns.
- For the heavy **per-project rollup** (multi-join), consider a **materialized view** refreshed on a schedule (e.g. every few minutes) instead of recomputing per load; the dashboard reads the matview, the Realtime subscription can trigger a refresh. Decide based on row counts from STEP 0.
- Cache the headline band briefly client-side; let subscriptions invalidate it.

---

## 9. Build order
1. **STEP 0** schema discovery; resolve the finance↔cps join (§0.3) — gate for §4D.
2. **`is_founder()`** + the three aggregation **RPCs** (finance, cps, project-costs), each guarded.
3. **Headline band** (§4A) wired to the RPCs + period filter.
4. **Finance section** (§4B) charts/stats.
5. **CPS section** (§4C) charts/stats.
6. **Per-project rollup** (§4D) — only after the join is confirmed; reconcile with `FOUNDER_DASHBOARD.md`.
7. **Realtime** subscriptions on the high-signal tables (§3); last-updated indicator.
8. **Mobile pass** (§7) at 360–390px.
9. **Perf pass** (§8): indexes + matview decision.

---

## 10. Open decisions / confirm before building
1. **Finance↔CPS join key** (§0.3 / §4D) — native join, or build `project_map`? *(Blocks the per-project rollup.)*
2. **Which tables get true Realtime push** vs interval refresh (§3)?
3. **Chart library** installed (recharts / shadcn chart / other)?
4. **Period default** (Month? Quarter?) and whether the founder needs export (PDF/CSV) — out of scope unless you want it.
5. **Reconciliation:** what does the existing `FOUNDER_DASHBOARD.md` already build, so we extend rather than duplicate?

---

*End. Every column is unverified until STEP 0 — build the RPCs only on confirmed columns. The finance↔CPS project join is the key risk; resolve it before the per-project rollup. Founder/admin only, read-only, aggregated server-side, mobile-first, no WebGL.*

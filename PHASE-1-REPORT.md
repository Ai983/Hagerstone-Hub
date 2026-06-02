# Phase 1 Report — Delegation Schema (Hub Supabase)

**Applied:** 2026-06-02  
**Project:** `tpfvnerrjhqwipyonngf` (Hub, `ap-northeast-1`)  
**Scope:** Schema-only. No UI, no Edge Functions. Point values are proposed defaults, pending founder sign-off.

---

## 1. Migrations applied

All 8 migrations ran successfully against the Hub project.

| Migration name | What it did | Status |
|---|---|---|
| `del_01_add_is_head` | `ALTER TABLE public.employees ADD COLUMN is_head BOOLEAN NOT NULL DEFAULT false` | ✅ |
| `del_02_task_types` | Created `public.del_task_types` | ✅ |
| `del_03_tasks` | Created `public.del_tasks` + 2 indexes | ✅ |
| `del_04_points` | Created `public.del_points` + 2 indexes | ✅ |
| `del_05_period_winners` | Created `public.del_period_winners` | ✅ |
| `del_06_helpers` | Created `public.current_role_group()` and `public.is_dept_head(target_role)` | ✅ |
| `del_07_rls` | Enabled RLS on `del_tasks` and `del_points`; created 4 policies | ✅ |
| `del_08_seed_task_types` | Seeded 12 task types across 4 launch roles | ✅ |

---

## 2. Final table and column inventory

### `public.employees` (modified)

Column added: `is_head BOOLEAN NOT NULL DEFAULT false`

Head semantics: a row is a department head when `is_head = true AND role = <role_group> AND is_active = true`. Founder (`role = 'founder'`) and admin (`role = 'admin'`) are always treated as heads by `is_dept_head()` regardless of this flag.

### `public.del_task_types`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | gen_random_uuid() |
| `code` | text UNIQUE | e.g. `site_snag_closure` |
| `label` | text | Human-readable, shown in UI |
| `role_group` | text | Must match `public.employees.role` |
| `effort_tier` | text | CHECK IN ('S','M','L','XL') |
| `daily_cap` | int | NULL = uncapped |
| `active` | boolean | DEFAULT true |
| `created_at` | timestamptz | |

### `public.del_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | |
| `description` | text | nullable |
| `type_code` | text → `del_task_types(code)` | nullable |
| `role_group` | text | matches `employees.role` |
| `assigned_to` | uuid → `auth.users(id)` ON DELETE CASCADE | |
| `assigned_by` | uuid → `auth.users(id)` | |
| `task_date` | date | DEFAULT CURRENT_DATE |
| `status` | text | assigned / in_progress / submitted / verified / rejected |
| `submitted_at` | timestamptz | nullable |
| `completed_on_time` | boolean | computed at submit |
| `verified_at` | timestamptz | nullable |
| `verified_by` | uuid → `auth.users(id)` | nullable |
| `reject_reason` | text | nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Indexes: `idx_deltask_assignee_date (assigned_to, task_date)`, `idx_deltask_role_status (role_group, status)`

### `public.del_points`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → `auth.users(id)` ON DELETE CASCADE | |
| `role_group` | text | |
| `points` | int | |
| `reason` | text | Shown verbatim in UI |
| `task_id` | uuid → `del_tasks(id)` ON DELETE SET NULL | nullable |
| `source_type` | text | delegation / streak |
| `status` | text | pending / verified / rejected / reversed |
| `verified_by` | uuid → `auth.users(id)` | nullable |
| `period_week` | date | Monday of ISO week |
| `period_month` | date | 1st of month |
| `awarded_at` | timestamptz | |
| `verified_at` | timestamptz | nullable |

Indexes: `idx_delpts_user (user_id)`, `idx_delpts_role_period (role_group, period_month, status)`

### `public.del_period_winners`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `period_type` | text | week / month |
| `role_group` | text | |
| `start_date` | date | |
| `end_date` | date | |
| `winners` | jsonb | `[{rank, user_id, name, points}]` |
| `finalized` | boolean | DEFAULT false |
| `finalized_at` | timestamptz | nullable |

---

## 3. Helper functions

Both are `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.

### `public.current_role_group() → TEXT`
Returns the `role` of the currently authenticated active employee. Used in all RLS policies to avoid repeated subqueries.

### `public.is_dept_head(target_role TEXT) → BOOLEAN`
Returns `true` if the caller:
- is active AND `role = target_role` AND `is_head = true`, OR
- has `role IN ('founder', 'admin')` (fallback — always allowed to verify)

---

## 4. RLS policies (confirmed live via `pg_policies`)

| Table | Policy | Command | Gate |
|---|---|---|---|
| `del_tasks` | `deltask_select` | SELECT | own tasks (as assignee or assigner) OR same role_group OR founder/admin |
| `del_tasks` | `deltask_insert` | INSERT | `assigned_by = auth.uid()` AND (self-assign OR same role_group OR founder/admin) |
| `del_tasks` | `deltask_update` | UPDATE | `is_dept_head(role_group)` |
| `del_points` | `delpts_select` | SELECT | own points OR same role_group OR founder/admin |

Note: INSERT into `del_points` is performed by Edge Functions (Phase 2) using the service role — no user-facing INSERT policy needed for now.

---

## 5. Seeded task types (12 rows, all proposed)

Point values are **proposed defaults** (S=5, M=10, L=20, XL=40). All await founder sign-off before Phase 2.

### `site_engineer` (3 types)
> CPS already scores: daily stock update (Rule 1), quote wins (Rule 2). Not duplicated here.

| Code | Label | Tier | Cap |
|---|---|---|---|
| `site_snag_closure` | Snag closure documented | M (10) | uncapped |
| `site_safety_check` | Safety check completed | S (5) | 1/day |
| `site_daily_report` | Daily site photo report | S (5) | 1/day |

### `procurement` (3 types)
> CPS already scores: PR→Finance turnaround (Rule 3), quote/PO wins. Not duplicated here.

| Code | Label | Tier | Cap |
|---|---|---|---|
| `proc_vendor_negotiation` | Vendor negotiation completed | M (10) | uncapped |
| `proc_market_survey` | Market survey / rate research | M (10) | uncapped |
| `proc_catalog_cleanup` | Catalog / item master cleanup | S (5) | uncapped |

### `finance` (3 types)
> Finance engine already scores: E1–E3 (imprest settle), A1–A3 (approvals), F1–F3 (payout/PO). Not duplicated here.

| Code | Label | Tier | Cap |
|---|---|---|---|
| `fin_reconciliation` | Internal reconciliation | M (10) | uncapped |
| `fin_mis_support` | MIS / reporting support | S (5) | uncapped |
| `fin_audit_prep` | Audit preparation task | M (10) | uncapped |

### `mis` (3 types — fully native, no other engine scores MIS work)

| Code | Label | Tier | Cap |
|---|---|---|---|
| `mis_report` | Report / dataset delivered | M (10) | uncapped |
| `mis_dashboard` | Dashboard built / updated | L (20) | uncapped |
| `mis_data_cleanup` | Data cleanup / validation | S (5) | uncapped |

---

## 6. Role audit — action required before go-live

**Do NOT act on this yourself.** This is a report for Aniket/Bhaskar to clean up manually before Phase 2 goes live. No employee rows were modified.

### 6A. Clearly mis-assigned accounts

These accounts have a role that contradicts their email address or context. Each needs to be reassigned to the correct role before they can participate in delegation.

| Email | Name | Current role | Likely intended role | Reason |
|---|---|---|---|---|
| `ea@hagerstone.com` | Ritu Sharma | `procurement` | `ea` (once that role exists) | Email is the EA inbox; assigned as procurement. Flagged in Phase 0. |
| `ai@hagerstone.com` | Ai Hagerstone | `site_engineer` | `ai` (once that role exists) | Department-level placeholder, wrong role entirely |
| `design@hagerstone.com` | Design Team | `site_engineer` | `design` (once that role exists) | Team-level placeholder, wrong role entirely |
| `aniketawasthi.work@gmail.com` | Aniket | `site_engineer` | `admin` or deactivate | Aniket's personal Gmail, no employee code, wrong role. His canonical account appears to be `admin@hagerstone.com` (HAG-001). |
| `shubhdwivedi2003@gmail.com` | Shubh Dwivedi | `site_engineer` | `admin` (possible) | Designation is "IT Admin" but role is site_engineer. He's the admin tester — consider whether he needs the `admin` role or whether site_engineer is intentional. |

### 6B. Shared / functional inbox accounts (not individually-onboarded people)

These use team or function-level email addresses rather than individual accounts. They will cause problems in the delegation system — a shared inbox cannot have one person's tasks or points.

| Email | Name | Role | Issue |
|---|---|---|---|
| `admin@hagerstone.com` | "AI Team" | `admin` | Name says "AI Team" but this appears to be Aniket's admin account (HAG-001). Rename to the individual's name to avoid confusion. |
| `accounts@hagerstone.com` | "Accounts Hagerstone" | `finance` | Shared finance inbox, not an individual. HAG-002. |
| `procurement@hagerstone.com` | "Avisha" | `procurement` | Shared procurement inbox (HAG-032). A real "Avisha" also exists at `avijennet2001@gmail.com` (finance, HAG-010) — likely two different people, but the shared inbox account should be deactivated or converted to an individual. |
| `systems@hagerstone.com` | "Systems Hagerstone International" | `site_engineer` | Clearly a system/service account, not a person. No employee code. Should be deactivated. |
| `carrers@hagerstone.com` | Shivani | `site_engineer` | "Careers" inbox used as a personal account (HAG-011). Consider migrating Shivani to a personal email. |
| `sales@hagerstone.com` | Anandmurthy S Choudhari | `site_engineer` | Functional sales inbox (HAG-040, Bangalore). Real person but using a shared address. |
| `facade@hagerstone.com` | Akhilesh Ji | `site_engineer` | Specialty/functional inbox (HAG-019). Real person, but functional address is risky for a personal points system. |
| `delhi@hagerstone.com` | Saurabh Kumar Singh | `site_engineer` | Location-based inbox (HAG-012). Same concern. |
| `mep@hagerstone.com` | Deepak Kumar | `procurement` | MEP-specialty inbox (HAG-029). Listed in CPS procurement allowlist so role is likely correct, but a personal email is safer. |

### 6C. Legacy / duplicate accounts (no employee code, likely stale)

These active accounts have no `employee_code` and appear to duplicate or supersede another account. They will accumulate points in parallel if not resolved.

| Email | Name | Role | Note |
|---|---|---|---|
| `mep+legacy@hagerstone.com` | Deepak Chaudhary | `site_engineer` | The `+legacy` tag and `site_engineer` role both suggest this is a stale alias of `mep@hagerstone.com` (Deepak Kumar, procurement). Recommend deactivating. |
| `hagenston555@gmail.com` | MUKUL TYAGI | `site_engineer` | No employee code; note typo "hagenston" (not "hagerstone"). Possible duplicate of `mukulkulsat8011@gmail.com` (also Mukul Tyagi, also no code). |
| `mukulkulsat8011@gmail.com` | Mukul Tyagi | `site_engineer` | No employee code. Possible duplicate of above. |
| `sonu.kumar2021222324@gmail.com` | Sonu kumar | `site_engineer` | No code. Possible duplicate of HAG-049 (`sonu.kumar254247@gmail.com`, Sonu, Dee Foundation). |
| `mohitsharmat321@gmail.com` | Mohit Sharma | `site_engineer` | No code. Possible duplicate of HAG-022 (`gopalsharma3778@gmail.com`, Mohit Sharma, Minebea Mitsumi). |
| `sakshamkaloya109@gmail.com` | Saksham Verma | `procurement` | No employee code but appears in CPS procurement allowlist — likely a real active person who was never given a HAG code. Needs one. |
| `kapilraj419@gmail.com` | Kapil Gautam | `site_engineer` | No code, no department. |
| `dilkhusht984@gmail.com` | Dilkhush Thakur | `site_engineer` | No code. Possible duplicate of HAG-016 (`dilkhushdilkhush@gamil.com`, inactive, note "gamil" typo in that record). |

### 6D. Inactive accounts (for information only)

| Email | Name | Code | Note |
|---|---|---|---|
| `dilkhushdilkhush@gamil.com` | Dilkhush | HAG-016 | `is_active = false`. Note typo: "gamil.com" not "gmail.com". Already excluded from RLS queries. No action needed for delegation, but worth correcting the email typo if this account is ever reactivated. |

---

## 7. Deferred roles — what each needs before launch

The following spec departments were intentionally excluded from Phase 1. **Do not add task types for these until the prerequisites below are met.** The `del_task_types.active = false` flag can be used to stage types in advance once roles are confirmed.

| Spec department | Role ID needed | Prerequisites before delegation can launch |
|---|---|---|
| **Design** | `design` | (1) Add `design` row to `public.roles`. (2) Create individual employee accounts for Design team members with `role = 'design'`. (3) Deactivate or reassign `design@hagerstone.com` (currently a team placeholder). (4) Designate a design head (`is_head = true`). Then add `design_*` task types to `del_task_types`. |
| **EA** | `ea` | (1) Add `ea` row to `public.roles`. (2) Correctly onboard the EA(s) as individuals with `role = 'ea'`. (3) Fix `ea@hagerstone.com` — currently mis-assigned as `procurement`. (4) Designate an EA head. Then add `ea_*` task types. |
| **HR** | `hr` | Role ID `hr` already exists in `public.roles` but has 0 employees. (1) Onboard HR staff with `role = 'hr'`. (2) Confirm whether HireFlow emits scoreable events for HR (STEP 0.5 from Phase 0 — still open). If HireFlow is active, the exclusion list for HR task types must be defined. (3) Designate an HR head. |
| **AI** | `ai` | Role ID `ai` already exists in `public.roles` but has 0 real employees. (1) Reassign or deactivate `ai@hagerstone.com` placeholder. (2) Onboard individual AI team members with `role = 'ai'`. (3) Designate an AI head. Then add `ai_*` task types. |
| **Digital Marketing** | `digital_marketing` | Role ID does not exist. (1) Add `digital_marketing` row to `public.roles`. (2) Onboard Digital Marketing staff. (3) Designate a head. Then add `mkt_*` task types. |

---

## 8. What is NOT done (Phase 2+ only)

- No Edge Functions (`del-submit-task`, `del-verify-task`, `del-finalize-period`)
- No UI (My-Day board, PointsCard extension, Head Verify Queue, Leaderboard)
- No `gamification_pulse` integration for delegation realtime
- No `identity_map` table (Phase 5)
- No `points_seen` table (Phase 5)
- No `management` task types (view-only, per instruction)
- No point values finalized — all proposed, awaiting sign-off

---

*End of Phase 1 Report. Stopping as instructed. Ready for your role-audit decisions and point-economy sign-off before Phase 2.*

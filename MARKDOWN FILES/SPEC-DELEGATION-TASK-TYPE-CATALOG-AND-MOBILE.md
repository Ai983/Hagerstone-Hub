# SPEC — Delegation: Department Task-Type Catalog ("Kaam ka Type") + Mobile + Head-Assign Notify

**Place in:** `/hagerstone-task-delegation/`
**Companion to:** `SPEC-DELEGATION-V2-AI-SCORING-SUBMISSIONS-UI.md` (the V2 logic). This file defines the **dropdown options** shown in the "Kaam ka Type" (task type) selector per department, plus mobile rules for the site team, plus the team-head→employee WhatsApp notification.
**Honors:** the `hagerstone-task-delegation` skill conventions and the V2 spec's AI-scoring + ceiling model.

---

## 0. Honesty notes (read first)

| # | Item | Status |
|---|---|---|
| 1 | **Only 4 roles have real employees today** (`site_engineer`, `procurement`, `finance`, `mis`). Sales, Design, HR, CRM, EA have **no correctly-roled people** (placeholder inboxes like `design@`, or mis-roled like `ea@` under procurement — confirmed in the Phase-0/1 audits). | The catalog below is written for **all** departments, but only the 4 live roles can actually receive/assign tasks now. The rest need their role + real onboarded people first (§4). |
| 2 | **`sales` and `crm` roles do not exist** in `public.roles`. | `⚠️ CONFIRM`: create them as new roles, or map to an existing role. I will **not** silently attach them to a wrong role. Spec uses keys `sales` and `crm` as placeholders. |
| 3 | **Effort tiers (S/M/L/XL → 5/10/20/40) per item below are my proposals**, not policy. | They set the **ceiling** the AI agent scores within (V2 §5). Tune freely in the catalog seed. |
| 4 | **Double-count risk**: some new Procurement/Finance items overlap work the live CPS/Finance gamification already scores. | Flagged inline (§3). Those items either reuse the existing engine or are scoped to the non-overlapping part — never paid twice. |

> I am not certain about items 1–4; they are flags/proposals, not facts.

---

## 1. How the dropdown works

- The "Kaam ka Type" dropdown is populated from `del_task_types` **filtered by the user's `role_group`** (= `employees.role`). A Design user sees only Design types; a Site user sees only Site types.
- Each option carries a hidden `effort_tier` → that tier is the **point ceiling** the AI agent may award within (full when on time, half when late; V2 §5–6). The user never sees raw point numbers at pick-time — just the task type in plain language.
- Founder/head assigning **cross-department** see the **target** department's types (the dropdown follows the assignee's `role_group`, not the assigner's).
- Each option also stores a `scored_by` flag: `agent` (default — AI proposes, head confirms) or `external` (already scored by CPS/Finance — see §3, no double award).

---

## 2. The catalog (exact options you listed, per department)

> Codes are stable machine keys; **Label** is what the user sees. Tier = ceiling. Adjust tiers as you like.

### 1) Sales  `role_group = sales`  ⚠️ create/confirm role
| Code | Label | Tier |
|---|---|---|
| `sales_lead_capture` | Lead capture | S |
| `sales_meeting_physical` | Physical meeting | M |
| `sales_meeting_online` | Online meeting | S |
| `sales_documentation` | Documentation | S |

### 2) Design  `role_group = design`  ⚠️ create role + onboard people
| Code | Label | Tier |
|---|---|---|
| `design_2d_layout` | Layout planning (2D) | L |
| `design_boq_prep` | BOQ preparation | XL |
| `design_ppt_concept` | PPT (concept) | M |
| `design_moodboard` | Moodboard | M |
| `design_ppt_3d_render` | PPT (3D render) | M |
| `design_3d_render_prep` | 3D render preparation | L |
| `design_material_final` | Material finalisation | M |
| `design_budget_sheet` | Budget sheet preparation | L |
| `design_client_coord` | Client coordination | S |
| `design_site_coord` | Site coordination | S |
| `design_vendor_coord` | Vendor coordination | S |
| `design_revision` | Revision of PPT / designs | M |

### 3) HR  `role_group = hr`  ⚠️ onboard people (role exists in catalog)
| Code | Label | Tier |
|---|---|---|
| `hr_interview_schedule` | Interview scheduling | S |
| `hr_onboarding` | Onboarding | M |
| `hr_documentation` | Documentation | S |
| `hr_hiring` | Hiring | L |
| `hr_attendance_mgmt` | Attendance management | S |
| `hr_daily_task` | Daily task | S |

### 4) CRM  `role_group = crm`  ⚠️ create/confirm role
| Code | Label | Tier | Note |
|---|---|---|---|
| `crm_snag_mgmt` | Snag management | M | |
| `crm_client_coord` | Client coordination | S | |
| `crm_purchase` | Purchase | M | ⚠️ overlaps Procurement — confirm who owns it to avoid double award |
| `crm_site_payment` | Payment from sites directly | M | ⚠️ overlaps Finance — see §3 |

### 5) EA  `role_group = ea`  ⚠️ create role / fix `ea@` mis-role
| Code | Label | Tier |
|---|---|---|
| `ea_multi_task` | Multiple task | S |
| `ea_team_coord` | Team coordination | S |
| `ea_documentation` | Documentation | S |
| `ea_founder_director_issues` | Founder & Director daily issue management | M |
| `ea_ticket_booking_hr` | Tickets booking help to HR | S |
| `ea_other` | Other | S |

### 6) Finance  `role_group = finance`  ✅ live (already has Phase-1 types — merge, don't duplicate)
| Code | Label | Tier | Note |
|---|---|---|---|
| `fin_bank_update` | Bank update | S | |
| `fin_bill_update` | Bill update | S | |
| `fin_client_payment_followup` | Payment follow-up from client | M | |
| `fin_gst_ims_weekly` | Weekly GST / IMS portal | M | |
| `fin_invoice_check` | Invoice checking | S | ⚠️ if Finance app already scores invoice verification, mark `scored_by='external'` |
| `fin_vendor_payment` | Payment to vendor | M | ⚠️ overlaps Finance F-rules (PO paid) — see §3 |
| `fin_compliance_legal` | Compliance / legal work | L | |

### 7) Procurement  `role_group = procurement`  ✅ live (already has Phase-1 types — merge, don't duplicate)
| Code | Label | Tier | Note |
|---|---|---|---|
| `proc_site_coord` | Site team coordination | S | |
| `proc_quote_followup` | Quotation follow-up (different vendors) | M | |
| `proc_material_closure` | Material closure with best comparison rates | L | ⚠️ overlaps CPS quote-win/PR rules — see §3 |
| `proc_payments` | Payments | M | ⚠️ overlaps Finance vendor-payment — confirm owner |

### 8) Site Engineer  `role_group = site_engineer`  ✅ live (already has Phase-1 types — merge)
| Code | Label | Tier |
|---|---|---|
| `site_day_to_day` | Day-to-day problem | S |
| `site_other` | Other | S |

> Phase-1 already seeded `site_snag_closure / site_safety_check / site_daily_report`, `proc_vendor_negotiation / proc_market_survey / proc_catalog_cleanup`, `fin_reconciliation / fin_mis_support / fin_audit_prep`. **Keep those and ADD the above** — do not delete or duplicate. If any are redundant with a new label, keep one and deactivate the other (`active=false`), never two live rows for the same work.

---

## 3. Double-count reconciliation (so nothing is paid twice)

The live **CPS** and **Finance** gamification already score certain actions (computed live, per their PRDs). For delegation task types that overlap, set `scored_by='external'` so the **AI agent does NOT propose points** for them — the points come from the existing engine, and the delegation card just *links* to that activity:

| Delegation type | Already scored by | Action |
|---|---|---|
| `proc_material_closure` | CPS quote-win / PR→Finance turnaround | `scored_by='external'` (CPS owns the points) |
| `fin_vendor_payment` | Finance "vendor PO paid by due date" | `scored_by='external'` (Finance owns the points) |
| `fin_invoice_check` | Finance verification rigor (if active) | confirm; `external` if yes |
| `crm_purchase` / `proc_payments` | overlap each other + Procurement/Finance | confirm single owner before launch |

Everything else = `scored_by='agent'` (AI proposes within tier ceiling → head confirms).

---

## 4. What's live now vs. pending onboarding

| Department | Role exists? | Real people? | Usable at launch? |
|---|---|---|---|
| Site Engineer | ✅ `site_engineer` | ✅ ~52 | **Yes** |
| Procurement | ✅ `procurement` | ✅ (audit the mis-roled `ea@`) | **Yes** |
| Finance | ✅ `finance` | ✅ 3 | **Yes** |
| MIS | ✅ `mis` | ✅ 1 | Yes (no new list given — keep Phase-1 types) |
| HR | ✅ catalog only | ❌ 0 onboarded | **No** — onboard HR staff under `hr` first |
| Design | ❌ no role | ❌ placeholder `design@` | **No** — create `design` role + onboard designers |
| EA | ❌ no role | ❌ `ea@` mis-roled as procurement | **No** — create `ea` role + fix/onboard |
| Sales | ❌ no role | ❌ | **No** — create `sales` role + onboard |
| CRM | ❌ no role | ❌ | **No** — create `crm` role + onboard |

**To activate a pending department:** (1) add its role to `public.roles` (for design/ea/sales/crm), (2) onboard real individuals under that role (not shared inboxes), (3) the catalog rows for that `role_group` become selectable automatically. The dropdown can be **seeded now**; it just shows nothing to assign until step 2 is done.

---

## 5. Mobile-first (so the site team can actually use it)

The site team is the largest group (~52) and most mobile — this is the priority surface.

- **Single-column, thumb-friendly.** Task list and the 4-stage board (To Do → Doing → Sent for Review → Done) stack vertically on phones; horizontal scroll only if unavoidable, with clear column headers.
- **Big tap targets** (~44px min). The **🎤 Speak** and **📎 Attach** buttons are large and obvious on the task-submit screen.
- **Plain language / Hinglish** for site copy: "Naya Kaam", "Chal Raha Hai", "Review Mein", "Ho Gaya ✅". Dropdown labels short and concrete.
- **Type dropdown** is a large native-style select (easy on mobile), grouped/searchable if a department has many options (Design has 12).
- **Minimal typing** — the audio option exists precisely so a site engineer can *speak* the update instead of typing; transcript is shown to confirm.
- **Explicit empty/loading/error states** in plain words ("Aapko abhi koi kaam nahi mila") — never a blank screen or bare spinner (skill rule #8).
- **Low bundle / fast on cheap phones** — no WebGL/3D (removed per V2 §9); lazy-load pages; light components.
- Buttons/spacing via existing design tokens (CSS vars, brand brown/gold) — no hardcoded colors; consistent alignment across screens.

---

## 6. n8n notification — team-head → employee assignment

**You asked:** when a team head assigns a task to an employee, that employee must get a task-update message so they know what to do now. (This extends V2 §7, which covers assignment notifications generally — here it's made explicit for the head→employee case.)

**Flow:**
1. **Trigger:** a `del_tasks` row is inserted/updated to `status='assigned'` where `assigned_by` is a team head (or founder) and `assigned_to` is an employee. (A DB webhook / Supabase trigger → n8n, or n8n polls — match your existing notification pattern in the skill's `references/n8n-notifications.md`.)
2. **Compose** a WhatsApp message via **Maytapi** to `employees.phone` of the assignee, e.g. (Hinglish):
   > "📋 Naya kaam aapko assign hua hai: *{task_title}* ({task_type_label}). Assign by: {head_name}. Last date: {due_date}. App mein dekhein: {deep_link}"
3. **Send + track delivery** (skill rule #7): write a `del_notifications` row with `status (pending|sent|failed)`, `attempts`, `provider_msg_id`, `logged_at`. On 2 failures → **in-app inbox** (+ email if configured). "Assigned" must never silently mean "not notified."
4. **Also fire** on **reassignment** (head moves a task to a different employee) and keep the assigner's view in sync.

**Honesty:** Maytapi specifics (Phone ID 46821, Product ID `b8cce1b9-0f9f-4aef-994c-d232716471f0`) — `⚠️ VERIFY` the current endpoint/payload in Maytapi docs before wiring; they change. Confirm each active employee has a valid `phone` in `public.employees`, or the WhatsApp step will no-op and must fall back to in-app.

---

## 7. Build steps (this catalog + notify, on top of V2)

1. **Add `scored_by`** column to `del_task_types` (`'agent' | 'external'`, default `'agent'`).
2. **Seed the catalog** (§2) for **live roles now** (`finance`, `procurement`, `site_engineer`; keep MIS Phase-1 types); seed Sales/Design/HR/CRM/EA rows but they stay dormant until their roles + people exist (§4).
3. **Set `scored_by='external'`** on the overlapping rows (§3) so the AI agent skips them.
4. **Dropdown** = query `del_task_types WHERE role_group = <assignee role> AND active = true`, grouped/searchable; cross-dept assign follows the assignee's role_group.
5. **Mobile pass** (§5) on the task list, board, submit screen, and dropdown.
6. **Head→employee n8n WhatsApp** (§6) with delivery tracking + in-app fallback.
7. Confirm each migration + RLS per role before UI (skill build order).

---

## 8. Open decisions
1. **Create `sales` and `crm` roles**, or map them to existing roles? (Blocks those two dropdowns being real.)
2. **Owners of overlapping items** (§3): who scores `crm_purchase` vs `proc_payments` vs `fin_vendor_payment`? Pick one each.
3. **Tiers**: accept the proposed ceilings, or adjust any?
4. **Onboarding plan** for Design / EA / HR / Sales / CRM people (and fixing `ea@`'s role) — needed before those departments go live.

---

*End. The catalog can be seeded now; departments without real, correctly-roled people stay dormant until onboarded. Overlapping items are marked `external` so CPS/Finance keep their points and nothing is double-awarded. Maytapi payload + the `sales`/`crm` roles are unverified — confirm before wiring.*

# Delegation Point System — Reference

> **Status:** Archived reference. The per-task-type **point/effort checklist was removed from the EA "Naya Kaam" (Team → Delegation) assign dialog** on 2026-08-04 at the EA's request, so she can assign work quickly with just *employee → deadline → description → Send*.
>
> This file preserves the **complete point system exactly as it lived in the database** (`del_task_types` + `points_config`) so nothing is lost. The point-earning flow for employees (self-logging work on the **Mera Din / My Day** page, Leaderboard, My Points, My Scorecard, Verify queue) is **unchanged** — only the EA's assign dialog was simplified.

Source of truth at time of archival: Supabase project `tpfvnerrjhqwipyonngf` — tables `public.del_task_types` (77 active types) and `public.points_config`.

---

## 1. Effort tiers → points

Every task type carries an **effort tier**. On-time completion earns the full tier points; completion within the grace window earns half.

| Tier | On-time points | Half (within grace) |
|------|---------------|---------------------|
| **S** (Small) | 5 | 2 |
| **M** (Medium) | 10 | 5 |
| **L** (Large) | 20 | 10 |
| **XL** (Extra Large) | 40 | 20 |

- **Grace window:** `grace_days = 1` — one day after the deadline still earns the **half** value; later than that earns 0.
- **Streak bonus:** `streak_per_week = 5` points for an all-on-time week, capped at `streak_cap = 15`.

---

## 2. Task type catalog (by department)

All 77 active delegation task types, grouped by `role_group`, with tier and points.

### AI / IT (`ai`)
| Task | Tier | Points |
|------|------|--------|
| System / feature built and deployed | L | 20 |
| Dashboard / UI built or updated | M | 10 |
| Database migration / schema change | M | 10 |
| Site Handover with Quality work | M | 10 |
| SIte Handover with quality work | M | 10 |
| System integration completed | M | 10 |
| Workflow / automation built (n8n etc.) | M | 10 |
| Bug fixed / issue resolved | S | 5 |
| Config / deployment / infra change | S | 5 |
| Technical report / documentation delivered | S | 5 |

### CRM (`crm`)
| Task | Tier | Points |
|------|------|--------|
| Payment from sites directly | M | 10 |
| Purchase | M | 10 |
| Snag management | M | 10 |
| Client coordination | S | 5 |

### Design (`design`)
| Task | Tier | Points |
|------|------|--------|
| 3D render preparation | L | 20 |
| Budget sheet preparation | L | 20 |
| Layout planning (2D) | L | 20 |
| Measurement Bill | L | 20 |
| Material finalisation | M | 10 |
| Moodboard | M | 10 |
| PPT (3D render) | M | 10 |
| PPT (concept) | M | 10 |
| Revision of PPT / designs | M | 10 |
| Client coordination | S | 5 |
| Site coordination | S | 5 |
| Vendor coordination | S | 5 |
| BOQ preparation | XL | 40 |

### EA (`ea`)
| Task | Tier | Points |
|------|------|--------|
| PQ form subission | L | 20 |
| Agreement work | M | 10 |
| Founder & Director daily issue management | M | 10 |
| Documentation | S | 5 |
| Multiple task | S | 5 |
| Other | S | 5 |
| Team coordination | S | 5 |
| Tickets booking help to HR | S | 5 |

### Finance (`finance`)
| Task | Tier | Points |
|------|------|--------|
| Compliance / legal work | L | 20 |
| Audit preparation task | M | 10 |
| Internal reconciliation | M | 10 |
| Payment follow-up from client | M | 10 |
| Payment to vendor | M | 10 |
| Weekly GST / IMS portal | M | 10 |
| Bank update | S | 5 |
| Bill update | S | 5 |
| Invoice checking | S | 5 |
| MIS / reporting support | S | 5 |

### HR (`hr`)
| Task | Tier | Points |
|------|------|--------|
| Hiring | L | 20 |
| Onboarding | M | 10 |
| Attendance management | S | 5 |
| Daily task | S | 5 |
| Documentation | S | 5 |
| Interview scheduling | S | 5 |

### MIS (`mis`)
| Task | Tier | Points |
|------|------|--------|
| Dashboard built / updated | L | 20 |
| Report / dataset delivered | M | 10 |
| Data cleanup / validation | S | 5 |

### Procurement (`procurement`)
| Task | Tier | Points |
|------|------|--------|
| Material closure with best comparison rates | L | 20 |
| Issue PO | M | 10 |
| Market survey / rate research | M | 10 |
| Payments | M | 10 |
| PO & Quotation Tracker | M | 10 |
| Procurement Tracker | M | 10 |
| Quotation follow-up (different vendors) | M | 10 |
| Vendor negotiation completed | M | 10 |
| Approval to be taken for material closure & order | S | 5 |
| Catalog / item master cleanup | S | 5 |
| Handover Sheet | S | 5 |
| Site team coordination | S | 5 |

### Sales (`sales`)
| Task | Tier | Points |
|------|------|--------|
| Physical meeting | M | 10 |
| Documentation | S | 5 |
| Lead capture | S | 5 |
| Online meeting | S | 5 |

### Site Engineer (`site_engineer`)
| Task | Tier | Points |
|------|------|--------|
| Make project Schedule | XL | 40 |
| Site Handover with Quality of Work | M | 10 |
| Snag closure documented | M | 10 |
| Daily site photo report | S | 5 |
| Day-to-day problem | S | 5 |
| Other | S | 5 |
| Safety check completed | S | 5 |

---

## 3. Operational / Coordinator / Streak points (`points_config`)

Beyond delegation task types, `points_config` also drives automatic operational and coordinator points:

**Operational**
| Key | Value | Note |
|-----|-------|------|
| ops_stock_daily | 10 | site: per project per day stock logged |
| ops_quote_win | 10 | site: per winning quote → PO |
| ops_imprest_ontime | 5 | site: imprest filed on time |
| ops_imprest_days | 3 | imprest on-time window (days) |
| ops_proc_full | 10 | procurement: PR dispatched within grace |
| ops_proc_half | 5 | procurement: PR dispatched within late window |
| ops_proc_grace_days | 3 | |
| ops_proc_late_days | 7 | |
| ops_fin_process | 5 | finance: imprest processed on time |
| ops_fin_process_days | 3 | |

**Coordinator**
| Key | Value | Note |
|-----|-------|------|
| coord_assign_completed | 2 | per assigned task that reaches completed |
| coord_verify_fast | 3 | verified ≤24h of submission |
| coord_verify_ok | 1 | verified 24–48h |
| coord_verify_fast_hrs | 24 | |
| coord_verify_ok_hrs | 48 | |
| coord_followup | 1 | per overdue task nudged |
| coord_followup_daily_cap | 5 | |
| coord_clean_queue_bonus | 10 | weekly: no task waited > threshold |
| coord_clean_queue_hrs | 48 | |

**Delegation tiers / streak** (see §1): `tier_S=5, tier_M=10, tier_L=20, tier_XL=40`; halves `tier_half_S=2, tier_half_M=5, tier_half_L=10, tier_half_XL=20`; `grace_days=1`; `streak_per_week=5`; `streak_cap=15`.

---

## 4. Penalty (GIE reminder engine)

The `gie-task-reminders` engine (separate from delegation) escalates R1→R3 reminders and, on the 4th reminder with the task still incomplete, **debits 500 points** (`PENALTY_POINTS = 500`) via `del_points`.

---

## 5. Restoring the point picker in the EA dialog (if ever needed)

The removed picker was the shared `CreateTaskForm` (`src/pages/delegation/MyDayPage.tsx`). The EA board now uses `AssignTaskDialog` (`src/components/dashboard/AssignTaskDialog.tsx`). To restore the old points picker for the EA board, re-point `EmployeeDelegationBoard.tsx` back to `<CreateTaskForm />`. No data was deleted — `del_task_types` and `points_config` are intact and still power the employee self-logging flow.

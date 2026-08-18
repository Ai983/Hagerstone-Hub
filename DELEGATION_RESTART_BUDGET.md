# Delegation System — Restart Budget

**Report date:** 3 August 2026
**Question answered:** if we restart the delegation system now, what does it cost?
**Scope:** the `del_*` task-board delegation — My Day / Verify Queue / points. **Not** the WhatsApp Command System (GIE auto-delegation), which is costed in [COMMAND_SYSTEM_RESTART_BUDGET.md](COMMAND_SYSTEM_RESTART_BUDGET.md).

**Status:** ⚠️ **Cost is UNMEASURED.** An earlier version of this report attributed a verified ~$30/month Console figure to this system. That figure belongs to the **WhatsApp Command System**, not to `del_*` scoring. The corrected position is in §1: nobody knows what `del_*` scoring costs, because it has no token log.

**Sources:** [COST_REDUCTION_REPORT.md](COST_REDUCTION_REPORT.md) · [COST_OPTIMIZATION_PROGRESS_REPORT.md](COST_OPTIMIZATION_PROGRESS_REPORT.md) · [SYSTEM_REPORT.md](SYSTEM_REPORT.md) · [PHASE-1-REPORT.md](PHASE-1-REPORT.md) · [SPEC-DELEGATION-V2-AI-SCORING-SUBMISSIONS-UI.md](MARKDOWN%20FILES/SPEC-DELEGATION-V2-AI-SCORING-SUBMISSIONS-UI.md) · `del-submit-task` + `MyDayPage` source · Hub git history.

---

## 1. Headline

| | |
|---|---|
| **Cost of `del_*` AI scoring** | **UNKNOWN — never measured** |
| **What the July docs claim** | ~₹30/month — an estimate with **no telemetry behind it** |
| **Why the estimate is untrustworthy** | Guessed as "108 submissions × Haiku — negligible." No token log exists. The submission volume itself is an estimate. |
| **Known cost defect in this path** | Un-downscaled 20 MB attachments go to Claude; the CPS image fix never reached this repo |
| **Recommended sequence** | **Instrument it, fix the attachment burn, then relaunch** |
| **New subscriptions required** | **None** |

**Read:** the ₹30 figure may well be roughly right — `del_*` scoring is a low-volume flow on a cheap model. But it rests on an unverified submission count and ignores a real un-downscaled-attachment defect, so it should not be treated as measured. The fixes in §4 are worth doing regardless of what the true number turns out to be.

---

## 2. Why the ₹30 figure is unverified

The ₹30/month in [WHATSAPP_COMMAND_SYSTEM_COST.md:29](WHATSAPP_COMMAND_SYSTEM_COST.md#L29) is not a measurement:

| | GIE summarise | `del_*` scoring |
|---|---|---|
| Cost basis | **Measured** — live `gie_summaries` token log, 1,055 calls, 871K in / 716K out | **Estimated** — "108 submissions × Haiku — negligible" |
| Token telemetry | `input_tokens` / `output_tokens` columns ([gie.ts:52-53](src/lib/gie.ts#L52-L53)) | **None anywhere in the codebase** |
| Submission volume | Counted from the log | **Assumed** |

The July analysis also carried over a conclusion that does not transfer: *"Claude cost is output-dominated."* That was true of GIE, a text summariser. `del_*` scoring is an **attachment-scoring** flow — its cost is **input**-side, and `max_tokens: 800` constrains only output. The cap creates false confidence about a wide-open input.

**Attribution note:** the ~$30/month Anthropic Console figure belongs to the **WhatsApp Command System** (see [COMMAND_SYSTEM_RESTART_BUDGET.md](COMMAND_SYSTEM_RESTART_BUDGET.md)), not to `del_*` scoring. An earlier draft of this report mistakenly attributed it here. The two systems bill to the same key, which is precisely why per-function telemetry (§4 Step 2) matters.

---

## 3. Where the money actually goes

Three findings in the code explain the burn:

| # | Finding | Evidence |
|---|---|---|
| 1 | Submissions accept **PDF, XLSX, PPT, JPEG, PNG at up to 20 MB each**, unlimited count | [MyDayPage.tsx:41-48](src/pages/delegation/MyDayPage.tsx#L41-L48) — `MAX_FILE_SIZE = 20 * 1024 * 1024` |
| 2 | Every attachment is forwarded to the n8n scorer, which passes it to Claude | [del-submit-task/index.ts:308](supabase/functions/del-submit-task/index.ts#L308) |
| 3 | **The image-downscaling fix never reached delegation** | `imageForClaude.ts` was built in the **hagerstone-cps** repo (commits `46d6e1c`, `4567c89`) and wired into 13 CPS parse flows. The Hub delegation path was never routed through it. |

A multi-page PDF is converted to page-images at roughly 1,500–2,000 tokens **per page**. A 30-page PDF is ~50K input tokens for one submission. Nothing in the pipeline caps page count, attachment count, or resolution.

### 3.1 What this could plausibly cost

At Haiku 4.5 pricing ($1/MTok in, $5/MTok out), output at 800 max tokens is ~$0.004 per submission — genuinely negligible. Input is where the range lives:

| Per-submission input | Cost/submission | At ~108/mo |
|---|---|---|
| Text only, no attachment | ~2K tokens | ~$0.002 | ~₹19 |
| One un-downscaled photo | ~1.6K tokens (Anthropic caps image tokens at its own resize) | ~$0.002 | ~₹19 |
| A 30-page PDF | ~50K tokens | ~$0.05 | ~₹465 |
| Several PDFs, or n8n retries on failure | 100K+ tokens | ~$0.10+ | ~₹930+ |

So ₹30/month is defensible **if** submissions are mostly text with the odd photo — and Anthropic's own image resizing partly protects against the missing downscaler. The exposure is **PDFs and retries**, neither of which is capped anywhere in the pipeline.

The retry path deserves attention: dispatch is fire-and-forget, and during the credit exhaustion every call would have returned 402. A retrying n8n workflow would burn budget on calls that never produced a score — a mechanism where cost and outage reinforce each other.

---

## 4. Recommended plan — fix first, then relaunch

### Step 1 — Cut the token burn *(engineering, ~1 day)*

| Fix | Effect |
|---|---|
| **Port `imageForClaude.ts` into the delegation path** (downscale to ≤1568px JPEG before Claude) | CPS measured **4–8× image-token reduction** from exactly this change |
| **Cap PDF page count** sent to the scorer (e.g. first 10 pages + filename/metadata) | Bounds the worst case; a 100-page PDF currently has no ceiling |
| **Cap attachment count per submission** (e.g. 3) | Currently unlimited |
| **Lower `MAX_FILE_SIZE`** from 20 MB to ~5 MB | A 20 MB file was never reviewable evidence anyway |
| **Disable/bound n8n retries** on the Del Score Task workflow | Stops silent multiplication of cost on failure |

### Step 2 — Instrument it *(half a day)*

Add a `del_scoring_log` table mirroring `gie_summaries` — `input_tokens`, `output_tokens`, `model`, `submission_id`, `attempt_no`. **This is the single highest-value item here.** `del_*` scoring and the Command System bill to the same Anthropic key, so without per-function telemetry no one can say which system is spending what — exactly the confusion that made the ₹30 figure unfalsifiable.

### Step 3 — Make failure loud *(half a day)*

[del-submit-task/index.ts:313](supabase/functions/del-submit-task/index.ts#L313) swallows every webhook failure in a bare `.catch(() => {})` while telling the user *"AI scoring is running."* Log failures to `del_audit_log` and alert. This is what made a month-long outage invisible.

### Step 4 — Fund and relaunch

`del_*` scoring is a **small line item on a shared key**. Budget it as part of the whole Anthropic account rather than in isolation:

| | Monthly |
|---|---|
| `del_*` scoring — likely range after the §3.1 caps | **~₹20–200 (~$0.25–2.50)** |
| Anthropic account total, with the Command System **off** | ~$5–10/mo |
| Anthropic account total, if the Command System is **restarted** | ~$35–40/mo — see [COMMAND_SYSTEM_RESTART_BUDGET.md](COMMAND_SYSTEM_RESTART_BUDGET.md) |
| **Monthly limit to set** | **$75, auto-reload ON** — sized for both systems running |

The $30 cap is what caused the outage. Sizing the limit for *both* systems is what prevents a repeat, whichever one you restart first.

---

## 5. Non-AI costs — unchanged and near zero

| Component | Monthly |
|---|---|
| n8n "Del Score Task" executions (Railway) | ~₹0 — 108 runs vs GIE's 74,000 |
| Supabase `del_*` rows + Edge Function invocations | ~₹0 — inside the flat Pro bill |
| WhatsApp assign/verify alerts (Maytapi business number 46821) | **₹0 incremental** — already paid, marked KEEP |
| `delegation-uploads` Storage bucket | ~₹0 today; lowering `MAX_FILE_SIZE` also slows growth here |

**No new subscriptions are required to restart delegation.**

---

## 6. Optional add-on — defer it

The V2 spec (§0, unknown #2) leaves **audio→text transcription unresolved**; no STT provider is wired. At ~108 submissions × ~2 min, Whisper/Deepgram would run ~$1.30/month (~₹115).

**Recommendation: launch text-only.** Cheap in isolation, but it adds a vendor, a key, and a failure mode to a pipeline that just demonstrated it can fail silently for a month.

---

## 7. The free blockers — still the bigger obstacle

None of these cost anything, and delegation should not relaunch without them.

| # | Blocker | Source |
|---|---|---|
| 1 | **Verify the n8n workflow is published** — check `versionId` **vs** `activeVersionId` on "Del Score Task". MCP edits create drafts that look live in the list view. | SYSTEM_REPORT §11 risk 3 |
| 2 | **`del-score-task` is a deprecated stub** — all scoring depends on the n8n webhook being reachable. | [SYSTEM_REPORT.md:318](SYSTEM_REPORT.md#L318) |
| 3 | **5 mis-assigned roles** — `ea@hagerstone.com` sits as `procurement`; `ai@hagerstone.com` as `site_engineer`. | PHASE-1-REPORT §6A |
| 4 | **9 shared-inbox accounts** — `accounts@`, `procurement@`, `systems@`, `sales@`, `delhi@`… A shared inbox cannot own one person's tasks or points. | PHASE-1-REPORT §6B |
| 5 | **8 duplicate / codeless accounts** — same person under two rows accumulates points in parallel. | PHASE-1-REPORT §6C |
| 6 | **Point values never signed off** — all still *proposed*. Revising them post-launch destroys trust in the scores. | PHASE-1-REPORT §8 |
| 7 | **5 departments have no role, no head, no task types** — design, ea, hr, ai, digital_marketing. | PHASE-1-REPORT §7 |

Items 3–7 are a decision-and-cleanup exercise for Aniket/Bhaskar; the Phase 1 report deliberately modified no employee rows and left these for manual sign-off.

---

## 8. Bottom line

**`del_*` task-board scoring is cheap — plausibly ₹20–200/month — but nobody has measured it, and the July ₹30 figure is a guess resting on an assumed submission count.**

**It needs no new subscriptions. The work is ~2 days of engineering (token logging, attachment downscaling, page/count caps, bounded retries, loud failures) plus the roster cleanup and point sign-off, which cost nothing and matter more than the budget.**

**Set the Anthropic limit to $75 with auto-reload on — sized for this system *and* the WhatsApp Command System, since they share one key and it was the $30 cap that took both down.**

---

## 9. Confidence

| Claim | Confidence |
|---|---|
| The ₹30 doc figure is unmeasured | **Verified** — no token-log table exists for `del_*` |
| Attachments are un-downscaled on this path | **Verified in code** — `imageForClaude.ts` exists only in hagerstone-cps |
| `MAX_FILE_SIZE` is 20 MB, attachment count uncapped | **Verified in code** — MyDayPage.tsx:48 |
| Scoring failures are silently swallowed | **Verified in code** — del-submit-task/index.ts:313 |
| ₹20–200/month likely range | **Estimate** — modelled in §3.1; Step 2 replaces it with real numbers |
| The ~$30 Console figure | **Belongs to the WhatsApp Command System**, not this one |

Live `del_points` row counts and the n8n execution history could not be queried for this report (the available Supabase MCP connection timed out, and the Del Score Task workflow is not in `n8n_backups_20260523/`). Both should be checked during Step 1.

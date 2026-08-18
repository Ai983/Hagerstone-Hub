# WhatsApp Command System (Auto-Delegation) — Restart Budget

**Report date:** 3 August 2026
**System:** GIE / Command Center — captures WhatsApp **group** messages, runs them through Claude to detect director instructions, and **auto-delegates tasks** with @mention notifications.
**Question answered:** if we turn this back on, what does it cost per month?

> **Scope note.** This is the system that was *deliberately switched off* on 16 July 2026. It is distinct from the `del_*` task-board delegation (My Day / Verify Queue / points), which was never switched off — that one is costed separately in [DELEGATION_RESTART_BUDGET.md](DELEGATION_RESTART_BUDGET.md).

**Sources:** Anthropic Console monthly usage (user-verified, ~$30/mo) · [WHATSAPP_COMMAND_SYSTEM_COST.md](WHATSAPP_COMMAND_SYSTEM_COST.md) · [COST_OPTIMIZATION_PROGRESS_REPORT.md](COST_OPTIMIZATION_PROGRESS_REPORT.md) · [COST_REDUCTION_REPORT.md](COST_REDUCTION_REPORT.md) · `gie-*` Edge Function source · Hub git history.

---

## 1. Headline

| | |
|---|---|
| **Why it stopped** | **Deliberately taken down to save cost** — not a failure |
| **Claude spend that triggered it** | **~$30/month** (Console) — docs measured the summariser at ₹1,600 (~$18) |
| **Cost to restart exactly as it was** | **~₹5,700 / month (~$66)** |
| **Cost to restart on the leaner architecture** | **~₹600–1,100 / month** |
| **Biggest single line item** | Maytapi **group** number — ₹2,800/mo (fixed subscription, not usage) |
| **Decision blocker** | **Has the group number been cancelled yet?** It was Priority 1 pending. |

**Read:** the AI is not what makes this expensive — a fixed ₹2,800/month WhatsApp subscription is roughly half the bill, and it buys one capability: reading group messages. Restarting as-was costs ~₹5,700/month. Rebuilding it lean costs ~₹600–1,100/month for the same business outcome.

---

## 2. Why it was stopped

It was **switched off on purpose as a cost measure** — this was the single biggest saving in the July optimization session:

- **Frontend:** Command Center route + nav button disabled — Hub commit `c928055` (*"chore: temporarily disable Command Center"*), follow-up `6d94e21`.
- **Backend:** GIE Capture + Summary Schedule n8n workflows **unpublished**.
- **Verified from the database:** `gie_summaries` shows **zero new rows since 2026-07-16 04:07 UTC** — proving the Sonnet calls actually stopped, not just the UI.

The trigger was the Anthropic account sitting at **$28.59 of a $30/month cap with auto-reload OFF**. The command system was the dominant consumer, so it was the thing that got cut.

**Important:** the progress report is explicit that the *capability* was never judged worthless — only too expensive at that price:

> *"the command system was taken down for cost, but the **capability** (director WhatsApp instructions → tasks) still needs a cheaper replacement"* — [COST_OPTIMIZATION_PROGRESS_REPORT.md:118](COST_OPTIMIZATION_PROGRESS_REPORT.md#L118)

---

## 3. Restart budget — Option A: restore exactly as it was

| Component | What it does | Monthly |
|---|---|---|
| **Maytapi group number** (141590 / 918882979328) | The data source. Sits in all HSIPL groups, captures ~5,700 msgs/mo, posts @mention task assignments back. **Fixed subscription.** | **₹2,800** |
| **Claude — GIE summarise** (`claude-sonnet-4-6`, 30-min cron, `max_tokens: 3000`) | Reads each capture window, detects director instructions, decides what becomes a task. | **~₹2,580 (~$30)** |
| **n8n executions + storage** (Railway) | GIE Capture fires **once per group message** — it generated 74,000+ stored executions. | **~₹200–300** |
| **Supabase — marginal** | Rows for captures/summaries/tasks + edge invocations. | **~₹50–100** |
| **Total** | | **≈ ₹5,700 / month (~$66)** |

### 3.1 Two things that changed since July — both in your favour

- **n8n execution pruning is now on** (`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=336`) and "save successful executions" is off for GIE Capture. The old ₹400–500 Railway drag should now be ~₹200–300.
- **A 1-hour prompt-cache TTL was committed but never deployed** (`8f5283c`, marked moot when the system went down). Prompt caching was measured at ~55% hit rate on the 5-min default; the 1h TTL keeps the system prefix warm across the 30-min cron cadence. **Deploying this on restart is a genuine, already-written saving** — it targets the largest Claude line item and costs nothing to ship.

### 3.2 A discrepancy worth resolving

Your Console shows **~$30/month**; the July report measured the summariser at **₹1,600 (~$18/month)** from the live `gie_summaries` token log (1,055 calls / 22 days). The gap is likely the other GIE functions billing to the same key — `gie-direct-delegate` and `gie-task-reminders` — plus the founder chatbot, none of which were in that ₹1,600.

**This budget uses your $30**, since Console billing beats a per-component estimate. Worth confirming the split before restart, because if the summariser is genuinely ~$18 then ~$12/month is coming from functions no one has been costing.

---

## 4. Restart budget — Option B: the leaner rebuild (recommended)

The proposed replacement architecture: **self-hosted WhatsApp capture + event-driven Haiku** instead of Maytapi + a 30-minute Sonnet cron.

| Component | Change | Monthly |
|---|---|---|
| **WhatsApp group capture** | Self-hosted **Evolution API / WAHA** in Docker on the existing Railway project, replacing the Maytapi group number | **~₹200–400** (vs ₹2,800) |
| **Claude** | **Event-driven** (only on messages that could plausibly be an instruction) instead of every 30-min window; cheaper model where recall permits | **~₹300–600** |
| **n8n / Supabase** | Unchanged | ~₹100 |
| **Total** | | **≈ ₹600–1,100 / month** |

**Saving vs Option A: ~₹4,600–5,100/month (~80%).**

### 4.1 Constraints you cannot design around

- **Meta's official WhatsApp Cloud API cannot read group messages.** It is not an option for capture, at any price. Group capture means Maytapi or self-hosted — there is no official path.
- **Self-hosted carries the same ban risk as Maytapi** (both unofficial). The cost report's mitigation: run 2 weeks in parallel and wire logout alerts before cutover.
- **Do not downgrade the summariser model blindly.** Haiku was measured at only **74% recall on director instructions** — it misses a quarter of them. Event-driven filtering is the safe way to cut Sonnet volume; swapping the model outright is not.

---

## 5. The decision that gates everything

**Cancelling the Maytapi group number was Priority 1 on the pending list** ([COST_OPTIMIZATION_PROGRESS_REPORT.md:110](COST_OPTIMIZATION_PROGRESS_REPORT.md#L110)), owned by you, in the Maytapi console. Its status is not recorded in any doc here.

| If the group number is… | Then restart means… |
|---|---|
| **Still active** (not yet cancelled) | You are **already paying ₹2,800/mo for a dead system**. Restarting Option A costs only the marginal ~₹2,900 of Claude + infra. Decide fast — every idle month is ₹2,800 wasted either way. |
| **Already cancelled** | Option A requires **re-subscribing** ₹2,800/mo. At that point Option B is clearly better — you'd be standing up new infrastructure regardless. |

**Check this first.** It changes the answer more than anything else in this report.

---

## 6. Recommendation

1. **Check the Maytapi group-number status today.** If still active and you don't intend to restart within ~a month, cancel it — ₹2,800/month is burning for nothing.
2. **Raise the Anthropic limit to $75 with auto-reload ON** before restarting anything. The $30 cap is what killed this system; restoring a ~$30/month consumer under a $30 cap repeats the outage exactly.
3. **Deploy the already-written prompt-cache commit `8f5283c`** as part of any restart. Written, committed, never shipped, targets the biggest line item.
4. **Prefer Option B.** Same business capability at ~₹600–1,100/month instead of ~₹5,700. The 2-week parallel run is the safe cutover.
5. **Confirm the $30 ÷ $18 split** between `gie-summarise` and the other `gie-*` functions, so the restart budget is built on measured per-function numbers.

---

## 7. Bottom line

**The WhatsApp command system was switched off deliberately to save money — it cost ~₹4,900–5,700/month, about a third of the entire Hagerstone infrastructure bill, and the Claude side of it (~$30/month) was what pushed the Anthropic account into its cap.**

**Restarting it exactly as it was costs ~₹5,700/month (~$66). Rebuilding it on self-hosted capture with event-driven Claude delivers the same capability for ~₹600–1,100/month.**

**Roughly half the cost is not AI at all — it is one ₹2,800/month WhatsApp subscription whose only job is reading group messages. That is the number to attack, and self-hosting is the only way to attack it, because Meta's official API cannot read groups at any price.**

---

## 8. Confidence

| Claim | Confidence |
|---|---|
| System stopped deliberately for cost | **Verified** — commit `c928055`, workflows unpublished, `gie_summaries` zero rows since 2026-07-16 |
| Claude side ~$30/month | **Verified** — Anthropic Console, monthly, user-confirmed |
| Maytapi group number ₹2,800/mo | **Verified** — user-confirmed pricing, full inventory traced across code/DB/n8n |
| Meta Cloud API cannot read groups | **Verified** — stated as a hard constraint in the cost report |
| Haiku at 74% recall on director instructions | **Measured** — per the cost report |
| Option B at ₹600–1,100/mo | **Estimate** — architecture proposed but not built or benchmarked |
| Group number's current cancel status | **Unknown** — not recorded in any doc; check the Maytapi console |

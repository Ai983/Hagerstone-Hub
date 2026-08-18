# WhatsApp Command System — Current Cost Report

**Date:** 16 July 2026
**Scope:** the GIE / Command Center pipeline — the system that captures WhatsApp **group** messages, runs them through Claude to detect director instructions, and auto-dispatches tasks with @mention WhatsApp notifications.
**Sources:** live `gie_summaries` token log (Hub DB), Maytapi pricing (user-confirmed), Railway + Supabase billing screenshots (16 Jul 2026).

---

## 1. Headline

| | |
|---|---|
| **WhatsApp Command System cost** | **~₹4,900–5,000 / month (~$57)** |
| Share of the entire Hagerstone stack (~₹15,400/mo) | **~32%** |
| Biggest line item | Maytapi group number — ₹2,800/mo |
| Only real optimisation levers | The Maytapi group number and the n8n execution bloat it creates |

The command system is roughly **one-third of the total monthly infrastructure bill**, and almost all of it is one WhatsApp number plus the Claude calls that read what flows through it.

---

## 2. Cost Breakdown

| Component | What it does in the pipeline | Monthly cost | Basis |
|---|---|---|---|
| **Maytapi — group number** (141590 / 918882979328) | The data source. Sits in all HSIPL groups, captures ~5,700 msgs/mo, and posts @mention task assignments back. | **₹2,800** | User-confirmed Maytapi price (₹2,800/number) |
| **Claude — GIE summarise** (Sonnet 4.6, 30-min cron) | Reads each capture window, detects director instructions, decides what becomes a task. | **~₹1,600** | Live `gie_summaries`: 1,055 calls / 22 days, 871K in + 716K out → ~$18/mo |
| **n8n execution + storage on Railway** | "GIE Capture" workflow fires **once per group message**; it is the dominant driver of the 74,000+ stored executions. | **~₹400–500** | Attributed share of Railway's $12.63/mo; GIE Capture is the top execution generator |
| **Claude — delegation scoring** (Haiku 4.5, 800 max tokens) | Scores each task submission for delegation points. | **~₹30** | ~108 submissions/mo × Haiku — negligible |
| **Supabase — marginal** | Row storage for captures/summaries/tasks + edge-function invocations. | **~₹50–100** | Tiny share of the flat Supabase bill |
| **Total** | | **~₹4,900–5,000/mo** | |

---

## 3. Notes on Scope

- **The founder chatbot** (Sonnet, ~34 msgs/mo) is negligible and only loosely part of this system — excluded.
- **The business number** (46821, ₹2,800/mo) is *not* counted here. It runs the transactional side — imprest confirmations, founder/director approval requests and their YES/OK replies, RFQ/PO dispatches, and task alerts. If you consider approval-reply routing part of "the command system," add up to ₹2,800 more, pushing WhatsApp-attributable spend toward ₹7,700/mo. I've kept it separate because the *capture-and-dispatch* pipeline runs on the group number.
- **Claude cost is output-dominated:** 716K output vs 871K input tokens, but output is 5× the price — so the GIE spend is driven by how much the summariser *writes back*, not by model tier. It is already on the correct model: Haiku was measured at only 74% recall on director instructions and is not a safe swap here.

---

## 4. Where the Money Actually Goes

```
Maytapi group number   ████████████████████████████  ₹2,800  (57%)
Claude GIE summarise   ████████████████              ₹1,600  (33%)
n8n / Railway share    ████                          ₹  450  ( 9%)
Supabase + del-scoring  ▍                             ₹  130  ( 3%)
```

**Read:** 90% of the cost is two things — the group WhatsApp number and the Claude summariser. Everything else is rounding.

---

## 5. What Can Move (and What Can't)

| Lever | Effect | Notes |
|---|---|---|
| **Group number → self-hosted Evolution API / WAHA** (Docker on existing Railway) | ₹2,800 → a few hundred ₹ | Biggest saving. Same ban risk as Maytapi (both unofficial), so run 2 weeks in parallel and wire logout alerts before cutover. Meta's official Cloud API **cannot** read groups, so it is not an option for capture. |
| **n8n execution pruning** + turn off "save successful executions" on GIE Capture | ~₹300/mo + stops bill creep | 15–30 min of settings. `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=336`. Safe. |
| **Cut Claude call volume** (fewer summarise windows / tighter cadence) | Marginal | Already tuned; do **not** downgrade the model. |
| **Supabase / delegation scoring** | ~₹0 realistic | Too small to bother. |

**Bottom line:** the WhatsApp Command System costs **~₹4,900/mo today**. Realistically ~₹2,400–2,600 of that (the group number + n8n bloat) is addressable, mostly by replacing Maytapi's group number with a self-hosted WhatsApp gateway. The Claude summariser (~₹1,600) is a genuine, well-optimised operating cost that should stay.

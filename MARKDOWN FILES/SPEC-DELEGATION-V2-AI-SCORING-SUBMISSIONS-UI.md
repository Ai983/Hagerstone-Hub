# SPEC — Delegation V2: AI Scoring, Rich Submissions & Simplified UI

**Place in:** `/hagerstone-task-delegation/`
**Amends:** the built Phase 1–2 (tables, submit/verify Edge Functions) and the *planned* Phase 3 (PointsCard/Leaderboard). Where this conflicts with the deterministic scoring in Phase 2/3, **this wins.**
**Honors:** the `hagerstone-task-delegation` skill — its zero-fallback rules (§2 of the skill), status-enum discipline, RLS-without-recursion, `del_audit_log` (`logged_at`), and Maytapi delivery-tracking pattern all still apply. Read that skill's `references/database-schema.md` and `references/n8n-notifications.md` alongside this file.

---

## 0. Confirmed config + honesty notes (read first)

**Config block (filled from this project's confirmed reality):**
```
HOST_REPO           = hagerstone-hub
SUPABASE_PROJECT_ID = tpfvnerrjhqwipyonngf   (Hub; cps + finance are schemas in the SAME project — Case A)
SHARED_AUTH         = yes  → reuse public.employees (role at employees.role, auth at auth_user_id, is_head boolean)
TABLE_PREFIX        = del_
GROUPING            = employees.role  (NOT employees.department — that is a site location)
```

**Unknowns I will not invent (resolve before the matching phase):**

| # | Unknown | Why it matters | Default in this spec |
|---|---|---|---|
| 1 | **AI scoring is inherently softer/more gameable than a rule.** | You asked for an agent that scores work "perfectly" and "not misguided." I cannot guarantee that — an LLM can be swayed by a confident-sounding submission. | I bound the risk three ways: the effort-tier is a hard **ceiling**, the agent output is **advisory only**, and the **team-head approval gate stays mandatory**. This makes it *as grounded as possible*; it is not infallible. |
| 2 | **Transcription provider** (audio → text) | The audio button needs a real STT service. I will not claim one is wired. | `⚠️ CHOOSE`: OpenAI Whisper API, Deepgram, or AssemblyAI. If the HireFlow calling pipeline already transcribes, reuse that. Spec treats STT as a pluggable step. |
| 3 | **Scoring model + credentials** | The annotating agent calls an LLM. | Default: **Claude API**, same model/key as the CPS invoice-parsing setup. `⚠️ VERIFY` the exact model string in your current config — do not hardcode a guessed one. |
| 4 | **File storage** | Attachments (PPT/PDF/XLSX/images) need a home. | **Supabase Storage** bucket `delegation-uploads` in the Hub project. `⚠️ VERIFY`/create the bucket + policies. |

> I am not certain about items 1–4. They are bounded risks or "choose a provider," not facts.

---

## 1. What changes vs. what was built

| Area | Before (Phase 1–2 built / Phase 3 planned) | After (this spec) |
|---|---|---|
| **Point award** | `del-submit-task` computed tier points (full/half/zero by on-time) directly. | Submission now carries **evidence**; an **AI annotating agent** proposes the points *within the tier ceiling*; the head confirms/adjusts. |
| **Submission** | Click "Submit." | Speak (audio→transcript) **or** type, **plus** attach PPT/PDF/XLSX/PNG/JPEG. |
| **Head review** | Approve/reject a task. | Approve/adjust/reject based on the **agent's summary** (with raw submission + attachments visible). |
| **Assignment** | self / head-in-own-group / founder-any. | Founder → any head + any employee (cross-dept); head → own + cross-dept members; employee → self; **head/founder can delete irrelevant self-assigned tasks.** |
| **Notify** | (in-app only) | **WhatsApp to assignee on assignment** (Maytapi), with delivery tracking + in-app fallback. |
| **Leaderboard** | 3D/WebGL podium for 1st/2nd/3rd. | **WebGL removed** — simple medal rows, lightweight, mobile-first, layman language. |

---

## 2. Assignment matrix (exact, server-enforced)

| Assigner | May assign to |
|---|---|
| **Founder / admin** | Any team head **and** any employee, **any department** |
| **Team head** (`is_head = true`) | Members of **their own role_group** *and* members of **other role_groups** (cross-department) |
| **Employee** | **Themselves only** (self-assign) |

- **Review + delete of self-assigned tasks:** a self-assigned task is visible to the assignee's **team head** and the **founder**, who may **delete (cancel)** it if irrelevant. Deletion = set `status='cancelled'` + audit reason (never a hard delete; honors skill rule "never silently delete").
- **Enforce server-side** via a `SECURITY DEFINER` function `del_can_assign(assigner_uid, assignee_uid, target_role_group)` that RLS calls — *not* only in the UI (skill §1.2). Hiding the button is not security.
- **Cross-department watcher (recommended, honors skill §1.1):** when a task is assigned across departments, add the assignee's own head as an **informed watcher** (read-only visibility, no approval gate) so nobody gets work dropped on them with their manager blind. Optional but advised.

---

## 3. Status flow + simple UI labels

**Canonical backend enum** (migrate the Phase-1 CHECK to this — keep DB CHECK and app constant identical, skill rule #1):
```
assigned | in_progress | submitted | under_review | completed | rejected | cancelled
```
- `submitted` = evidence in, agent scoring running.
- `under_review` = agent produced a proposal; awaiting head.
- `completed` = head approved → **this is "Done."**

**UI labels (layman, Hinglish-friendly for site teams — backend value → shown text):**
| Backend | Shown to user |
|---|---|
| assigned | **To Do / Naya Kaam** |
| in_progress | **Doing / Chal Raha Hai** |
| submitted / under_review | **Sent for Review / Review Mein** |
| completed | **Done / Ho Gaya** ✅ |
| rejected | **Wapas Aaya** |

The board is 4 visible columns (To Do → Doing → Sent for Review → Done). `under_review` sits inside "Sent for Review." `rejected` returns the card to "To Do" with the reason shown.

---

## 4. Submission capture (audio / text / attachments)

When the assignee taps **Submit work** on a task:

1. **Two input modes, side by side:**
   - **🎤 Speak** — record audio in-browser → upload to storage → send to the STT provider (item #2) → store the returned transcript as the submission text. Show the transcript so the user can confirm/edit before sending.
   - **⌨️ Write** — a plain textarea.
2. **📎 Attach** — accept `.pptx .pdf .xlsx .xls .png .jpg .jpeg` (extendable). Multiple files. Upload to Supabase Storage `delegation-uploads`, path `task/{task_id}/{uuid}-{filename}`. Validate type + size client- and server-side.
3. On send → `del_tasks.status='submitted'` → trigger the scoring pipeline (§5).

**New table `del_submissions`:**
```sql
CREATE TABLE public.del_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES public.del_tasks(id) ON DELETE CASCADE,
  submitted_by  UUID NOT NULL REFERENCES auth.users(id),
  input_type    TEXT NOT NULL CHECK (input_type IN ('audio','text')),
  raw_text      TEXT,                       -- typed text OR final transcript
  audio_url     TEXT,                       -- storage path if input_type='audio'
  transcript_status TEXT DEFAULT 'n/a'      -- 'pending'|'done'|'failed'|'n/a'
                   CHECK (transcript_status IN ('pending','done','failed','n/a')),
  attachments   JSONB DEFAULT '[]'::jsonb,  -- [{url,type,name,size}]
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```
**Storage:** create bucket `delegation-uploads` (private). RLS/policies: an assignee may upload to their own task's path; head/founder of the task's `role_group` may read. `⚠️ VERIFY` bucket + policy syntax against current Supabase docs.

---

## 5. The annotating agent (the heart — design carefully)

**Where it runs:** recommend an **n8n workflow** (matches the existing Maytapi/n8n stack, gives retries + observability for the multi-step audio→extract→LLM pipeline). An Edge Function is acceptable if you prefer atomic DB writes — pick one; do not build both.

**Pipeline (on `del_submissions` insert / `status='submitted'`):**
1. If audio and not yet transcribed → call STT (item #2) → write `raw_text`, `transcript_status='done'`.
2. **Extract evidence from attachments** (best-effort, conservative): PDF → text; XLSX → sheet/cell summary; PPTX → slide text; images → analyze via the LLM's vision (Claude supports image input). If extraction fails, pass a note ("attachment present but unreadable") — never block.
3. **Call the scoring agent** (item #3) with a strict, grounded prompt (sketch below).
4. Write the proposal to `del_points` (pending) + `del_submissions` linkage; set `del_tasks.status='under_review'`.

**Inputs given to the agent:**
- Task context: title, description, `type_code` label, `role_group`, `effort_tier`.
- **Ceiling** = tier full points, reduced to the half value if the submission is **late** (on-time logic from Phase 2 still applies as the band). The agent may propose **0 … ceiling**, never above.
- The submission `raw_text` + extracted attachment evidence.

**Grounding rules baked into the prompt (this is what keeps it from being misguided):**
- Score **only** what is concretely described and evidenced; reward work that matches the **niche** of the task's role and type.
- **Do not** be swayed by confident tone, length, or buzzwords without substance.
- If evidence is vague, missing, or mismatched to the task → propose **low** and set a flag; do **not** give benefit of the doubt.
- Never exceed the ceiling. Output must be a single JSON object, low temperature.

**Required JSON output (parsed server-side):**
```json
{
  "proposed_points": 0,
  "ceiling": 10,
  "confidence": "high|medium|low",
  "summary": "2–4 sentence plain-language summary FOR THE TEAM HEAD",
  "reasoning": "why this score, tied to the evidence",
  "evidence_checklist": ["what was provided", "what was missing"],
  "flags": ["vague", "no_attachment", "possible_mismatch", "..."]
}
```

> Honesty: vision/document extraction quality varies, so the agent is **advisory**. The **ceiling cap + head approval** are the real safeguards. I will not claim the agent alone awards "perfect" points.

---

## 6. Head review (summary-based) → final award

- The head's **Verify Queue** shows, per `under_review` task: the agent **summary**, **proposed points**, **confidence**, **flags**, plus links to the **raw submission, transcript, and attachments**.
- Head actions: **Approve** (accept proposed) · **Adjust** (set any value 0…ceiling, reason required) · **Reject** (reason required → task back to `assigned`/`rejected`).
- On Approve/Adjust → `del_points.points = final value`, `status='verified'`, `del_tasks.status='completed'`.
- Founder/admin can act anywhere as fallback (skill: founder sees/acts on everything).

**`del_points` additions:**
```sql
ALTER TABLE public.del_points
  ADD COLUMN submission_id   UUID REFERENCES public.del_submissions(id),
  ADD COLUMN proposed_points INT,
  ADD COLUMN summary         TEXT,          -- the agent summary the head reviewed
  ADD COLUMN agent_meta      JSONB;         -- {confidence, flags, reasoning, model}
-- existing: points (final), reason, status (pending->verified/rejected), verified_by, period_week, period_month
```

**Anti-gaming (layered):** tier ceiling caps the max · agent flags suspicious submissions · head must approve · raw evidence stored for audit · `daily_cap` per `type_code` still applies · all actions in `del_audit_log` (`logged_at`).

---

## 7. WhatsApp on assignment (Maytapi + n8n, delivery-tracked)

- **Trigger:** on `del_tasks` insert with `status='assigned'` (and on reassignment) → n8n flow → Maytapi WhatsApp to `employees.phone`: task title, who assigned it, due date, deep link to the task.
- **Delivery tracking (skill rule #7):** record every send in `del_notifications (task_id, recipient, channel, status pending|sent|failed, attempts, provider_msg_id, logged_at)`. If WhatsApp fails twice → **in-app inbox** (+ email if configured). "Assigned" must never silently mean "not notified."
- Maytapi specifics (Phone ID 46821, Product ID `b8cce1b9-0f9f-4aef-994c-d232716471f0`) — `⚠️ VERIFY` current endpoint/payload in Maytapi docs before wiring; they change.

---

## 8. Stage visibility / oversight (founder + heads, cross-department)

- **Founder/admin oversight board:** every task across all departments, grouped by `role_group` and stage, with live counts of `assigned / in_progress / under_review / completed`, and a per-department **pending-review** count.
- **Head visibility:** their own `role_group` tasks **plus** any task they assigned cross-department (RLS already allows `assigned_by = me`). Watchers (if enabled, §2) get read-only visibility.
- Realtime: reuse the existing **`gamification_pulse`** pattern / dashboard refresh rather than a separate channel (consistent with the live system). Stage changes update the boards on the existing refresh path.

---

## 9. Remove WebGL + simplify the whole portal

**Remove:**
- Delete the 3D/WebGL animated podium for 1st/2nd/3rd from the leaderboard (any `three`/WebGL/heavy `framer-motion` model). Remove the import and the dependency if nothing else uses it, so it stops loading.

**Replace with:**
- A **plain medal list**: 🥇🥈🥉 + name + points, then ranked rows; current user row highlighted ("Aap"). Pure HTML/CSS, no canvas. Loads instantly on a low-end phone.

**Portal-wide simplicity (so a site engineer can use it):**
- **Mobile-first**: single-column on phones; large tap targets (min ~44px); the 🎤 Speak and 📎 Attach buttons big and obvious.
- **Layman language / Hinglish** for site-facing copy (per skill convention); short labels, minimal text, clear icons.
- Every screen has explicit **loading / empty / error** states (skill rule #8) — e.g. "Aapko koi kaam nahi mila" instead of a blank table.
- Buttons/spacing aligned via the existing design tokens (CSS vars, brand brown/gold); no hardcoded colors.
- Keep bundle light — lazy-load pages, avoid heavy animation libs on the hot path.

---

## 10. New tables / migrations (summary)

1. **Widen `del_tasks.status` CHECK** → `assigned|in_progress|submitted|under_review|completed|rejected|cancelled` (keep app enum identical).
2. **`del_submissions`** (§4) + RLS (assignee writes own; head/founder of role_group reads).
3. **`del_points` additions** (§6): `submission_id, proposed_points, summary, agent_meta`.
4. **Storage bucket `delegation-uploads`** + policies (§4).
5. **`del_notifications`** (§7) for WhatsApp delivery tracking.
6. **`del_can_assign()`** SECURITY DEFINER + update `del_tasks` RLS (INSERT) to call it; add **DELETE/cancel** policy for head/founder (§2).
7. **`del_audit_log`** (if not already present) with `logged_at` (skill rule #10) — log assign/reassign/status/score/review.
8. (Recommended) **watchers** table or column for cross-dept informed-watcher (§2).

> Confirm each migration applied and test RLS per role **before** UI (skill build order). Verify all policy/CHECK syntax against current Postgres/Supabase.

---

## 11. Build order (this V2, layered on what exists)

1. **Migrations** §10 (enum widen, `del_submissions`, `del_points` cols, bucket, `del_notifications`, `del_can_assign`, audit, watchers).
2. **Storage + upload** in `del-submit-task` (audio + attachments) → write `del_submissions`, set `submitted`.
3. **STT step** (item #2) — transcription, conservative failure handling.
4. **Annotating agent pipeline** (§5) — extract → LLM → write proposal → `under_review`. (n8n recommended.)
5. **Head Verify Queue V2** (§6) — summary + evidence + approve/adjust/reject → `completed` + final `del_points`.
6. **WhatsApp on assign** (§7) via n8n+Maytapi + delivery tracking + in-app fallback.
7. **Assignment matrix** (§2) wired through `del_can_assign()`; cross-dept watcher.
8. **Oversight boards** (§8) for founder + heads.
9. **Remove WebGL + simplify UI** (§9) — medal list, mobile-first, layman copy, loading/empty/error states.
10. **Zero-fallback hardening pass** — walk the skill's `references/worst-case-scenarios.md` and confirm each guard holds.

---

## 12. Open decisions before build
1. **STT provider** (item #2) — Whisper / Deepgram / AssemblyAI, or reuse HireFlow's?
2. **Scoring engine host** — n8n (recommended) or Edge Function?
3. **Ceiling policy** — confirm the agent's max = tier full (and half when late), with the agent free to propose lower. (Recommended.)
4. **Watchers on** — enable the cross-department informed-watcher? (Recommended on.)
5. **Confirm model + key** for the agent (item #3) and the Maytapi payload (item #7) against current docs.

---

*End. The tier ceiling + mandatory head approval are what make AI scoring safe — the agent is advisory, not the final word. STT, the model string, the storage bucket, and the Maytapi payload are unverified — confirm before the matching step.*

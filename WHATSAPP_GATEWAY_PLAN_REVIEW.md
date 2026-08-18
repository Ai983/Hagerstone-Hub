# WhatsApp Gateway Plan — Review & Inventory Correction

**Date:** 2026-07-20
**Reviewer:** Claude (session with Aniket)
**Subject:** [WHATSAPP_GATEWAY_PLAN.md](WHATSAPP_GATEWAY_PLAN.md) — verification of its consumer inventory
before any code is written.

**Verdict:** architecture is sound; **the consumer inventory is materially incomplete**.
Do not start Phase 2 until the gaps in §3 are resolved.

---

## 1. Question asked: separate repo, or build it inside the Unified System / Hub code?

**Answer: separate private repo.** Recommended location `D:\hs\whatsapp-gateway\`
(as the plan's Phase 2 already assumes).

The objection raised — *"the Hub has nothing on Railway"* — is correct, and is the
argument **for** separation rather than against it:

| | Hub | Gateway |
|---|---|---|
| Artifact | Static SPA bundle | Long-lived Node process |
| Host | Vercel + Supabase edge functions | Railway, 1 replica, no sleep |
| State | Stateless | WhatsApp WebSockets held in memory |
| Repo visibility | **Public** | Must be private |

Four concrete reasons:

1. **No shared runtime.** The Hub has no Dockerfile, no server, no Node process today.
   Adding one means one repo with two unrelated build systems and deploy targets.
2. **Redeploy coupling is actively harmful.** A Hub UI commit would trigger a gateway
   redeploy, and every gateway redeploy drops the live WhatsApp sockets.
3. **Secrets.** The gateway needs `HUB_SERVICE_ROLE_KEY` and persists Baileys Signal
   auth keys. [_shared/maytapi.ts:3](supabase/functions/_shared/maytapi.ts#L3) already
   documents that this repo is public and keys must never land in it. Hard rules #7/#8.
4. **Independent lifecycle.** Pairing/reconnect fixes have nothing to do with Hub
   releases and should not share CI, review, or rollback surface.

**What legitimately stays on the Hub side:**
- Phase 1 SQL migration (`wa_*` tables — they live in the Hub Supabase project)
- Phase 5.1 edit to `supabase/functions/_shared/maytapi.ts` + two new edge secrets
- The plan doc and this review
- Later (optional): admin page for session status / QR re-pairing

The two systems share nothing but an HTTP contract, so there is no code dependency to manage.

---

## 2. Question asked: will the Maytapi-compatible gateway cover **all** our Maytapi use cases?

**Answer: not as currently specified.** The outbound-text and outbound-media paths
cover the majority of live traffic, but the plan under-counts consumers and omits two
whole capability classes.

What the plan's gateway **does** implement: `POST /maytapi/:productId/:phoneId/sendMessage`
for `type: text | media | link`, plus inbound forwarding of **individual, text-only** messages.

---

## 3. Verified gaps

### 3.1 Edge functions: 7 touch Maytapi, not 5

The plan lists 5, all reached via the shared helper. Two more exist:

| Function | Problem |
|---|---|
| [gie-direct-delegate](supabase/functions/gie-direct-delegate/index.ts#L29-L56) | **Inlines its own Maytapi call** — the file comment says "Maytapi code inlined, no _shared import." Phase 5.1 only edits `_shared/maytapi.ts`, so this function would keep calling Maytapi after cancellation and silently stop working. |
| [maytapi-list-groups](supabase/functions/maytapi-list-groups/index.ts) | Calls `GET /{pid}/{phone}/getGroups` and `GET /{pid}/{phone}/status`. **The gateway implements neither endpoint.** |

`maytapi-list-groups` is not isolated — it is reached from the UI:
[src/lib/gie.ts:342](src/lib/gie.ts#L342) `fetchMaytapiGroups()` →
[ManageGroups.tsx:113](src/components/dashboard/gie/ManageGroups.tsx#L113) "add group" picker.
Without `getGroups`, that picker breaks. Without `status`, the logged-out-session
detection at `maytapi-list-groups` breaks too — and that check exists specifically
because Maytapi returns HTTP 200 on a dead session.

### 3.2 The group number is not disposable

The plan states only the business number (46821) matters and the group product is
"being cancelled independently."

[_shared/maytapi.ts:17-22](supabase/functions/_shared/maytapi.ts#L17-L22) defines a
full second phone context: Ma'am's number `918882979328` (phone `141590`, product
`f09cb10a…`), used by the exported `sendToGroupWhatsApp()` for GIE group delegation
with `mentionedList` @mentions.

**Cancelling that product kills GIE group delegation.** This needs an explicit
decision, not an assumption. If group delegation is to be retained, the gateway needs
a **second paired session** (the plan's optional `hagerstone-grp`) promoted from
"later/optional" into the main cutover scope.

### 3.3 n8n: ~16 active WhatsApp workflows, not 4

The plan names 4. Live n8n (`search_workflows`, 42 total) shows these **active**
WhatsApp-touching workflows:

| Workflow | In plan? |
|---|---|
| CPS — Build 5 — Founder PO Approval | yes |
| WF — Daily Imprest Ageing Digest to Founder | yes |
| Founder Gate Notification - MAYTAPI (TEST) | yes |
| Director Gate Notification - MAYTAPI (TEST) | yes |
| CPS — Build 1 — RFQ WhatsApp Dispatch | partly ("RFQ/PO dispatch") |
| CPS — Build 4 — PO WhatsApp Dispatch (PRODUCTION) | partly |
| CPS — Build 6 — Payment Release Approval | **no** |
| CPS — Build 7 — Advance Request Approval | **no** |
| CPS — Invoice Deadline Reminders & Auto-Block | **no** |
| CPS — Delivery Schedule Dispatch | **no** |
| CPS — Site Stock Stale Reminder (24h) | **no** |
| WF1 — Imprest Submission Confirmation | **no** |
| WF2 — Founder Director WhatsApp Approval | **no** |
| WF3 — Weekly & Monthly Reports to Founder | **no** |
| WF4 — PO Finance Dispatch Bridge | **no** |
| MetaLeads-GoogleSheets-Processor | **no** |

**Caveat on this table:** it is derived from workflow names and descriptions, not from
inspecting each workflow's nodes. Some of these send WhatsApp indirectly by calling a
Hub edge function rather than hitting Maytapi's API themselves — those need no rewire.
**A per-workflow node audit is required to produce the true list.** See §5.

### 3.4 Two capability gaps in the gateway design

| Gap | Affected consumer | Current status |
|---|---|---|
| **Inbound media** — `forwardInbound()` forwards text only; there is no media download / re-upload path | CPS Build 3 (WhatsApp quote receiving — vendors send quote PDFs) | Build 3 inactive |
| **Inbound group messages** — `sessionManager.ts` does `if (!isGroup && body)`, skipping groups by design | GIE — Capture (leadership group messages → task creation) | GIE Capture inactive |

Both target systems are currently switched off, so deferring is defensible — but the
plan should say **"deferred, and here is what reviving them costs"** rather than omit
them. Reviving Build 3 in particular requires new gateway code, not a config change.

### 3.5 Unchanged from the plan (still open, still valid)

- The **attendance punch system** calling Maytapi from Google Cloud IP `34.116.28.5`
  (~15–25 msgs/day, Hindi IN/OUT confirmations) has **no known owner**. Must be traced
  before Maytapi cancellation or attendance confirmations go dark silently.

---

## 4. What the plan gets right

Worth keeping, unchanged:

- **Maytapi-compatible API surface** — the single best decision here. Migration per
  consumer is a URL + key swap, and rollback is the reverse. Response shape
  (`{success, data:{msgId}}`) already matches what
  [_shared/maytapi.ts:61-63](supabase/functions/_shared/maytapi.ts#L61-L63) parses.
- **Auth state in Supabase** rather than on disk — sessions survive Railway redeploys.
- **Serialized per-session send queue with 3–8s jitter** — correct anti-ban posture.
- **Phase 4 Step 0** (verify the n8n gates' inbound field parsing before cutover) —
  correctly identified as the highest silent-breakage risk.
- **Parallel run with Maytapi still paid** before cancellation.
- Risk section is honest about Baileys being an unofficial client.

---

## 5. Recommended next actions, in order

1. **Per-workflow n8n node audit.** For each of the ~16 active workflows in §3.3, open
   the nodes and record: does it call `api.maytapi.com` directly, or via a Hub edge
   function? Which product/phone ID? Text or media? Produce the corrected consumer
   inventory. *(Not yet done — this is the main outstanding verification.)*
2. **Decide the group-number question with Aniket.** Cancel the group product and lose
   GIE group delegation, or keep it and add `hagerstone-grp` as a second session in
   the main cutover scope. This changes Phase 4 and Phase 7.
3. **Add `getGroups` and `status` endpoints to the Phase 2 spec** (Baileys supports
   both: `sock.groupFetchAllParticipating()` and connection state), or accept that the
   GIE ManageGroups picker breaks.
4. **Add `gie-direct-delegate` to the Phase 5.1 rewire list** — or better, refactor it
   to use `_shared/maytapi.ts` so there is exactly one call site to change.
5. **Trace the attendance punch system owner** (unchanged from the plan).
6. **Explicitly mark inbound-media and inbound-group as deferred**, with a note on what
   reviving Build 3 / GIE Capture would require.
7. Only then: update `WHATSAPP_GATEWAY_PLAN.md` and begin Phase 1.

---

## 6. Cost note

The plan's ₹5,600/mo → ₹450/mo saving assumes **both** Maytapi products are cancelled.
If the group product is retained per §3.2, the saving is roughly halved (~₹2,800/mo
business product only, minus ~₹450/mo Railway). Re-state the business case once the
§5.2 decision is made.

---

## Verification method

- `Grep` for `maytapi` across `hagerstone-hub/` → 18 files, 7 of them edge functions
- Read of `supabase/functions/_shared/maytapi.ts` in full
- `Grep` with context over `gie-direct-delegate`, `maytapi-list-groups`, `src/`
- `mcp__claude_ai_n8n__search_workflows` (limit 100) → 42 workflows, live instance
- **Not done:** per-workflow node inspection (see §5.1); no live Maytapi console check

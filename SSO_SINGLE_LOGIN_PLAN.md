# Hagerstone Suite — Single-Login (SSO) Implementation Plan

> **Date:** 25 July 2026
> **Goal:** Log in ONCE at the Hub → every module (CPS, Finance web, Finance mobile) opens already authenticated. No second login.
> **Mechanism:** Shared auth-session cookie on `.hagerstone.com` — the same pattern behind Google Workspace / Zoho "sign in once."
> **Hard prerequisite:** `DOMAIN_UNIFICATION_PLAN.md` must be done first. Cookies **cannot** be shared on `*.vercel.app` (browsers block cookies on the `vercel.app` public suffix). SSO is impossible until the apps live on subdomains of one domain.
> **Verified against real code (25 Jul 2026):** Hub `src/lib/supabase.ts` (default localStorage), CPS `src/integrations/supabase/client.ts` (explicit localStorage + `db.schema: "cps"`), both `@supabase/supabase-js` v2, both pointing at the same project `tpfvnerrjhqwipyonngf`. Finance web/mobile repos live on the SE desktop machine (`C:\Users\SE\Desktop\Expense-Automation--main`) — same change applies there.

---

## 1. Why this works (the one-paragraph theory)

All apps already share **one Supabase project → one auth server → one user session**. The only reason a second login is demanded is that each origin keeps the session token in its own per-origin localStorage. Moving session storage to a **cookie scoped to `Domain=.hagerstone.com`** makes the token visible to every sibling subdomain. No auth-server change, no new infra, no token hand-off code. Supabase publishes an official helper for exactly this (`@supabase/ssr` — chunked cookie storage), so we are not inventing anything.

```
LOGIN at hub.hagerstone.com
  └── session written to cookie  sb-tpfvnerrjhqwipyonngf-auth-token  (Domain=.hagerstone.com)
        ├── cps.hagerstone.com      reads same cookie → logged in ✅
        ├── finance.hagerstone.com  reads same cookie → logged in ✅
        └── m.finance.hagerstone.com reads same cookie → logged in ✅
LOGOUT anywhere → cookie cleared → logged out everywhere (deliberate, correct behavior)
```

---

## 1.5 Verified on the LIVE Supabase project (25 Jul 2026, via MCP SQL)

| # | Check | Result | Meaning for SSO |
|---|---|---|---|
| 1 | One shared auth pool | 89 users in `auth.users`; 69 linked from `public.employees`, 70 from `finance.employees`, **66 are the same person in both** | ✅ One login already identifies the user to every module — only storage blocks it |
| 2 | CPS identity mapping | All 60 `cps.cps_users` rows have valid `auth_uid` → `auth.users`; 45 are also Hub users | ✅ Same JWT resolves CPS identity; the 15 CPS-only users simply keep logging in at CPS (unaffected) |
| 3 | RLS mechanics | CPS's dominant policy (143×) is `cps.is_cps_user()` → `SELECT … WHERE auth_uid = auth.uid()`; finance 13/15 policies use auth functions | ✅ Authorization is purely JWT-`auth.uid()`-driven — a token minted at hub.hagerstone.com authorizes identically at cps./finance. No policy changes needed |
| 4 | Session reality today | **874 active sessions for 60 users** (one user has 410!) — every app+device login mints a new session | ✅ Quantifies the double-login pain; SSO collapses this to ~1 session per user per device |
| 5 | Refresh-token rotation | **ON** (4,232 rotated tokens, 4,192 chained) | ⚠️ Confirms the §3 race mitigation is required, not theoretical. **Pre-launch dashboard check:** Auth → Sessions → "Refresh token reuse interval" must be ≥ 10 s (default). This is the one setting SQL can't read |
| 6 | Cross-schema quirk | `public.employees.auth_user_id` vs `finance.employees.auth_id` both join `auth.users.id` | ✅ Both resolve from the same `auth.uid()` — quirk irrelevant to SSO |

**Verdict: the backend is already SSO-ready.** Nothing on the Supabase side needs to change except confirming the reuse-interval setting in the dashboard. The entire fix is client-side storage.

---

## 2. The implementation (small, identical in every app)

### 2.1 One shared storage adapter file (~40 lines), added to each repo

Use `@supabase/ssr`'s cookie storage (battle-tested: handles the >4 KB session by **chunking** into `sb-…-auth-token.0`, `.1`, …). Add dependency `@supabase/ssr` and create `src/lib/cookieStorage.ts`:

```ts
// src/lib/cookieStorage.ts — IDENTICAL file in Hub, CPS, Finance web, Finance mobile
import { createBrowserClient } from "@supabase/ssr";

const onProductionDomain = location.hostname.endsWith(".hagerstone.com");

export function makeSuiteClient(url: string, anonKey: string, extra: object = {}) {
  if (!onProductionDomain) {
    // localhost / vercel.app previews: keep old behavior (per-origin localStorage).
    // Nothing breaks in dev; SSO simply doesn't apply there.
    const { createClient } = require("@supabase/supabase-js");
    return createClient(url, anonKey, extra);
  }
  return createBrowserClient(url, anonKey, {
    ...extra,
    cookieOptions: {
      domain: ".hagerstone.com",   // ← the whole trick
      path: "/",
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 30,   // 30 days, matches refresh-token life
    },
  });
}
```

*(Implementation detail for the coder: in Vite use a static `import` + conditional, not `require`; shown this way for brevity. `createBrowserClient` returns a standard SupabaseClient — all existing `.from()/.auth` code is untouched.)*

### 2.2 Per-app client change (one line each)

> ⚠️ **The Finance rows in this table are WRONG.** Corrected by the code audit in §7 (1 Aug 2026).
> Finance does not use client-side Supabase auth at all, so the one-line change does nothing there.
> Hub and CPS rows are confirmed accurate. **Read §7 before implementing.**

| App | File | Change |
|---|---|---|
| Hub | `src/lib/supabase.ts` | `export const supabase = makeSuiteClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` |
| CPS | `src/integrations/supabase/client.ts` | `makeSuiteClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "cps" } })` — schema option preserved |
| ~~Finance web~~ | ~~its client file~~ | ~~same~~ → **see §7.2** |
| ~~Finance mobile~~ | ~~its client file~~ | ~~same~~ → **see §7.2** |

**Critical invariant: every app MUST end up with the same storage key** (default `sb-tpfvnerrjhqwipyonngf-auth-token` — automatic since all use the same project URL; do not set a custom `storageKey` anywhere).

### 2.3 What does NOT change
- No Supabase dashboard/auth-server changes (redirect URLs were already updated in the domain plan).
- No RLS, schema, or edge-function changes. The JWT is identical — only its storage location moves.
- Login page/UI unchanged — Hub remains the place people log in; modules just stop asking.
- The two-employees-tables quirk (`public.employees.auth_user_id` vs `finance.employees.auth_id`) is unaffected — both resolve from the same `auth.uid()`.

---

## 3. The three failure modes — and their engineered answers ("make sure it works")

| Risk | What could happen | Engineered answer |
|---|---|---|
| **1. Refresh-token race** — Hub tab and CPS tab both try to refresh the token at the same moment; token rotation invalidates one | Random logouts | (a) Supabase's server-side **reuse interval (10 s default)** already tolerates concurrent refresh reuse — this is why the pattern works at all; (b) roll out with Hub as the only `autoRefreshToken: true` app first if flapping is ever observed (modules read the cookie, Hub maintains it). In practice with the 10 s window, all-apps-refresh works and is the default rollout. |
| **2. Cookie > 4 KB** — Supabase session JSON exceeds one cookie's limit | Truncated/broken session | `@supabase/ssr` chunking handles this automatically (`.0`, `.1` cookies). Do NOT hand-roll a cookie adapter — this is precisely the bug hand-rolled versions hit. |
| **3. Old localStorage sessions linger** after cutover | User appears logged-in on old origin, logged-out on new, confusion during transition week | Cutover snippet in each app: on first load, if a localStorage `sb-*-auth-token` exists and no cookie session does, `signOut({ scope: 'local' })` + clear the key, forcing one clean re-login into the cookie world. One-time, per user, per app. |

**Dev/preview safety:** the `onProductionDomain` guard means localhost and Vercel preview deploys behave exactly as today (per-origin localStorage) — SSO code cannot break local development.

---

## 4. Rollout order (do it in this order, ~1 day total after domains)

1. **Hub first** (it's the login home). Deploy → verify login works, cookie visible in DevTools → Application → Cookies → `.hagerstone.com`.
2. **CPS second** (it's the most-used module). Deploy → open `cps.hagerstone.com` in the same browser → must land authenticated with NO login screen.
3. **Finance web + mobile** (requires the SE-machine repos — coordinate or pull them onto this machine).
4. **Update the Hub launcher UX** (optional polish): remove any "you may need to log in again" copy.
5. Leave `hiring` / `marketing` apps out of scope v1 — add later with the same 2-line change if wanted.

### Test matrix (must ALL pass before calling it done)

| # | Test | Pass condition |
|---|---|---|
| 1 | Login at Hub → open CPS | No login screen, correct user, CPS data loads (schema header intact) |
| 2 | Login at Hub → open Finance web | Same |
| 3 | Refresh CPS tab after 1 h+ idle | Session silently refreshed, no logout |
| 4 | Hub + CPS open together for 2+ h | Neither tab drops session (race check) |
| 5 | Logout from Hub → switch to CPS tab, act | CPS unauthenticated (shared logout works) |
| 6 | Direct visit to cps.hagerstone.com in fresh browser (no session) | Redirects to its login (or Hub) — no crash |
| 7 | localhost dev of each app | Behaves exactly as before (guard works) |
| 8 | Mobile browser (Android Chrome — field staff) | Tests 1 & 3 pass on phone |
| 9 | Old vercel.app URL visited post-cutover | Redirects to new domain (from domain plan), then SSO applies |

---

## 5. Rollback

Per-app and instant: revert the one-line client change → app goes back to its own localStorage login. No data or backend involvement. Apps can run mixed (some on cookies, some on localStorage) indefinitely during rollout — the only cost is those apps still ask for login.

---

## 6. Effort & cost summary

| | |
|---|---|
| New infra / services | **None** |
| Cost | **₹0** (plus the already-planned $20/mo Vercel Pro at first paying client) |
| Code | 1 shared file (~40 lines) + 1-line client change × 4 apps + cutover snippet |
| Effort | ~1 day dev + the test matrix, after domain unification lands |
| Blast radius | Low; per-app rollback; dev environments untouched |
| Multi-tenant leverage | Stage-2 tenants get the same suite-SSO on *their* domain for free — the adapter reads the hostname, so `cps.clientA.com` shares cookies on `.clientA.com` automatically |

**Sequence reminder:** `DOMAIN_UNIFICATION_PLAN.md` → this plan → (later, Stage 2) per-tenant domains. Doing this out of order is the only way it can fail.

---

# §7. CODE AUDIT — all 4 repos read on disk (1 Aug 2026)

> **Status when this was written: no SSO code has been implemented in any repo.** The Friday 31 Jul build never happened. Everything below is a read-only audit of the *current* code, done so we can pick this up cold later. Effort revised from ~1 day to **~1.5–2 days**.

**Repo locations (the plan doc previously said these were on the SE machine — they are not, they are local):**

| Repo | Path |
|---|---|
| Hub | `D:\hs\Unified System\Unified System\hagerstone-hub` |
| CPS | `D:\hs\hagerstone-cps (2)\hagerstone-cps` |
| Finance (all 3 parts) | `D:\hs\Expense-Automation--main\Expense-Automation--main` — `backend/`, `web-dashboard/`, `mobile-app/` |

## 7.1 Hub + CPS — plan is correct, one-line change each ✅

| Check | Hub | CPS |
|---|---|---|
| File | `src/lib/supabase.ts` | `src/integrations/supabase/client.ts` |
| Client | plain `createClient`, default storage | `createClient` + explicit `storage: localStorage` |
| Project | `tpfvnerrjhqwipyonngf` | `tpfvnerrjhqwipyonngf` (hardcoded) |
| Extra config | none | `db: { schema: "cps" }` — **must be preserved** |
| Custom `storageKey` | none | none |
| Logs in client-side? | yes | **yes** — `src/contexts/AuthContext.tsx:114` `signInWithPassword()` |

Both derive the same key `sb-tpfvnerrjhqwipyonngf-auth-token`, so the §2 critical invariant already holds. Swap storage → cookie and it is genuine SSO. **CPS also works as a front door**: because it signs in client-side, logging in at `cps.hagerstone.com` writes the shared cookie and logs the user into Hub + Finance too. Good news for the 15 CPS-only users — their habit is unaffected.

## 7.2 Finance — different architecture, needs a bridge (NOT a one-liner) ⚠️

Finance **never calls `signInWithPassword` in the browser** (verified: zero hits across `web-dashboard/src` and `mobile-app/src`). Its real flow:

```
LoginPage → POST /api/auth/login  (Railway backend)
              └─ backend/src/routes/auth.js → supabaseAnon.auth.signInWithPassword()   ← SERVER-side
              └─ returns session.access_token
         → localStorage['hs_access_token']       ← its OWN key, not sb-…-auth-token
         → sent as `Authorization: Bearer` on every API call
```

The browser's Supabase client (`web-dashboard/src/supabaseClient.js`) holds **no session** — it is only used for `onAuthStateChange`, WebSocket, and `ResetPassword.jsx`. So a shared cookie written by Hub would be silently ignored.

**The saving grace — no backend work needed.** `backend/src/middleware/auth.js` verifies with `supabaseAdmin.auth.getUser(token)`, which accepts *any* valid Supabase JWT from this project. **A token minted at `hub.hagerstone.com` is already accepted by the Finance backend today.** No backend change, no CORS change, no new endpoint.

**What Finance actually needs (~20 lines per app):** in `AuthContext.jsx` + `services/api.js`, when there is no `hs_access_token`, take `access_token` from the shared cookie session and use it as the bearer. Prefer reading `supabase.auth.getSession()` at request time over copying into localStorage — `getSession()` auto-refreshes, a copied token goes stale after ~1 h.

**Known limitation if we ship only the bridge — Finance becomes a "leaf":**

| Direction | Result |
|---|---|
| Log in at Hub or CPS → open Finance | ✅ works |
| Log in at Finance **directly** → open Hub / CPS | ❌ still asks for login |

Because Finance's login happens server-side, nothing lands in the browser cookie. A Finance-first user sees no benefit at all.

**Optional fix (+½ day, deferred by decision on 1 Aug):** make the Finance login page call `supabase.auth.signInWithPassword()` client-side and keep `/api/auth/me` for the employee-profile / role / suspended-account checks. Makes Finance a full front door like CPS, **and** stops Finance minting a brand-new server-side session on every login — a large share of the *874 sessions for 60 users* measured in §1.5.

## 7.3 Finance mobile — SSO DOES work for site engineers ✅

`mobile-app/` is Expo/React Native but ships to Vercel as a **web build** — `vercel.json` present, `app.json` has `"web": { "bundler": "metro", "output": "single" }`, served at `m.finance.hagerstone.com`, and the Hub tile ([`src/config/modules.ts:17`](src/config/modules.ts#L17)) points at that URL.

`mobile-app/src/supabaseClient.js` branches on `Platform.OS === 'web'` → **localStorage** (the `expo-secure-store` branch never runs on web). That is exactly the branch we swap for cookies. So the site engineer's journey works:

```
phone browser → hub.hagerstone.com → log in ONCE
  └── tap "Finance — Employee" tile → m.finance.hagerstone.com → reads cookie → already in ✅
```

**Only exception:** the repo *can* build a native app (`eas.json`, `com.hagerstone.expenses`). An **installed APK / App Store build** has no browser and no cookies — it would keep its own login, unfixable without a deep-link token handoff. ❓ **Open question: has anyone been given an installed APK, or does everyone use the Hub link?** Believed to be the link only.

## 7.4 Revised scope

| Module | SSO? | Work |
|---|---|---|
| Hub | ✅ | adapter file + 1 line |
| CPS | ✅ | 1 line (preserve `db.schema`) |
| Finance web | ✅ (leaf) | ~20 lines bridge |
| Finance mobile — web at `m.finance…` | ✅ (leaf) | ~20 lines bridge |
| Finance mobile — installed native build | ❌ | out of scope |

Still ₹0, still no DB / RLS / edge-function changes, still per-app rollback.

## 7.5 What users will experience

- **Everyone logs in exactly once more — not once per app.** The token moves localStorage → cookie, and `*.vercel.app` → `hagerstone.com` is a different site to the browser regardless. Since almost nobody has logged into `hub.hagerstone.com` yet, SSO does not *add* a login — it removes the other three. This is precisely why **SSO must ship before the Vercel redirects**; redirects first = up to 4 separate logins.
- **The real friction is saved passwords**, not the login. Chrome will not autofill a password saved for `hagerstone-hub.vercel.app` onto `hub.hagerstone.com`. This is most of the support load on switchover day — see the Thursday WhatsApp message in the runbook.
- **Users who arrive somewhere new.** 89 auth users; 69 in `public.employees`, 70 in `finance.employees`, 66 in both. Post-SSO a user can now *reach* a module they have no profile in — they land authenticated but unauthorised. Hub degrades gracefully ([`src/components/ProtectedRoute.tsx:58`](src/components/ProtectedRoute.tsx#L58) → "contact admin"); Finance returns a clean 401 "Employee profile not found". **Both need an explicit test, not an assumption.**

---

# §8. RISK REVIEW OF THE HALF-DONE STATE (as of 1 Aug 2026)

The domain work landed 27–28 Jul but SSO did not. **Three of those changes are already degrading the experience for users still on the old `*.vercel.app` URLs.** None is an outage; all are self-inflicted friction that disappears the moment SSO ships.

| # | What's live | Effect today | Severity |
|---|---|---|---|
| 1 | **Hub launcher tiles → `hagerstone.com`** (`src/config/modules.ts`, commit `d5047a0`) | A user logged into Hub on the **old** vercel.app URL clicks the CPS / Finance tile → lands on the new domain → different origin → **no session → login screen**. Before the tile change, the tile went to the old URL where they already had a session. **This is a live regression, happening now.** | 🟠 Medium — the most likely thing to generate "why is it asking me to log in again?" |
| 2 | **Supabase Site URL → `hub.hagerstone.com`** | Site URL is the fallback redirect for recovery / invite emails that don't pass an explicit `redirectTo`. Those links now land on the Hub — **which has no password-reset page** ([`LoginPage.tsx:197`](src/pages/LoginPage.tsx#L197) still says "Contact IT"). CPS is safe (passes `window.location.origin`, `src/pages/Login.tsx:54`); Finance's `ResetPassword.jsx` has no `resetPasswordForEmail` call, so any reset mail it relies on is Supabase-generated → uses Site URL → **dead-ends on the Hub**. | 🟠 Medium — only bites people doing a password reset, but it fails silently |
| 3 | **Edge-function WhatsApp links → `HUB_PUBLIC_URL`** (new domain) | Notification links now open `hub.hagerstone.com`, where the user has no session → extra login prompt from a WhatsApp tap. | 🟡 Low — one extra login, no breakage |
| 4 | Subdomains live + SSL | Purely additive; old URLs untouched. | 🟢 None |
| 5 | Railway CORS: new domains whitelisted | Additive — old origins still allowed. | 🟢 None |

**Is it safe to leave it here?** Yes — nothing is broken or data-affecting, and every item is reversible. But #1 and #2 mean the current state is *worse than either endpoint*: the team gets the domain move's friction without SSO's payoff. The longer it sits, the more "it keeps asking me to log in" reports arrive.

**If it will sit for a while, these two are the cheap mitigations:**
- Revert `src/config/modules.ts` to the `*.vercel.app` tile URLs until SSO ships (kills risk #1 outright, one commit, instantly re-revertible).
- Either point Supabase Site URL back at the old Hub URL, or accept that password resets go through an admin (Admin → Employees → **Resend onboarding**) until the Hub has its own reset page.

**Do NOT flip the Vercel redirects** until SSO is live — that converts all three risks above from "some users" to "everyone", and forces the multi-login experience the whole plan exists to prevent.

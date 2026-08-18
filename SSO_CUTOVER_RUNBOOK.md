# SSO Cutover Runbook — Friday 31 Jul & Saturday 1 Aug 2026

**Goal:** everyone logs in once at `hub.hagerstone.com` and every module opens without another login.

**Written:** Tue 28 Jul 2026. Read this Friday morning.

> ## ⛔ STATUS UPDATE — 1 Aug 2026: THIS CUTOVER DID NOT HAPPEN
>
> The Friday 31 Jul build was never done. **No SSO code exists in any of the 4 repos** (verified by reading all of them on 1 Aug). The Saturday 1 Aug steps below **must not be run** — flipping the redirects without SSO forces users to log in separately on every module, the exact thing this plan exists to prevent.
>
> - Full code audit of all 4 repos → **§7 of `SSO_SINGLE_LOGIN_PLAN.md`**
> - Risk review of the current half-done state → **§8 of the same doc** (2 live regressions worth knowing about)
> - **Scope changed:** Finance needs ~20 lines, not a one-liner — its login runs server-side via the Railway backend. See §7.2.
> - **Forgot-password page: dropped from scope** by decision on 1 Aug. Ignore step 4 of "Claude does" and test 8 below.
> - Revised effort: **~1.5–2 days**, not 1.
>
> Everything else below is still the correct plan — only the dates are stale.

---

## Where we already are (done 27–28 Jul, all verified live)

| Item | State |
|---|---|
| `hub.hagerstone.com` | ✅ live, SSL |
| `cps.hagerstone.com` | ✅ live, SSL |
| `finance.hagerstone.com` | ✅ live, SSL |
| `m.finance.hagerstone.com` | ✅ live, SSL |
| Railway finance backend CORS | ✅ new domains whitelisted, verified |
| Supabase redirect URLs + Site URL | ✅ new domains added, Site URL → hub.hagerstone.com |
| Hub launcher tiles (CPS, Finance ×2) | ✅ point at new domains |
| All 6 edge functions' WhatsApp links | ✅ via `HUB_PUBLIC_URL` secret → new domain |

Old `*.vercel.app` URLs still work. Team is still using them. Nothing has changed for users yet.

**Not yet done:** SSO itself, forgot-password flow, Vercel redirects, 3 minor domains (hiring / lcs / marketing).

---

## THURSDAY 30 JUL — one thing, don't skip

Send the team this message (WhatsApp). It must go out **before** Saturday so people have time.

> Team — this Saturday we're moving to our own web address: **hub.hagerstone.com** (instead of the old vercel.app link). You'll log in once and then everything opens without logging in again.
>
> **Please do this today:** your browser may have your password saved. Look it up and note it down —
> Chrome → ⋮ menu → Passwords → search "hagerstone" → click the 👁 eye icon.
>
> If you can't find it, no problem — message [name] on Saturday and we'll send you a new one.

Why: saved passwords do **not** carry from `hagerstone-hub.vercel.app` to `hub.hagerstone.com` — different sites to the browser. This message prevents most of the support load.

---

## FRIDAY 31 JUL — build + test (users see nothing)

All work happens on the new domains. The team stays on old URLs the whole day. If anything breaks, no one is affected.

### Claude does
1. Add cookie-based session storage (`@supabase/ssr`, cookie scoped to `.hagerstone.com`) to **Hub**
2. Same to **CPS**
3. Same to **Finance web** and **Finance mobile**
4. Build **self-service forgot-password** on Hub (email → reset link → set-new-password page)
   - The Hub currently has none — LoginPage just says "Contact IT". This closes that permanently.

### You test (~30 min)

| # | Test | Pass = |
|---|---|---|
| 1 | Log in at `hub.hagerstone.com` | Normal login works |
| 2 | Click Procurement (CPS) tile | Opens, **no login prompt** |
| 3 | Click Finance — Admin tile | Opens, no login prompt |
| 4 | Click Finance — Employee tile | Opens, no login prompt |
| 5 | Type `cps.hagerstone.com` directly in address bar | Still logged in |
| 6 | Log out from any one app | Logged out everywhere |
| 7 | Repeat 1–4 on your phone browser | Same behaviour |
| 8 | Forgot-password flow end to end | Reset link arrives, new password works |

**If any test fails:** stop, tell Claude, do not proceed to Saturday. The team is unaffected — they're still on old URLs.

**Do NOT flip the Vercel redirects on Friday.** That's Saturday's job.

---

## SATURDAY 1 AUG — switchover (~1 hour, plus buffer)

### Step 1 — Flip the redirects (you, 10 min)
For each of the 4 Vercel projects: Settings → Domains → **Edit** the `*.vercel.app` entry → set it to **Redirect to** the matching `hagerstone.com` domain (307).

| Project | Old URL redirects to |
|---|---|
| hagerstone-hub | hub.hagerstone.com |
| hagerstone-cps | cps.hagerstone.com |
| expense-automation | finance.hagerstone.com |
| expense-automation-mobile | m.finance.hagerstone.com |

### Step 2 — Smoke test (you + Claude, 10 min)
- Open an **old** WhatsApp link → should land on the new domain, same page
- Log in once → open all modules → no further logins
- Claude verifies the Finance password-reset link survives the redirect (reset tokens ride in the URL fragment — needs a real test, not an assumption)

### Step 3 — Announce (you)
> Done — we're live on **hub.hagerstone.com**. Old links still work and will bring you here automatically.
> You'll be asked to log in **once** today. After that, click any module from the Hub and it opens straight away — no more logging in separately.
> Forgot your password? Use "Forgot password" on the login page, or message [name].

### Step 4 — Stay available (rest of day)
For anyone stuck: Admin → Employees → **Resend onboarding** → they get a fresh temp password on WhatsApp with the new URL.
If many people are stuck, Claude can script this across all active employees at once.

---

## Rollback — every step is reversible

| If this breaks | Undo |
|---|---|
| SSO misbehaves in one app | Revert that app's deploy — others unaffected |
| Redirect causes trouble | Remove the redirect in Vercel → old URLs serve normally again |
| WhatsApp links wrong | Delete the `HUB_PUBLIC_URL` secret → all 6 functions fall back to old URL, no redeploy |
| Total abort | Revert redirects; team continues on vercel.app exactly as before |

Nothing in this plan is one-way.

---

## After the cutover (no rush)

1. Add the 3 remaining domains: `hiring`, `lcs`, `marketing` (~15 min, same loop as before:
   Vercel project → Domains → Add Existing → copy CNAME + TXT → GoDaddy → Add records → Refresh)
2. Update n8n message templates to *display* the new URLs (cosmetic — the redirect already makes them work)
3. Extend SSO to hiring / LCS / marketing if they share the Hub's Supabase auth
4. Mention to Dhruv: auto-renew is OFF on hagerstone.com (paid to Dec 2034, so no urgency)

---

## Key facts worth remembering

- **Why the domain move was required first:** browsers block shared cookies on `vercel.app` (it's on the Public Suffix List), so SSO was impossible until the apps sat under one domain we own.
- **Why one final login is unavoidable:** sessions move from per-site browser storage into a cookie on `.hagerstone.com`. Old sessions don't transfer. One login, then never again.
- **Why SSO before redirects:** if redirects came first, users would log in separately on each new domain (up to 3 times). SSO first = one login total.
- **Cost of everything above:** ₹0. Custom domains and SSL are free on Vercel's Hobby plan; DNS records are free at GoDaddy.

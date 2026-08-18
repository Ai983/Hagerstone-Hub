# Location Tracking + Geofenced Attendance — Hub Implementation Plan

**Source spec:** [LOCATION-TRACKING-SYSTEM.md](LOCATION-TRACKING-SYSTEM.md) (the SEPL system: SQLite + Express + React JS).
**Target:** Hagerstone Hub SPA (React 19 + Vite + TS strict, Supabase `public` schema, Edge Functions, RLS).
**Goal:** Port the whole system natively into the Hub and make the Hub the single source of attendance truth.

---

## 0. Decisions locked

| Decision | Choice |
|---|---|
| **Scope** | **Full native attendance + location.** Hub owns punch-in/out **and** GPS pings + geofence enforcement, replacing the external `attend.html` app. |
| **First rollout** | **Site staff + field roles only** (`site_engineer`, `project_manager`, and similar). Office/admin/founder opted out by default via a `track_location` kill-switch. |
| **Geofence authority** | **Edge Function** (server-authoritative), matching SEPL's model and the Hub's existing `del-*` / `gie-*` function pattern. The client can never forge the inside/outside decision. |

---

## 1. Architecture translation (SEPL → Hub)

The SEPL system assumes a stateful Express server + SQLite on one box. The Hub has **no server** — it's a static SPA talking straight to Supabase, with privileged logic in Deno Edge Functions. Every SEPL layer maps to a Hub equivalent:

| SEPL layer | SEPL file | Hub equivalent |
|---|---|---|
| Geofence math + decision (shared) | `server/lib/geofence.js` | `supabase/functions/_shared/geofence.ts` (server truth) **+** `src/lib/geofence.ts` (display-only mirror for the status pill) |
| Punch + ping ingestion | `server/routes/attendance.js` (Express) | Edge Functions `attendance-punch` + `location-ping` (service-role writes) |
| Admin live/timeline reads | `server/routes/locations.js` (Express) | Postgres **views** `location_live` / `location_latest` + **RPC** `location_timeline()` (RLS/admin-gated), read directly via `supabase.rpc()` / `.from(view)` |
| DB tables (SQLite) | `server/db/schema.js` | Postgres migrations in `public` schema |
| Employee punch UI | `client/src/pages/Attendance.jsx` | `src/pages/AttendancePage.tsx` (new route `/attendance`) |
| Admin tracking page | `client/src/pages/admin/Locations.jsx` | `src/pages/admin/LocationsPage.tsx` (new route `/admin/locations`) |
| Team map / Route map (Leaflet) | `TeamMap.jsx` / `RouteMap.jsx` | `src/components/location/TeamMap.tsx` / `RouteMap.tsx` (add `leaflet` + `react-leaflet`) |
| 60-day auto-purge | SQLite trigger | `pg_cron` job (or n8n daily cron → RPC) |
| `track_location` opt-out | `users` column | `public.employees.track_location` column |

**Why the split (views/RPC for reads, Edge Functions for writes):** reads are safe to serve directly from Postgres because RLS + admin-gating protect them and there's no secret decision to hide. Writes (punch, ping) run the geofence decision that decides "inside/outside" — that must be server-authoritative, so it goes through an Edge Function with the service-role key. This mirrors how `del-submit-task` etc. already work.

---

## 2. Data model — `public` schema

One migration adds three tables + one column. All lowercase, all in `public` (Hub identity schema), all keyed to `auth.users(id)` so they line up with `public.employees.auth_user_id`.

### 2a. `public.geofence_settings` — the defined sites
```
id uuid pk default gen_random_uuid()
site_id text            -- optional external/site code
site_name text not null
latitude double precision not null
longitude double precision not null
radius_meters int not null default 200
active boolean not null default true
project_id uuid null references public.projects(id)  -- NEW: tie a site to a Hub project
created_at timestamptz default now()
```
> **Hub upgrade over SEPL:** link each geofence to `public.projects` so the map/timeline can label sites with the real project name and admin CRUD reuses the existing project picker (`fetchActiveProjects`).

### 2b. `public.location_tracking` — every GPS ping
```
id uuid pk
user_id uuid not null references auth.users(id)
date date not null
captured_at timestamptz not null default now()   -- replaces SEPL's separate date/time strings
latitude double precision null
longitude double precision null
accuracy double precision null
address text null
site_name text null            -- matched site, 'Outside', or 'GPS_OFF'
```
Indexes: `(user_id, date)`, `(user_id, captured_at desc)`. **60-day purge** via cron (§8).

### 2c. `public.attendance` — the punch record
```
id uuid pk
user_id uuid not null references auth.users(id)
date date not null
punch_in_at timestamptz, punch_in_lat, punch_in_lng, punch_in_accuracy,
punch_in_address text, punch_in_photo text,     -- storage path
punch_out_at timestamptz, punch_out_lat, punch_out_lng, punch_out_accuracy,
punch_out_address text, punch_out_photo text,
site_id text, site_name text,
status text,                    -- 'present' | 'late' | 'half_day'
total_hours numeric,
location_verified boolean not null default true,
unique (user_id, date)
```

### 2d. `public.employees.track_location boolean not null default false`
Per-employee kill-switch. **Seed `true` only for field roles** (`site_engineer`, `project_manager` + any others confirmed) → matches the "site staff first" rollout. Everyone else defaults `false`. Every admin read filters `COALESCE(track_location,false)=true`.

### 2e. Config: `public.location_settings` (key/value, mirrors `points_config`)
Tunable geofence thresholds so admin edits take effect with no redeploy (Edge Function reads them, falls back to defaults):
`accuracy_floor_m=50`, `accuracy_ceiling_m=3000`, `trust_accuracy_m=200`, `block_buffer_m=300`, `suspicious_kmh=120`, `ping_interval_s=30`, `purge_days=60`, `stale_minutes=30`, `fresh_max_min=15`.

---

## 3. Shared geofence logic — `_shared/geofence.ts`

Direct port of `server/lib/geofence.js` (it's pure math, no SQLite deps):
- `haversine(lat1,lon1,lat2,lon2)` → metres
- `evaluateGeofence(lat, lng, accuracy, geofences, settings)` → `{allow, verified, decision, matchedSite, nearestSite, nearestDist, accuracyUsed}`

The **"uncertainty-honest" rule is preserved exactly**: clamp accuracy to [floor, ceiling]; match when `distance − acc ≤ radius`; a weak fix (`accuracy > trust`) **can never block**; only a precise lock confidently beyond `radius + block_buffer` returns `allow:false`. Thresholds come from `location_settings`.

A **thin client mirror** `src/lib/geofence.ts` re-implements the same rule for the live status pill (green/amber/red) — display only, never trusted for the actual write.

---

## 4. Edge Functions (server authority)

Follow the existing pattern (`serve` + `createClient(service_role)` + CORS + `json()` helper). Each verifies the caller's JWT → resolves `auth.uid()` → runs shared geofence → writes with service-role.

### 4a. `attendance-punch`  (POST `{action:'in'|'out', latitude, longitude, accuracy, address, photo_path}`)
1. Resolve caller `user_id` from JWT.
2. Reject if `track_location=false` **or** no active geofences ("No site locations configured").
3. **Require selfie** (`photo_path`) — the real proof of presence (SEPL keeps auto-punch disabled deliberately; we keep it disabled too).
4. `in`: reject double-punch-in; run `evaluateGeofence`; if `!allow` → 400 with the real "~Nm from <site>" message; else INSERT with `location_verified=geo.verified`, IST-aware late check.
5. `out`: require prior in; run the **same** geofence; compute `total_hours`, set `half_day` if < 4h; UPDATE.

### 4b. `location-ping`  (POST `{latitude, longitude, accuracy, address, gps_off?}`)
The 30-second heartbeat. `gps_off:true` → INSERT NULL coords + `site_name='GPS_OFF'`. Else run geofence; `site_name` = matched site only when `decision==='inside'`, else `'Outside'`. INSERT into `location_tracking`.

### 4c. Reads stay in SQL (no function needed)
- **`location_live`** view — latest ping per user within `stale_minutes`, ordered GPS_OFF → in-site → Outside, with `minutes_ago`. Admin-gated by RLS.
- **`location_latest`** view — latest ping per user within `horizon_days`, each tagged `live`; plus active geofences for overlay.
- **`location_timeline(p_user_id, p_date)`** RPC (plpgsql, SECURITY DEFINER, admin-checked) — loads pings ordered by time, runs the **>120 km/h teleport/spoof detector** (excludes bogus pings from distance, doesn't advance the "last trusted" pointer), tags each ping before/during/after punch, returns `pings[]`, `total_distance_m`, `attendance`, `suspicious_count`.

---

## 5. Frontend — employee attendance UI  (`src/pages/AttendancePage.tsx`, route `/attendance`)

Port of `Attendance.jsx`, TypeScript + TanStack Query + Hub UI kit (shadcn/Button/Input, framer-motion, sonner):
- **`getBestPosition()`** — `watchPosition({enableHighAccuracy})`, keep most-accurate fix, resolve early at ≤40 m or after 15 s, always clean up.
- **Background tracking `useEffect`** — every 30 s: refetch today's status (works even with GPS dead), then POST to `location-ping` (or `gps_off` on error/denied). Stops once punched out. Re-fetch on window focus.
- **Live status pill** — mirrors the server rule via `src/lib/geofence.ts` (green `inside` / amber `weak` / red `outside` / `locating` / `no_sites`).
- **Punch In/Out** — require selfie (camera capture) → upload to storage (§6) → `getBestPosition()` → invoke `attendance-punch`. Toast the server message.
- Gated by `ProtectedRoute`; the page itself checks `employee.track_location` and shows a friendly "tracking not enabled for your role" state otherwise.

---

## 6. Frontend — admin module  (`src/pages/admin/LocationsPage.tsx`, route `/admin/locations`, `AdminRoute`)

Three tabs, port of `Locations.jsx`:
- **Live** — cards of who's where now (`location_live`), Google Maps links, GPS-off in red.
- **Team Map** — `src/components/location/TeamMap.tsx` (Leaflet): one marker/person (green=live, grey=last-seen, red=GPS off) + geofence circles, from `location_latest`.
- **Timeline** — user + date picker → `src/components/location/RouteMap.tsx` draws the day as a polyline with start/end markers + geofence circles, plus a movement table flagging >120 km/h spoof pings, from `location_timeline()`.

Plus a **Geofence sites CRUD** panel (add/edit/deactivate sites, reusing the `SearchableSelect` project picker) — admin/permission-gated writes to `geofence_settings`.

---

## 7. Storage — selfies

New **private** bucket `attendance-photos` (10 MB limit). Employee uploads to `attendance-photos/{user_id}/{date}/{in|out}.jpg` via signed policy; admin views via `createSignedUrl()`. Add the bucket to the §D7 bucket table in the migration status doc once created.

---

## 8. Cross-cutting

- **RLS:** `location_tracking` / `attendance` — a user can INSERT/SELECT **only their own rows**; admins/`AdminRoute`-equivalent roles SELECT all. Writes actually happen via Edge Function (service-role bypasses RLS), so client-facing RLS is read-shaped. `geofence_settings` readable by any authenticated user (the punch screen needs the site list — SEPL learned this the hard way), writable by admins only.
- **60-day purge:** `pg_cron` daily `DELETE FROM location_tracking WHERE date < now()-interval '60 days'` (or an n8n daily cron hitting a `purge_location` RPC — the Hub already runs n8n on Railway).
- **Config-driven thresholds:** all magic numbers live in `location_settings`; functions read + fall back to defaults (exactly how `del-submit-task` reads `points_config`).
- **Rollout (site staff first):** seed `track_location=true` for field roles only; add a `track_location` toggle to `AddEmployeePage` / `EditEmployeePage` so admins widen the net per-person. Widen roles later by flipping seeds.

---

## 9. Making it a Hub module

`attendance` is currently an **external tile** in [src/config/modules.ts](src/config/modules.ts) pointing at `hr-hiring-automation.vercel.app/attend.html`. To make it native:
- Change the `attendance` module to open the **internal** `/attendance` route instead of an external URL (needs a small tweak to how `DashboardPage` renders internal vs external tiles — most tiles are `window.open` external; add an internal-route branch).
- Add an **admin nav entry** to `/admin/locations` (alongside `/admin/employees`, `/admin/projects`).
- Decommission `attend.html` + its Google-Sheets/n8n attendance path **only after** the native flow is validated in the pilot (keep the old one as fallback during rollout — same posture as the migration's dual-track rollback rule).

---

## 10. Dependencies to add
`leaflet`, `react-leaflet`, `@types/leaflet`. (Everything else — `@supabase/supabase-js`, `framer-motion`, `date-fns`, `zod`, TanStack Query — is already present.)

---

## 11. Phased delivery

| Phase | Deliverable | Verify |
|---|---|---|
| **P0 — Schema** | Migration: 3 tables + `track_location` column + `location_settings` seed + indexes + RLS + views + `location_timeline` RPC + purge cron | `list_tables`; insert a fake ping; call the RPC |
| **P1 — Server logic** | `_shared/geofence.ts` port + `attendance-punch` + `location-ping` Edge Functions deployed | Invoke with a known on-site coord → INSERT + correct `verified`; a far precise coord → 400 |
| **P2 — Employee UI** | `AttendancePage.tsx` + `src/lib/geofence.ts` mirror + `attendance-photos` bucket + `/attendance` route | Punch in/out on a phone at a seeded site; pings appear every 30 s |
| **P3 — Admin UI** | `LocationsPage.tsx` + `TeamMap` + `RouteMap` + geofence CRUD + `/admin/locations` route + admin nav | Live/Team-map/Timeline render; teleport ping flagged |
| **P4 — Rollout** | Seed field-role `track_location`; pilot with 2–3 site engineers; repoint the `attendance` module tile to internal | Pilot punches land, map is honest; then widen |
| **P5 — Decommission** | Retire `attend.html` + old Sheets/n8n attendance after sign-off | Old path off; Hub is sole attendance source |

---

## 12. Open questions / risks
1. **Which exact roles are "field"?** Locked list needed before seeding `track_location` (confirmed: `site_engineer`, `project_manager` — add others?).
2. **Attendance history migration** — is there existing attendance data (Google Sheets) to backfill into `public.attendance`, or does the Hub start fresh?
3. **HTTPS + permissions** — geolocation + camera require HTTPS (Vercel ✓) and per-device permission grants; plan a one-time "allow location/camera" onboarding note for site staff.
4. **DPDP / privacy** — continuous GPS tracking of staff is a compliance-sensitive feature (the status doc already flags a pending DPDP review). Recommend a written consent + opt-out policy before widening beyond the pilot.
5. **Late-check IST logic** — SEPL reads `payroll_settings.late_after_time`; the Hub has no payroll table yet. Decide: add a `late_after_time` to `location_settings`, or skip late-classification in v1.
6. **Battery/data cost** of a 30 s `watchPosition` on field phones — consider making the interval config-driven (already in `location_settings`) and pausing when backgrounded.
```

# Employee Location Tracking & Geofenced Attendance — Complete System Flow

This document explains **everything** that happens in the SEPL location-tracking
system: every file, every function, every request, and the exact order in which
they run — from the employee's phone acquiring a GPS fix, to the punch being
geofence-checked and stored, to the admin watching the team on a live map.

---

## 1. The big picture (one paragraph)

The employee's browser (Attendance page) continuously acquires GPS fixes and does
two things with them: (a) **every 30 seconds** it POSTs a "ping" to
`/attendance/track-location`, which stores a row in `location_tracking`; (b) when
the employee taps **Punch In / Out**, it takes a selfie + the best GPS fix and
POSTs to `/attendance/punch-in` or `/punch-out`. Both punch endpoints run the
**shared geofence decision** in `server/lib/geofence.js` to decide inside/outside.
The admin side (`/api/admin/locations/*`) never writes — it only *reads*
`location_tracking` to render a **Live list**, a **Team map**, and a per-employee
**Timeline** with a GPS-spoof / teleport detector.

```
 ┌────────────────────────── EMPLOYEE PHONE (browser) ──────────────────────────┐
 │  client/src/pages/Attendance.jsx                                              │
 │                                                                               │
 │   getBestPosition()  ──► watchPosition(), keeps most-accurate fix             │
 │        │                                                                      │
 │        ├── every 30s ── POST /attendance/track-location  (ping)               │
 │        │                                                                      │
 │        └── on tap ───── POST /attendance/punch-in | punch-out (selfie+GPS)    │
 └───────────────────────────────────┬───────────────────────────────────────────┘
                                      │  HTTP (axios, JWT in header)
 ┌────────────────────────────────────▼──────────────────────────────────────────┐
 │  SERVER (Express)                                                              │
 │                                                                               │
 │  server/routes/attendance.js                                                  │
 │     POST /punch-in ─┐                                                          │
 │     POST /punch-out ─┼─► evaluateGeofence()  ◄── server/lib/geofence.js        │
 │     POST /track-location ─┘        (shared inside/outside decision)            │
 │            │                                                                   │
 │            ▼ writes                                                            │
 │     ┌──────────────┬────────────────────┬─────────────────┐                   │
 │     │ attendance   │ location_tracking   │ geofence_settings│  (SQLite)        │
 │     └──────────────┴────────────────────┴─────────────────┘                   │
 │                         ▲ reads only                                           │
 │  server/routes/locations.js  (admin)                                          │
 │     GET /live · /latest · /timeline · /users                                  │
 └────────────────────────────────────┬──────────────────────────────────────────┘
                                      │
 ┌────────────────────────────────────▼──────────────────────────────────────────┐
 │  ADMIN BROWSER                                                                 │
 │  client/src/pages/admin/Locations.jsx  →  TeamMap.jsx · RouteMap.jsx (Leaflet) │
 └───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The data model (SQLite — `server/db/schema.js`)

Three tables + one flag column drive everything.

### `geofence_settings` — the defined sites (schema.js:1518–1527)
| column | meaning |
|---|---|
| `id` | PK |
| `site_id`, `site_name` | site identity |
| `latitude`, `longitude` | site centre |
| `radius_meters` | site radius, **default 200** |
| `active` | 1 = enforced |

This is the "where are our offices/sites" table. Punch-in refuses to work if there
are **zero** active rows ("No site locations configured").

### `location_tracking` — every GPS ping (schema.js:1541–1550)
| column | meaning |
|---|---|
| `user_id`, `date`, `time` | who / when (ISO) |
| `latitude`, `longitude` | ping position (NULL when GPS off) |
| `address` | optional reverse-geocode / reason text |
| `site_name` | matched site, `'Outside'`, or `'GPS_OFF'` |

Indexed at schema.js:5032–5033. **Auto-purged after 60 days** (schema.js:4357) so
the table never grows unbounded.

### `attendance` — the punch record (schema.js:1495–1515 + migration columns)
Location-relevant columns: `punch_in_lat/lng`, `punch_in_address`,
`punch_in_photo`, `punch_out_lat/lng`, `punch_out_address`, `punch_out_photo`,
`site_id`, `site_name`, and the migration-added `punch_in_accuracy` /
`punch_out_accuracy` (schema.js:2891–2892), `location_verified` default 1
(schema.js:2893), `auto_punched_in/out` (2839–2840, currently unused).

### `users.track_location` — the opt-out flag (schema.js:2879, default 1)
Per-employee kill switch. Admins + a named exclude-list are set to 0
(schema.js:5759–5769). Every admin read query uses `COALESCE(u.track_location,1)=1`
so opted-out users vanish from all tracking views.

---

## 3. The heart: the geofence decision — `server/lib/geofence.js`

This one file is the **single source of truth** shared by punch-in, punch-out AND
the live ping, so all three agree. It exists to fix a real complaint: staff
physically *at* the office being falsely blocked because indoor phone GPS is weak.

### `haversine(lat1, lon1, lat2, lon2)` → metres (line 24)
Great-circle distance between two GPS points.

### `geoSettings(db)` → tunable thresholds (line 42)
Reads `geo_accuracy_floor_m` / `geo_accuracy_ceiling_m` / `geo_trust_accuracy_m`
from `payroll_settings`. Falls back to defaults if columns absent:
- **floor = 50m** — every fix gets at least 50m of slack (ignore jitter)
- **ceiling = 3000m** — never grant more than 3km benefit of the doubt
- **trust = 200m** — a fix this precise is a *real* GPS lock we're willing to block on

### `evaluateGeofence(lat, lng, accuracy, geofences, settings)` → decision (line 71)
The "uncertainty-honest" rule. Step by step:

1. **Clamp accuracy**: `acc = min(max(accuracy, floor), ceiling)` — a coarse fix
   earns proportionally more slack, a jittery fix a floor of 50m.
2. **Find nearest & matched site**: loop all geofences, compute haversine distance.
   A site is **matched** when `distance − acc ≤ radius` (the uncertainty circle
   overlaps the site).
3. **`goodFix`** = the raw accuracy was `≤ trust` (200m) — a lock precise enough to trust.
4. **Decide**:
   - **matched** → `allow:true, decision:'inside'`. `verified = 1` only if it was
     a good fix; a coarse fix that merely overlapped is `verified:0` (allowed but
     flagged for admin review).
   - **not matched + weak fix** (`!goodFix`) → `allow:true, decision:'coarse_allow',
     verified:0`. **We can never prove someone indoors is away, so we never block them.**
   - **not matched + good fix** → the only path that *can* block. Even here, if
     they're within `radius + blockBuffer(300m)` of the nearest edge, it's still
     allowed as `coarse_allow` (GPS/coords are approximate). Only a precise lock
     that is **confidently far** returns `allow:false, decision:'outside'`.

Return shape: `{allow, verified, decision, matchedSite, nearestSite, nearestDist, accuracyUsed}`.

**Plain-English summary of the rule:** *A weak GPS fix can never block an on-site
person. You are only ever rejected when your phone has a precise lock that places
you clearly far from every site. The selfie is the real proof of presence.*

---

## 4. Employee flow — `client/src/pages/Attendance.jsx`

### 4a. Continuous background tracking (lines 132–164)
A `useEffect` runs while the day is open (stops once `punch_out_time` exists):

1. `trackLocation()` fires immediately, then on a **30-second `setInterval`**.
2. Each tick **first** re-fetches `/attendance/my-today` (independent of GPS) so a
   punch made on another device — e.g. the laptop — shows up on the phone even if
   the phone's GPS is dead.
3. Then it tries GPS:
   - **No geolocation API** → POST `{gps_off:true, reason:'no-geolocation-api'}`.
   - **Success** → POST `{latitude, longitude, accuracy, address:''}`.
   - **Error** (denied / unavailable / timeout) → POST `{gps_off:true, reason:…}`
     so admin sees "online but GPS off" (red) instead of assuming absent.
4. Cleanup clears the interval on unmount.

A second `useEffect` (lines 169–174) also re-fetches today's status on window
**focus** / visibility change.

### 4b. Live status pill (lines 176–208 — `geoStatus`)
Purely for display, this **mirrors the server rule exactly** (same floor 50 /
ceiling 3000 / trust 200) so what the pill says is what the punch will do. Three
states: `inside` (green), `weak` (amber — can still punch, gets flagged),
`outside` (red — will be blocked). Plus `locating` / `no_sites`.

### 4c. Acquiring the best GPS fix (lines 216–248 — `getBestPosition`)
Phones return a coarse network fix first (±500–2000m) then refine to a real lock
(±5–20m) seconds later. Taking the *first* fix is exactly why on-site staff saw
"outside". So instead of `getCurrentPosition` once, this:
- Opens `watchPosition` with `enableHighAccuracy`.
- Keeps the **most accurate** reading seen so far (`best`).
- Live-updates the status pill as accuracy improves.
- **Resolves early** once accuracy ≤ 40m, or after `maxWaitMs` (15s).
- Always cleans up the watch + timer (no leaks).

### 4d. Punch In / Out (lines 276–299)
1. Require a selfie (`photo`) first — else toast error.
2. `getLocation()` → `getBestPosition()` (best fix within the window).
3. POST `/attendance/punch-in` (or `/punch-out`) with `{latitude, longitude,
   accuracy, address, photo}`.
4. On success: toast the server message, clear photo, reload. On failure: toast
   the server's error (e.g. the "you appear to be Nm from site" message).

---

## 5. Server ingestion — `server/routes/attendance.js`

Mounted at `/api/attendance` (server/index.js:353). All routes are behind
`authMiddleware` (JWT), so `req.user.id` identifies the employee.

### 5a. `POST /punch-in` (line 529)
1. Require `latitude`/`longitude` (else 400 "enable GPS").
2. Reject if **already punched in today**.
3. Load active geofences; if none → 400 "No site locations configured".
4. `geo = evaluateGeofence(lat, lng, accuracy, geofences, geoSettings(db))`.
5. If `!geo.allow` → **400** with a real distance message (only ever a precise
   off-site lock reaches here).
6. `matchedSite = geo.matchedSite || site_name || nearestSite`.
7. `isPunchLate(db, now)` — IST-aware late check vs `payroll_settings.late_after_time`
   (fixes a UTC-vs-IST bug).
8. INSERT into `attendance` with coords, photo, `site_name`, `status`
   (`late`/`present`), `punch_in_accuracy`, and `location_verified = geo.verified`.
9. Respond 201 with `location_verified` and, when unverified, a note that it was
   recorded and flagged for review.

### 5b. `POST /punch-out` (line 582)
Same shape: require prior punch-in, reject double-out, require coords, run the
**same** `evaluateGeofence` (mam's ask — punch-out must also be geofenced; step
off-site → punch out first). Then compute `total_hours`, set `half_day` if < 4h,
and UPDATE the row with punch-out coords/photo/accuracy.

### 5c. `POST /track-location` — the 30s ping ingestion (line 636)
1. **`gps_off:true`** → INSERT a row with NULL coords and `site_name='GPS_OFF'`,
   return early. (This is the "online but no GPS" heartbeat.)
2. Else require coords, load geofences, run `evaluateGeofence`.
3. `site_name` = the matched site **only when `decision==='inside'`**, else
   `'Outside'` — so the live map is honest about "unconfirmed".
4. INSERT into `location_tracking`. Respond `{site}`.

*(Note: `runAutoPunchCheck()` at line 984 can auto punch based on sustained
inside/outside pings, but it is **intentionally disabled** at lines 1042–1046 —
every punch requires a manual selfie for accountability.)*

### 5d. Geofence CRUD
- `GET /geofence` (677) — **authenticated only** (every employee's punch screen
  needs the site list; gating it behind a permission caused a false "no sites").
- `POST /geofence` (822), `PUT /geofence/:id` (831), `DELETE /geofence/:id` (839)
  — permission-gated edits.

### 5e. `GET /audit/geofence-violations` (line 698) — admin audit
For every attendance row in a date range, computes distance from punch-in/out
coords to the nearest active geofence and classifies:
- **`outside_geofence`** — only counts as a real violation when a *precise* lock
  (`accuracy ≤ trust`) is beyond `radius`; a weak fix is surfaced as *unverified*,
  not a violation (review the selfie instead).
- **`beyond_3km`** — distance > 3000m.
- **`unverified`** — `location_verified = 0` rows.
Returns totals, the enforcement-rule text, and a GPS-spoof caveat (a well-crafted
mock-location spoof can't be detected here — the selfie is the backstop).

---

## 6. Admin views — `server/routes/locations.js`

Mounted at `/api/admin/locations` (server/index.js:396). Behind `authMiddleware`
**and** `adminOnly`. Pure read layer over `location_tracking`. Every query filters
opted-out users with `COALESCE(u.track_location,1)=1`.

### 6a. `GET /live` (line 36) — "who is where right now"
`?stale_minutes` (default 30, capped 720). SQL picks the **latest ping per user**
within the window (group-by-max-time self-join). Ordered: **GPS_OFF alerts first**,
then in-site, then Outside; each row carries `minutes_ago`.

### 6b. `GET /latest` (line 95) — the Team map feed
Like `/live` but **without** the live cutoff: latest ping per user within
`horizon_days` (default 7), each tagged `live: ageMs ≤ stale_minutes`. So the map
shows live people at their live spot and everyone else at their **last-known**
position. Also returns active `geofences` for the map overlay and a `live_count`.

### 6c. `GET /timeline?user_id&date` (line 146) — one person's day
1. Load all pings for that user/date, ordered by time.
2. Load that day's attendance (punch in/out times & addresses).
3. **Teleport / spoof detector** (line 177): for each ping, distance & speed from
   the previous *trusted* ping. If speed > **120 km/h** (`SUSPICIOUS_KMH`), mark
   `suspicious`, **exclude it from total distance**, and don't advance the "last
   trusted" pointer (so one bogus ping doesn't double-charge). This is what caught
   the "53 km away and back in 1 minute = 3,180 km/h" impossible ping.
4. Tag each ping `before` / `during` / `after` relative to punch in/out.
5. Return `pings[]` (enriched), `total_distance_m`, `attendance`, `geofences`,
   `suspicious_count`.

### 6d. `GET /users` (line 244)
Distinct users that have any ping and aren't opted out — populates the timeline
person-picker.

---

## 7. Admin frontend — `client/src/pages/admin/Locations.jsx`

The "Location Tracking" page with three tabs:
- **Live** — cards of who's where now (Google Maps links, GPS-off in red). Calls `/live`.
- **Team Map** — everyone on one Leaflet map via **`TeamMap.jsx`**: one marker per
  person (green=live, grey=last-seen, red=GPS off) + geofence circles. Calls `/latest`.
- **Timeline** — pick a user + date → **`RouteMap.jsx`** draws the day as a red
  polyline with start/end markers + geofence circles, plus a movement table where
  spoofed pings (`FRESH_MAX_MIN`, >120 km/h) are flagged. Calls `/timeline` + `/users`.

Live pings are considered stale in the UI after 15 min (`FRESH_MAX_MIN`,
Locations.jsx:29).

---

## 8. End-to-end sequence (one punch-in, start to finish)

```
1. Employee opens Attendance page.
2. useEffect starts: every 30s → getCurrentPosition → POST /track-location
   → server evaluateGeofence → INSERT location_tracking (site or 'Outside').
3. Employee taps "Punch In".
4. handlePunchIn(): requires selfie → getBestPosition() watches GPS ~up to 15s,
   keeps best fix (≤40m ends early).
5. POST /attendance/punch-in {lat,lng,accuracy,photo}.
6. Server: not-already-punched? → load geofences → evaluateGeofence().
      • matched/overlap → allow (verified 1 if precise, else 0)
      • weak fix not matched → allow, flagged
      • precise lock, confidently far → 400 "you are ~Nm from <site>"
7. On allow → INSERT attendance (coords, photo, site_name, status, accuracy,
   location_verified). 201 back to phone → toast "Punched In".
8. Meanwhile admin opens Location Tracking:
      • /live shows the employee's latest ping as in-site
      • /timeline reconstructs their route, flags any >120 km/h teleport
      • /audit/geofence-violations can later confirm the punch was on-site.
9. At day end: Punch Out repeats 4–7 via /punch-out; tracking useEffect stops.
10. After 60 days the location_tracking rows auto-purge.
```

---

## 9. Key design decisions (the "why")

| Decision | Reason |
|---|---|
| Shared `evaluateGeofence` for punch-in, punch-out, and ping | All three must agree, or the status pill lies about what the punch will do. |
| Weak GPS never blocks | Indoor phone GPS is unreliable; on-site staff were falsely blocked. Only a *precise* off-site lock blocks. |
| `location_verified` flag instead of blocking coarse fixes | Lets staff punch, but gives admin an audit trail of unconfirmed fixes. |
| Selfie mandatory; auto-punch disabled | The selfie is the real proof of presence — GPS can be spoofed. |
| 120 km/h teleport detector | Catches mock-location apps / cell-tower glitches; excludes them from distance totals. |
| `track_location` opt-out + `COALESCE(...,1)` everywhere | Admins/exempt staff can be excluded from all tracking views cleanly. |
| 60-day auto-purge + 30s ping cadence | Keeps the ping table bounded while staying near-real-time. |

---

### File index
| Layer | File |
|---|---|
| Geofence math + decision | `server/lib/geofence.js` |
| Punch + ping ingestion + audit | `server/routes/attendance.js` |
| Admin live/timeline reads | `server/routes/locations.js` |
| DB tables | `server/db/schema.js` |
| Employee punch UI | `client/src/pages/Attendance.jsx` |
| Admin tracking page | `client/src/pages/admin/Locations.jsx` |
| Team map (Leaflet) | `client/src/components/TeamMap.jsx` |
| Route map (Leaflet) | `client/src/components/RouteMap.jsx` |

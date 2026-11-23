# Uptime monitoring (owner setup)

Target: API uptime above 99.5% a month (docs/BUSINESS.md §13.2). The app exposes two checks and a
status page; an external monitor watches them and alerts the owner.

## What to monitor
| Check | URL | Every | Alert when |
|---|---|---|---|
| Liveness | `https://<app>/api/health` | 1 min | not 200 twice in a row |
| Readiness (database migrated, file storage up) | `https://<app>/api/health/ready` | 1 min | not 200 twice in a row, or body `data.status` ≠ `ready` |
| Background jobs | `/admin/system` (admins) | when alerted | "Late: last good run …" (more than 2 minutes) |

`/api/health*` are public, need no key, reveal only the build version and migration numbers, and
are not rate limited (so monitors never trip the limits).

## Setting it up (any free monitor works: Better Stack, UptimeRobot, Checkly)
1. Create two HTTP monitors with the URLs above, 1-minute interval, from an Asia region if offered.
2. For readiness add a keyword check for `"status":"ready"`.
3. Alerts: the owner's phone (SMS or app push) and email; escalate to the on-duty coordinator
   after 10 minutes.
4. Optional: a public status page with the two monitors.

## When an alert fires
1. Open `/api/health/ready`:
   - `database: unreachable` → Supabase status page and project health; check `DATABASE_URL` in
     Vercel.
   - `database: outdated` → a migration is waiting: approve **Deploy database migrations**.
   - `storage: unreachable` → Supabase Storage status; uploads and KYC views fail meanwhile.
2. Open `/admin/system` for job lag, failed payment webhooks and missed store deadlines.
3. Payment gateway down → **Settings → online_payments → off** (cash on delivery only). Turn it back
   on when PayMongo recovers.
4. Maps provider down → customers drop the pin themselves automatically; if pins look wrong, turn
   **flat_delivery_fee** on so every delivery costs the zone base fee.
5. Errors: Sentry (when `SENTRY_DSN` is set) groups them by route with the request id; search the
   Vercel logs for the same `requestId`.

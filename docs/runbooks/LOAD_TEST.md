# Load test: lunch peak (k6)

## Assumption: pilot peak
docs/BUSINESS.md §6.4 expects 24–48 orders a day in the first zone. We plan for a lunch hour of
**60 orders and 600 browsing sessions** (half a busy day's orders in one hour, ten browsers per
order). The test runs **5×** that: 300 orders an hour (5 a minute), 3,000 sessions an hour
(50 a minute), the store board polled and orders accepted every 15 seconds, and the scheduler's
jobs every 10 seconds. Change `MULTIPLIER` and `MINUTES` to try other loads.

**Pass:** p95 API latency under 500 ms and no failed requests.

## Run it
```bash
pnpm build && pnpm --filter @klikgo/web start
```
```bash
node --import tsx load/prepare-sessions.ts 20
```
```bash
k6 run load/lunch-peak.js
```
`prepare-sessions.ts` needs the local (or staging) stack's `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `PLACEHOLDER_OTP_CODE`, and writes
`load/.sessions.json` (git-ignored). Set `CRON_SECRET` to include the scheduler. Never point it at
production.

CI: **Actions → Load test** (also runs on PRs that change `load/`), k6 in Docker against the
production build and a local Supabase; the summary is uploaded as an artifact.

## Results

### Local, Phase 11 (2026-11-23)
Same request mix and rates, driven from Node (k6 could not be installed in that sandbox), against
`next start` and the local Supabase on one machine, 3 minutes at 5×:

| | Before | After the notification fix |
|---|---|---|
| Requests | 516 | 516 |
| Failed | 0 | 0 |
| p95 | 143 ms | 201 ms |
| p99 | 543 ms | 327 ms |
| Place order p95 | 667 ms | 344 ms |

Fix found: a new order notified the store team one person at a time; it now sends in parallel
batches of 10 (`NotificationService`). The database's slowest statements
(`pg_stat_statements`) were all under 15 ms on average with the existing indexes, so no index was
added.

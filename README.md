<img src="docs/brand/klik-go-logo.svg" width="96" alt="Klik Go logo">

# Klik Go — Delivery Services

Klik Go is a delivery platform for the Philippines, built for barangays and provincial towns, on a Hybrid Aggregator + Managed Logistics model. It starts with food delivery in one pilot zone, then grows into groceries, parcels, pharmacy and B2B.

> Status: Phases 0–6 merged; Phase 6.1 (demo data for the hosted app) in review. See `docs/PROGRESS.md`.

## Docs
| File | What it is |
|---|---|
| `docs/BUSINESS.md` | Business documentation v1.0, the source of truth for business rules |
| `docs/BUILD_PLAN.md` | Setup review, UX direction, business fixes and the phased build plan (Phase 0 → pilot launch) |
| `docs/ARCHITECTURE.md` | BFF diagram, request flow, roles, order state machine, folder map, testing strategy |
| `docs/OPEN_QUESTIONS.md` | Blocked decisions, doc conflicts, proposals, and the owner checklist for GitHub/Vercel settings |
| `docs/BRAND.md` | KGo logo files, colours, typography and contrast rules |
| `docs/ERD.md` | Entity relationship diagram + RLS policy list, generated from the database |
| `docs/CLAUDE_PROMPTS.md` | Prompts for coding agents: a master kickoff prompt and a per-phase continuation template |
| `docs/PROGRESS.md` | Phase checklist, updated in every PR |
| `CLAUDE.md` | Standing instructions for AI coding agents |

## Stack
Node 26 LTS · Next.js 16 (App Router, React 19, TypeScript 6 strict) on Vercel as the only public entry point (BFF) · domain logic in `packages/core` · Supabase (Postgres 17 + PostGIS, Auth, Realtime, Storage, pg_cron; CLI 3) · Prisma 7 (pg driver adapter) · Tailwind v4 + shadcn/ui · next-intl (en, fil) · pino · Vitest 5, Cucumber.js 13 and Playwright 1.64 · pnpm 12 + Turborepo · ESLint 10 · GitHub Actions.

```
apps/web            Next.js BFF + web surfaces
packages/core       framework-free domain (services, ports, Result, money)
packages/adapters   port implementations (logger, clock, later PayMongo/SMS/maps)
packages/db         Prisma client (mirrors supabase/migrations)
packages/types      shared zod schemas
packages/config     tsconfig, ESLint, Prettier, design tokens
packages/ui         shared components
features/           Cucumber.js scenarios
supabase/           CLI config, migrations, seed
```

## Local setup

Prerequisites: Node 26 LTS (`.nvmrc`; 24 also works), pnpm 12 (`npm install -g pnpm@12.16.1`, the version pinned in `packageManager`), Docker (for local Supabase).

pnpm 12 refuses dependency versions published less than a day ago (`minimumReleaseAge`) and only runs build scripts listed under `allowBuilds` in `pnpm-workspace.yaml`. Both are deliberate supply-chain protections; do not turn them off.

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:3000, and http://localhost:3000/api/health should return `{"data":{"status":"ok"},...}`. Once the local database is running and migrated, http://localhost:3000/api/health/ready returns `"database":"ok"` (503 with `unreachable` or `outdated` otherwise).

Environment: copy `.env.example` to `apps/web/.env.local` and fill values only when a phase needs them. Phase 0 runs with no env vars.

### Local database (Supabase)

```bash
pnpm db:start
```

```bash
pnpm db:reset
```

`db:reset` reapplies every migration in `supabase/migrations` plus `supabase/seed.sql` (placeholder pilot zone, 5 merchants with menus, 3 riders, test customers; no passwords).

Sign-in locally (phone OTP, staff invites and TOTP) needs Supabase Auth and a few env vars:

```bash
echo "SEND_SMS_HOOK_SECRET=v1,whsec_$(openssl rand -base64 32)" > supabase/.env   # gitignored; read by supabase start
```

Then put the values from `pnpm exec supabase status -o env` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL`) and the same `SEND_SMS_HOOK_SECRET` into `apps/web/.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`/`DIRECT_URL` and `SEND_SMS_HOOK_SECRET`. Test phone numbers +639170000101 to +639170000110 always accept the code `123456` (no SMS is sent). Create the first admin with:

```bash
ADMIN_EMAIL=you@example.com pnpm bootstrap:admin
```

Demo stores for showing the app (9 stores across the launch zones, promo codes, one owner account): `DEMO_OWNER_EMAIL=you@example.com pnpm demo:data` locally, or GitHub Actions → **Load demo data** for the hosted project (`DEMO_ACTION=hide` takes them off again; docs/OPEN_QUESTIONS.md Q28).

For the hosted project, use GitHub Actions → **Bootstrap first admin** instead (needs the `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` repository secrets; see `docs/OPEN_QUESTIONS.md` Q13 step 8). It prints a one-time link: open it straight away, then delete the run's logs.

Payments work locally without PayMongo: add `PAYMENT_GATEWAY=fake` to `apps/web/.env.local` and online payments (GCash, Maya, card, QR Ph) open the local test checkout at `/dev/pay`, which sends the same signed webhook PayMongo would (set `PAYMONGO_WEBHOOK_SECRET` to any test value if Cucumber should sign webhooks too). Unpaid online orders are cancelled after 15 minutes by pg_cron. The real PayMongo API in test mode: `PAYMONGO_TEST_SECRET_KEY=sk_test_… pnpm --filter @klikgo/adapters test:paymongo`.

Live order updates need Supabase Realtime, so start Supabase without excluding `realtime`. The store board is at `/merchant/orders`. Background jobs (queued texts, unfinished refunds) run when something calls `POST /api/internal/jobs` with `Authorization: Bearer $CRON_SECRET`; production uses pg_cron + pg_net (docs/OPEN_QUESTIONS.md Q25). Web Push needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`; without them, in-app and SMS still work.

AI menu import works locally without a Gemini key: add `MENU_PARSER=fake` to `apps/web/.env.local` to use the built-in sample menu reader. Menu photo uploads need Storage, so start Supabase without excluding `storage-api`.

Database tests and generated files (need the local DB running):

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres DIRECT_URL=$DATABASE_URL
```

```bash
pnpm test:db                              # RLS isolation, PostGIS, integrity, seed (rolled-back transactions)
```

```bash
pnpm --filter @klikgo/db db:pull          # regenerate prisma/schema.prisma after a migration
```

```bash
pnpm --filter @klikgo/db db:erd           # regenerate docs/ERD.md after a migration
```

Get the local URLs and keys with `pnpm exec supabase status -o env`. The local database URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

### Checks (the same ones CI runs)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test:unit
```

```bash
pnpm build
```

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:bdd
```

```bash
pnpm test:e2e
```

```bash
pnpm lighthouse
```

- `test:bdd` runs Cucumber against `BASE_URL` (default `http://localhost:3000`) and starts `next start` itself if nothing is listening. `@db` scenarios run only when `DATABASE_URL` is set.
- `test:e2e` runs Playwright on the `mobile-pixel-7` and `desktop-chrome` projects. The first time, install the browser with `pnpm --filter @klikgo/web exec playwright install chromium`. To reuse a Chromium you already have, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (used by Playwright and Cucumber).
- `lighthouse` audits the store page and Home on Lighthouse's mobile profile against a running server (`BASE_URL`), takes the median of 3 runs (`LIGHTHOUSE_RUNS`) and fails below the budget (performance 85, accessibility 95, best practices 90). HTML reports go to `lighthouse-report/`. Set `CHROME_PATH` to use a specific Chromium.

## Working agreement
One phase per pull request, from a `phase-N-short-name` branch. Tests are written first (BDD/TDD). Secrets never go in code. Every table has RLS. See `CLAUDE.md`.

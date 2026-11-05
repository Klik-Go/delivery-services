<img src="docs/brand/klik-go-logo.svg" width="96" alt="Klik Go logo">

# Klik Go — Delivery Services

Klik Go is a delivery platform for the Philippines, built for barangays and provincial towns, on a Hybrid Aggregator + Managed Logistics model. It starts with food delivery in one pilot zone, then grows into groceries, parcels, pharmacy and B2B.

> Status: Phase 0 (foundations) done; Phase 0.1 (latest toolchain + KGo brand) in review. See `docs/PROGRESS.md`.

## Docs
| File | What it is |
|---|---|
| `docs/BUSINESS.md` | Business documentation v1.0, the source of truth for business rules |
| `docs/BUILD_PLAN.md` | Setup review, UX direction, business fixes and the phased build plan (Phase 0 → pilot launch) |
| `docs/ARCHITECTURE.md` | BFF diagram, request flow, roles, order state machine, folder map, testing strategy |
| `docs/OPEN_QUESTIONS.md` | Blocked decisions, doc conflicts, proposals, and the owner checklist for GitHub/Vercel settings |
| `docs/BRAND.md` | KGo logo files, colours, typography and contrast rules |
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

Open http://localhost:3000, and http://localhost:3000/api/health should return `{"data":{"status":"ok"},...}`.

Environment: copy `.env.example` to `apps/web/.env.local` and fill values only when a phase needs them. Phase 0 runs with no env vars.

### Local database (Supabase)

```bash
pnpm db:start
```

```bash
pnpm db:reset
```

`db:reset` reapplies every migration in `supabase/migrations` plus `supabase/seed.sql`. Get the local URLs and keys with `pnpm exec supabase status -o env`. The local database URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

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

- `test:bdd` runs Cucumber against `BASE_URL` (default `http://localhost:3000`) and starts `next start` itself if nothing is listening. `@db` scenarios run only when `DATABASE_URL` is set.
- `test:e2e` runs Playwright on the `mobile-pixel-7` and `desktop-chrome` projects. The first time, install the browser with `pnpm --filter @klikgo/web exec playwright install chromium`. To reuse a Chromium you already have, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (used by Playwright and Cucumber).

## Working agreement
One phase per pull request, from a `phase-N-short-name` branch. Tests are written first (BDD/TDD). Secrets never go in code. Every table has RLS. See `CLAUDE.md`.

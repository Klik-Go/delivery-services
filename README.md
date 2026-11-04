# Klik Go — Delivery Services

Klik Go is a delivery platform for the Philippines, built for barangays and provincial towns, on a Hybrid Aggregator + Managed Logistics model. It starts with food delivery in one pilot zone, then grows into groceries, parcels, pharmacy and B2B.

> Status: Phase 0 (foundations). See `docs/PROGRESS.md`.

## Docs
| File | What it is |
|---|---|
| `docs/BUSINESS.md` | Business documentation v1.0, the source of truth for business rules |
| `docs/BUILD_PLAN.md` | Setup review, UX direction, business fixes and the phased build plan (Phase 0 → pilot launch) |
| `docs/ARCHITECTURE.md` | BFF diagram, request flow, roles, order state machine, folder map, testing strategy |
| `docs/OPEN_QUESTIONS.md` | Blocked decisions, doc conflicts and proposals |
| `docs/CLAUDE_PROMPTS.md` | Prompts for coding agents: a master kickoff prompt and a per-phase continuation template |
| `docs/PROGRESS.md` | Phase checklist, updated in every PR |
| `CLAUDE.md` | Standing instructions for AI coding agents |

## Stack
Next.js 15 (App Router, TypeScript strict) on Vercel as the only public entry point (BFF) · domain logic in `packages/core` · Supabase (Postgres 17 + PostGIS, Auth, Realtime, Storage, pg_cron) · Prisma · Tailwind v4 + shadcn/ui · next-intl (en, fil) · pino · Vitest, Cucumber.js and Playwright · pnpm + Turborepo · GitHub Actions.

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

Prerequisites: Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`), Docker (for local Supabase).

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
- `test:e2e` runs Playwright on the `mobile-pixel-7` and `desktop-chrome` projects. The first time, install the browser with `pnpm --filter @klikgo/web exec playwright install chromium`.

## Working agreement
One phase per pull request, from a `phase-N-short-name` branch. Tests are written first (BDD/TDD). Secrets never go in code. Every table has RLS. See `CLAUDE.md`.

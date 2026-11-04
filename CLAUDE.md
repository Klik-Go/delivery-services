# CLAUDE.md — standing instructions for AI coding agents

## Scope
- Repository: **Klik-Go/delivery-services** (https://github.com/Klik-Go/delivery-services), default branch `main`.
- Work **only** in this repository. Never read, write or open PRs in any other repo or org, and **never touch `senate-ph`**.

## Read first, every session
1. `docs/BUSINESS.md`: the business rules (order lifecycle §5.2, rider/merchant rules §5.3–5.4, zones §5.5, features §9, SOLID rules §10.3–10.4).
2. `docs/BUILD_PLAN.md`: architecture, data model corrections, and the phase you are on (goal, deliverables, acceptance, prompt).
3. `docs/PROGRESS.md`: what is done and what is next.
4. `docs/ARCHITECTURE.md` and `docs/OPEN_QUESTIONS.md` once they exist.

If the docs conflict, `docs/BUILD_PLAN.md` wins on tech choices and `docs/BUSINESS.md` wins on business rules. Record each conflict in `docs/OPEN_QUESTIONS.md`.

## Architecture rules
- **BFF:** `apps/web` (Next.js App Router) is the only public entry point. Browsers and mobile apps call only `/api/*` route handlers. No other public API.
- Domain logic lives in `packages/core` (pure TypeScript, SOLID, ports/interfaces, `Result` types). External integrations go in `packages/adapters`. Wiring goes in `apps/web/src/server/container.ts`. Layer order: Route handler → Service → Repository/Adapter. No business logic in components or route handlers.
- Every order status change goes through `OrderStateMachine` and writes an `order_events` row.
- Next.js middleware uses `runtime: "nodejs"` (not Edge).
- TypeScript strict. No `any`. Validate every input with Zod.

## Money, time, data
- **Money is always integer centavos** (`*_centavos` columns, `number` ints in TS). No floats for money. Format with one `formatPeso()` helper.
- Store times in UTC and display them in Asia/Manila.
- **RLS is enabled on every table**, with policies per role (customer, rider, merchant_owner, merchant_staff, coordinator, admin). Every new table ships with an isolation test that proves one user can't read another's rows.
- PostGIS `geography` for locations and zones. Snapshot addresses and item prices onto orders.

## Security
- **No secrets in code, tests, fixtures, logs or PR text.** Add variable *names* to `.env.example` only. Real values live in Vercel, GitHub and Supabase settings.
- The Supabase service-role key, PayMongo secret, SMS and Gemini keys are server-only.
- Verify webhook signatures and make handlers idempotent (`webhook_events`).
- Rider KYC files go in a private bucket, opened only through short-lived signed URLs, and every view is audited.
- Never send customer personal data to an LLM.

## How you work (TDD/BDD)
1. Write a Cucumber.js `.feature` in business language taken from `docs/BUSINESS.md`, plus failing step definitions and Vitest unit tests.
2. Implement until green.
3. Add Playwright e2e tests for UI flows (mobile Pixel 7 + desktop projects).
4. Lint, typecheck, unit, Cucumber, Playwright and build must all pass locally and in CI.

## Pull requests
- **One phase per PR**, from a branch named `phase-N-short-name`. Never push application code straight to `main`. Never merge your own PR.
- The PR description includes a summary, how to test, screenshots for UI, test evidence, migration notes, env vars added (names only) and open questions.
- **Update `docs/PROGRESS.md` in the same PR:** tick completed items, link evidence, note what's next.
- Stop after opening the PR and wait for human review before starting the next phase.

## Style
- Files kebab-case, classes PascalCase, functions camelCase, constants SCREAMING_SNAKE_CASE. Interfaces get the `I` prefix only for repository and gateway ports.
- Comments explain *why*, not *what*. JSDoc on public functions.
- Tailwind + shadcn/ui with tokens from `packages/config`. Mobile-first at 360 px.

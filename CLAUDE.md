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

### Where code goes (layer order, strict)
`Route handler (apps/web/src/app/api/**/route.ts)` → `Service (packages/core)` → `Repository / Adapter (packages/adapters, packages/db)` → Prisma / Supabase / external API.
- **Route handlers:** read the request id, authenticate, check the role, zod-parse the input (schemas from `packages/types`), call **one** service method, and return the `{ data, error, meta }` envelope via `jsonOk` / `jsonError` (`apps/web/src/server/http/api-response.ts`). No business logic and no Prisma.
- **Services (`packages/core`):** orchestrate business rules. They depend only on ports (interfaces) passed into the constructor. They return `Result<T, AppError>` for expected failures. They never import `next`, `react`, `@prisma/*`, `@supabase/*`, `pino` or `@klikgo/adapters` (ESLint enforces this).
- **Repositories:** all DB access through Prisma (or SQL functions for PostGIS/RLS work). They return domain objects. They are tested against a real local Supabase DB, not mocks.
- **Adapters (`packages/adapters`):** one class per external service (PayMongo, Semaphore, Maps, Web Push, Gemini, Storage). Each implements a core port and ships with a **Fake** in `packages/core/src/testing` (or next to the port) for tests and Cucumber.
- **Composition root:** `apps/web/src/server/container.ts` is the only place that picks concrete adapters (it replaces NestJS DI). Never call `new SomeAdapter()` inside a service.
- **Components (`apps/web/src/app/**`, `src/components/**`):** render UI and hold local UI state only. They never import `@klikgo/adapters` or `@klikgo/db` (ESLint enforces this). Server Components by default; Client Components only for interactivity and Realtime.

### SOLID in practice (docs/BUSINESS.md §10.3, adapted to the composition root)
- **S:** one reason to change per class. `OrderService` does order creation and transitions, not SMS, fees or analytics. Extract `NotificationService`, `PricingService` and so on.
- **O:** extend by adding implementations. A new payment gateway = a new `IPaymentGateway` adapter. A new fee rule = a new `DeliveryFeeStrategy`. No `switch` on a payment-method string inside a service.
- **L:** every implementation (including Fakes) honours the whole port contract. A fake that throws "not implemented" breaks LSP; implement the behaviour in memory instead.
- **I:** small ports. Split read and write repositories (`IReadableOrderRepository` / `IWriteableOrderRepository`) when consumers differ.
- **D:** services receive ports through the constructor (`new OrderService({ orders, payments, notifier, clock })`) from `container.ts`.

### TypeScript and errors
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Never `any`; use `unknown` and narrow it.
- Exported functions have explicit parameter and return types.
- Interfaces for public contracts, types for unions and utilities. Enums (or string-literal unions) only for values with business meaning (`OrderStatus`, `PaymentMethod`).
- Async code returns `Result<T, E>` or is wrapped in try/catch. Never swallow an error: log it with context (request id, entity id), never with personal data.
- Use the error classes from `packages/core` (`AppError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`). The BFF maps codes to HTTP status; unexpected errors become a generic 500 with no internals.
- Log through the `Logger` port (pino adapter, JSON lines with `requestId`). No `console.*` in app code.

### Next.js rules
- App Router only. Role surfaces live under `app/(customer)`, `app/merchant`, `app/rider` and `app/admin`.
- Server state: TanStack Query against `/api/*`. Global client state: small Zustand stores. Live updates: Supabase Realtime **private channels** (read-only). All writes go through `/api/*`.
- Forms: React Hook Form + zod schemas from `packages/types`.
- Tailwind utilities only. No inline styles, no CSS modules, no hard-coded colours or spacing; use the tokens in `packages/config/tailwind/tokens.css`.
- The CSP is nonce-based and set in `src/middleware.ts`. Never add `'unsafe-inline'` to `script-src`. Allow a new origin only with a reason in the PR.
- Always handle loading, error and empty states.

### Database rules
- Schema changes are Supabase CLI SQL migrations in `supabase/migrations` (RLS, PostGIS and pg_cron live in SQL). Mirror them in `packages/db/prisma/schema.prisma` in the same PR.
- Never string-interpolate user input into SQL.
- Runtime uses pooled `DATABASE_URL`; the Prisma CLI uses `DIRECT_URL`.

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

Testing rules (docs/BUSINESS.md §10.4.6):
- Coverage targets: services in `packages/core` ≥ 90% lines (enforced in `vitest.config.ts`); repositories ≥ 80% (real local DB); route handlers ≥ 70% (happy path + validation failure); React components ≥ 60% (critical flows).
- Arrange / Act / Assert. Test names describe behaviour ("rejects an order when the merchant is closed"), not methods.
- Unit tests mock or fake every external dependency. Integration tests use the local Supabase DB (`pnpm db:start`).
- Test files sit next to the code (`order-service.test.ts`). Cucumber features in `features/`, Playwright specs in `apps/web/e2e/`.
- Test observable behaviour, not implementation details.

Commands:
```bash
pnpm dev            # Next.js dev server on :3000
pnpm lint && pnpm typecheck && pnpm test:unit
pnpm build && pnpm test:bdd && pnpm test:e2e
pnpm db:start && pnpm db:reset   # local Supabase (Docker)
```

## Pull requests
- **One phase per PR**, from a branch named `phase-N-short-name`. Never push application code straight to `main`. Never merge your own PR.
- The PR description includes a summary, how to test, screenshots for UI, test evidence, migration notes, env vars added (names only) and open questions.
- **Update `docs/PROGRESS.md` in the same PR:** tick completed items, link evidence, note what's next.
- Stop after opening the PR and wait for human review before starting the next phase.

## Style
- Files kebab-case, classes PascalCase, functions camelCase, constants SCREAMING_SNAKE_CASE. Interfaces get the `I` prefix only for repository and gateway ports.
- Comments explain *why*, not *what*. JSDoc on public functions.
- Tailwind + shadcn/ui with tokens from `packages/config`. Mobile-first at 360 px.

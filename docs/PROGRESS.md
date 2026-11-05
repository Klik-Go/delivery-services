# Progress

Phases are defined in `docs/BUILD_PLAN.md` §6. Agents update this file in every PR. Tick only what is merged or verified, and link the evidence (PR, CI run, screenshot).

| Phase | Name | Status | PR | Notes |
|---|---|---|---|---|
| — | Docs: BUSINESS, BUILD_PLAN, CLAUDE.md, prompts | ✅ Done | initial commit | |
| 0 | Foundations (monorepo, rules, CI) | ✅ Done (merged) | [Klik-Go/delivery-services#1](https://github.com/Klik-Go/delivery-services/pull/1) | Vercel link pending owner (OPEN_QUESTIONS Q1) |
| 0.1 | Follow-up: latest toolchain + KGo brand | 🟡 In progress (PR open) | [Klik-Go/delivery-services#3](https://github.com/Klik-Go/delivery-services/pull/3) | Owner answers to Q2, Q5, Q6, Q7 |
| 1 | Data model, migrations, RLS, seed | ⬜ Not started | | |
| 2 | Auth and RBAC per role | ⬜ Not started | | |
| 3 | Merchant onboarding and menu (+ AI import) | ⬜ Not started | | |
| 4 | Customer discovery, store page, cart (PWA) | ⬜ Not started | | |
| 5 | Checkout and payments (PayMongo + COD) | ⬜ Not started | | |
| 6 | Order lifecycle, merchant queue, SLA | ⬜ Not started | | |
| 7 | Rider app, dispatch, live tracking | ⬜ Not started | | |
| 8 | Coordinator and Admin console | ⬜ Not started | | |
| 9 | Ratings, reorder, promos, referrals, loyalty | ⬜ Not started | | |
| 10 | Finance: settlements, payouts, reports | ⬜ Not started | | |
| 11 | Hardening: security, privacy, observability | ⬜ Not started | | |
| 12 | Pilot launch | ⬜ Not started | | |

Status values: ⬜ Not started · 🟡 In progress (PR open) · ✅ Done (merged) · ⛔ Blocked (say why)

## Current phase checklist
### Phase 0 — Foundations (branch `phase-0-foundations`)
Acceptance (docs/BUILD_PLAN.md §6):
- [x] `pnpm i && pnpm dev` runs. Verified locally: `/` 200, `/api/health` → `{"data":{"status":"ok"}}`.
- [x] `features/health.feature` passes in Cucumber (local: 7 scenarios / 35 steps passed, including `@db` against local Supabase) and Playwright (local: 16/16 on `mobile-pixel-7` + `desktop-chrome`).
- [x] CI green on the PR (lint, typecheck, unit, supabase start + migrate, cucumber, playwright, build): [CI run 41888290385](https://github.com/Klik-Go/delivery-services/actions/runs/41888290385) on `f0ab8cd`; CodeQL green, and the unpinned-action finding is fixed by installing pnpm via corepack.
- [ ] Vercel preview deploys. **Owner action:** link the project (docs/OPEN_QUESTIONS.md Q1).
- [x] Security headers present: CSP with per-request nonce, HSTS, X-Frame-Options, Referrer-Policy (+ nosniff, Permissions-Policy, COOP). Covered by `features/security-headers.feature` and `apps/web/e2e/security-headers.spec.ts`.
- [x] No secrets in repo. `.env.example` has names only.

Deliverables:
- [x] pnpm workspace + Turborepo: `apps/web`, `packages/{core,adapters,db,types,config,ui}`
- [x] `supabase/` CLI config + first migration (PostGIS in `extensions`, pg_cron), verified with `supabase start` + `supabase db reset`
- [x] `CLAUDE.md` extended with BUSINESS.md §10.3–10.4 rules (composition root instead of NestJS DI)
- [x] `docs/ARCHITECTURE.md` (BFF diagram, request flow, roles, order state machine, folder map, testing strategy)
- [x] Vitest (85 unit tests, 99.5% line coverage; core threshold 90%), Cucumber.js (TS steps, world with API client + DB helper + browser), Playwright (Pixel 7 + desktop, axe a11y)
- [x] Security: nonce CSP in Node.js middleware (now `src/proxy.ts` on Next 16), static headers in `next.config.ts`, request id + pino JSON logger with PII redaction
- [x] GitHub Actions `ci.yml`, CodeQL, Dependabot, PR template
- [x] `.env.example` (names only) and README with local setup
- [ ] Vercel project linked (owner)

### Phase 0.1 — Follow-up: latest toolchain + KGo brand (owner answers 2026-11-05)
- [x] Q2 "use what is up to date": Node 26 LTS, pnpm 12, Next.js 16 (middleware → `src/proxy.ts`), React 19.3, TypeScript 6.0, ESLint 10, Vitest 5, Prisma 7 (`prisma.config.ts` + pg adapter), Playwright 1.64, Supabase CLI 3, jsdom 30; Dependabot proposes majors (2-day cooldown). Exceptions in OPEN_QUESTIONS Q9.
- [x] Q5 branch naming: resolved (phase-N for phases; session branch allowed for follow-ups).
- [x] Q6: step-by-step GitHub settings checklist in OPEN_QUESTIONS Q6 (owner to apply).
- [x] Q7 brand: KGo logo and colours across tokens, `<BrandLogo />`, Lilita One wordmark, favicon, Apple/PWA icons, home page, docs (`docs/BRAND.md`).
- [x] All checks green locally on Node 26 (lint, typecheck, unit, Cucumber incl. `@db`, Playwright 22/22 incl. axe, build).
- [ ] CI green on the PR.
- [ ] Owner: Vercel link (Q1), GitHub settings (Q6), pilot barangay (Q8).

Next: Phase 1, data model, migrations, RLS and seed (after this PR is reviewed and merged).

## Business validation (parallel, doc §8)
- [ ] 20–30 customer interviews in the pilot barangay
- [ ] 10–15 merchant surveys (commission tolerance, packaging, subscription interest)
- [ ] 2-week waitlist, target 50 or more sign-ups
- [ ] Real inputs for the unit economics model (rider pay per trip, delivery fee, COD share)

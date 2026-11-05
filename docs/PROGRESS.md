# Progress

Phases are defined in `docs/BUILD_PLAN.md` §6. Agents update this file in every PR. Tick only what is merged or verified, and link the evidence (PR, CI run, screenshot).

| Phase | Name | Status | PR | Notes |
|---|---|---|---|---|
| — | Docs: BUSINESS, BUILD_PLAN, CLAUDE.md, prompts | ✅ Done | initial commit | |
| 0 | Foundations (monorepo, rules, CI) | ✅ Done (merged) | [Klik-Go/delivery-services#1](https://github.com/Klik-Go/delivery-services/pull/1) | Vercel linked 2026-11-05 (preview deploys from #3) |
| 0.1 | Follow-up: latest toolchain + KGo brand | ✅ Done (merged) | [Klik-Go/delivery-services#3](https://github.com/Klik-Go/delivery-services/pull/3) | Owner answers to Q2, Q5, Q6, Q7 |
| 1 | Data model, migrations, RLS, seed | ✅ Done (merged) | [Klik-Go/delivery-services#6](https://github.com/Klik-Go/delivery-services/pull/6) | Placeholder pilot zone until Q8 is answered |
| 2 | Auth and RBAC per role | ✅ Done (merged) | [Klik-Go/delivery-services#7](https://github.com/Klik-Go/delivery-services/pull/7) | Owner: hosted Supabase auth settings (OPEN_QUESTIONS Q12, Q13) |
| 3 | Merchant onboarding and menu (+ AI import) | ✅ Done (merged) | [Klik-Go/delivery-services#8](https://github.com/Klik-Go/delivery-services/pull/8) | Owner: Gemini key + paid tier (Q16); 20-items UAT |
| 3.1 | Follow-up: launch zones (Makati, San Fernando, San Marcelino) + owner answers | 🟡 In progress (PR open) | [Klik-Go/delivery-services#9](https://github.com/Klik-Go/delivery-services/pull/9) | Owner: `main` ruleset target (Q6), Gemini paid tier (Q16) |
| 4 | Customer discovery, store page, cart (PWA) | 🟡 In progress (PR open) | [Klik-Go/delivery-services#10](https://github.com/Klik-Go/delivery-services/pull/10) | Owner: `GOOGLE_MAPS_API_KEY` for address search (optional, Q17) |
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
- [x] Vercel preview deploys: project `delivery-services-web` (root `apps/web`) linked by the owner on 2026-11-05; the preview for [Klik-Go/delivery-services#3](https://github.com/Klik-Go/delivery-services/pull/3) reported **Ready**.
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
- [x] Vercel project linked (owner, 2026-11-05)

### Phase 0.1 — Follow-up: latest toolchain + KGo brand (owner answers 2026-11-05)
- [x] Q2 "use what is up to date": Node 26 LTS, pnpm 12, Next.js 16 (middleware → `src/proxy.ts`), React 19.3, TypeScript 6.0, ESLint 10, Vitest 5, Prisma 7 (`prisma.config.ts` + pg adapter), Playwright 1.64, Supabase CLI 3, jsdom 30; Dependabot proposes majors (2-day cooldown). Exceptions in OPEN_QUESTIONS Q9.
- [x] Q5 branch naming: resolved (phase-N for phases; session branch allowed for follow-ups).
- [x] Q6: step-by-step GitHub settings checklist in OPEN_QUESTIONS Q6 (owner to apply).
- [x] Q7 brand: KGo logo and colours across tokens, `<BrandLogo />`, Lilita One wordmark, favicon, Apple/PWA icons, home page, docs (`docs/BRAND.md`).
- [x] All checks green locally on Node 26 (lint, typecheck, unit, Cucumber incl. `@db`, Playwright 22/22 incl. axe, build).
- [x] CI green on the PR: [CI run 41972124662](https://github.com/Klik-Go/delivery-services/actions/runs/41972124662) on `675b4d4` (Node 26, pnpm 12); CodeQL green.
- [x] Vercel linked; the preview for this PR deploys (Vercel bot: Ready).
- [ ] Owner: GitHub settings (Q6), pilot barangay (Q8).

### Phase 1 — Data model, migrations, RLS, seed (branch `phase-1-data-model`)
Acceptance (docs/BUILD_PLAN.md §6):
- [x] `supabase db reset` applies all 10 migrations and seeds cleanly (local; CI step "Supabase migrate").
- [x] RLS tests prove isolation per role: `packages/db/test/rls-visibility.db.test.ts` (who sees which rows, every table × customer, merchant owner/staff, rider, coordinator, admin, anonymous), `rls-writes.db.test.ts` (what each role may change) and `rls-coverage.db.test.ts` (RLS on for every table, a policy on every client-facing table, no anon write policy, no SECURITY DEFINER in `public`). Business scenarios in `features/privacy.feature`.
- [x] PostGIS "zone containing point" and "nearest available riders" return correct results: `packages/db/test/geo.db.test.ts`, `features/zones.feature`, `features/dispatch.feature`.

Deliverables:
- [x] SQL migrations (Supabase CLI) for every table in the plan: 33 tables, 21 enums, helper functions `zone_for_point`, `nearest_available_riders`, `private.has_role` (+ `is_admin`, `is_merchant_member`, `coordinates_zone`, `current_rider_id`).
- [x] Integrity in the database: order totals and line totals add up, legal status transitions only (+ `order_events` written for every change), balanced double-entry ledger, append-only history/ledger/audit, merchant inside its zone, zone radius per type, one accepted offer per order.
- [x] RLS policies per role + column-level grants (clients write only what they own; orders, payments, ledger and roles change through the server).
- [x] Storage: public `menu-photos`, private `rider-kyc` with folder-scoped policies.
- [x] Prisma schema mirrors the database (`db:pull`, drift check in CI).
- [x] Seed: placeholder pilot zone, 5 merchants with menus and options, 3 riders, customers, coordinator, admin, fee rules, feature flags.
- [x] ERD in `docs/ERD.md`, generated from the database (freshness check in CI).
- [x] CI green on the PR: [CI run 41977868740](https://github.com/Klik-Go/delivery-services/actions/runs/41977868740) on `f3dd370` (merged as Klik-Go/delivery-services#6).

### Phase 2 — Auth and RBAC per role (branch `phase-2-auth-rbac`)
Acceptance (docs/BUILD_PLAN.md §6, Gherkin in `features/auth/`):
- [x] A customer signs up with a phone OTP and lands on Home (`customer-otp.feature`, browser; `e2e/auth.spec.ts` on Pixel 7 + desktop).
- [x] A merchant invite → set password → enrol TOTP → `/merchant` (`staff-invite.feature`, browser; `e2e/auth.spec.ts`).
- [x] A rider can't open `/merchant` or `/admin` (403) (`access.feature`; `e2e/auth.spec.ts`).
- [x] OTP sends are rate-limited: 5/hour/phone and 20/hour/network (`otp-rate-limit.feature`; unit + DB tests).
- [x] Session refresh works (expired access token rotated by the proxy) and logout revokes (old cookies → 401, old refresh token rejected) (`session.feature`).

Deliverables:
- [x] Phone OTP via the Supabase Send-SMS hook (`/api/hooks/send-sms`, Standard Webhooks signature) → `SemaphoreSmsSender` (`ISmsSender`), `DevSmsSender` without a key; Supabase test OTP numbers for dev/tests.
- [x] Staff email + password + mandatory TOTP (AAL2 for `/merchant`, `/admin` and staff APIs).
- [x] Invite-only staff onboarding (`/api/admin/invites`, `/auth/confirm` token-hash links, `/auth/set-password`, `/auth/mfa`).
- [x] `AuthorizationService` in core; layout guards per surface; `requireUser` / `requireAction` for APIs; roles re-read from the database.
- [x] Postgres-backed `IRateLimiter` (`private.hit_rate_limit`, pg_cron cleanup).
- [x] `pnpm bootstrap:admin` (idempotent; `bootstrap-admin.feature`).
- [x] Auth screens: phone entry, 6-box OTP with resend timer, staff sign-in, set password, MFA enrol (QR + manual key) and verify; en + fil.
- [x] CI green on the PR: [CI run 41984983782](https://github.com/Klik-Go/delivery-services/actions/runs/41984983782) on `36ee8c5` (lint, typecheck, unit, Supabase + build + Cucumber + Playwright) and CodeQL clean.
- [ ] Owner: hosted Supabase auth settings and Vercel env vars (OPEN_QUESTIONS Q12, Q13).

### Phase 3 — Merchant onboarding and menu manager (+ AI menu import) (branch `phase-3-merchant-menu`)
Acceptance (docs/BUILD_PLAN.md §6, Gherkin in `features/merchant/`):
- [ ] An approved merchant creates 20 items with modifiers in under 15 minutes: **manual UAT by the owner**. The item editor stays open after each save (same category, focus on the name) to make this fast.
- [x] Photos stay under 200 KB WebP: the browser resizes to ≤1280 px WebP and steps quality down to ≤200 KB; the upload link is only issued for `image/webp` ≤ 200 KB; the `menu-photos` bucket itself refuses anything else (`menu-management.feature` uploads to the signed link and checks that a 300 KB file is refused; `storage.db.test.ts`).
- [x] AI import never publishes without merchant review: reading a photo returns drafts only; items are saved only by the separate confirm call (`menu-import.feature`, `MenuImportService` unit tests, `e2e/merchant.spec.ts`).
- [x] Staff of merchant A can't edit merchant B: 403 from the API, unchanged rows (`menu-management.feature`, `MenuService` unit tests, `PrismaMenuRepository` DB tests, RLS write tests).

Deliverables:
- [x] Public `/partners` application form with a pin on the map (Leaflet + OpenStreetMap), honeypot and 5/hour/network limit → `merchant_applications`; out-of-zone applications are kept ("We're not in your area yet").
- [x] Admin review at `/admin/merchants`: approve (commission %, founding partner = 0% for 90 days with `founding_commission_until`) creates the store (active, closed), the owner's account, role and invite link in one transaction (audited); reject with a reason.
- [x] `/merchant` dashboard (open/close toggle), `/merchant/settings` (weekly hours with lunch/dinner windows, holiday closures, prep time, COD, radius ≤ zone maximum; owner-only edits).
- [x] `/merchant/menu`: categories (drag or arrow-button reorder), items in ₱ → centavos, modifier groups/options, photos (client-side WebP compression → signed upload URL), sold-out toggle.
- [x] `/merchant/menu/import`: `IMenuParser` → `GeminiMenuParser` (structured JSON, zod-validated; model from `GEMINI_MODEL`), `FakeMenuParser` for tests; editable drafts with confidence; confirm → bulk insert.
- [x] Public store page `/stores/:slug` (and `/api/stores/:slug`).
- [x] Core: `MerchantOnboardingService`, `StoreSettingsService`, `MenuService`, `MenuImportService`, `StorefrontService` with ports and in-memory fakes; Prisma repositories tested against the local database.
- [x] CI green on the PR: [CI run 41995509468](https://github.com/Klik-Go/delivery-services/actions/runs/41995509468) on `c3bf622` (lint, typecheck, unit, Supabase + build + Cucumber + Playwright) and CodeQL clean.
- [ ] Owner: `GEMINI_API_KEY` in Vercel, paid tier before real merchant data (OPEN_QUESTIONS Q16).

### Phase 4 — Customer discovery, store page, cart (PWA) (branch `phase-4-customer-cart`)
Acceptance (docs/BUILD_PLAN.md §6, Gherkin in `features/customer/`):
- [x] Lighthouse mobile Performance ≥ 85 on the store page: `pnpm lighthouse` (`scripts/lighthouse-budget.mjs`, default mobile profile, simulated slow 4G) takes the median of 3 runs: `/s/aling-nenas-karinderya` 93 (runs 85/93/94, LCP 1.0 s) and Home 99 locally; it runs in CI after Playwright and uploads the HTML reports.
- [x] PWA installable on the store page: `e2e/customer.spec.ts` asks Chrome itself (`Page.getInstallabilityErrors`) after the service worker registers; the only error allowed is `in-incognito`, which every Playwright context is. (Lighthouse 12 removed its PWA category.) This test caught that streamed metadata put the store page's manifest link in `<body>`; fixed with `htmlLimitedBots: /.*/` in `next.config.ts`.
- [x] Adding from a second store prompts a cart replace ("Start a new cart?" with Keep / Start new): `cart.feature`, `cart-store.test.ts`, `e2e/customer.spec.ts`.
- [x] The cart's server re-price matches the UI: the cart shows only numbers from `POST /api/cart/quote` (`PricingService`, Phase 4 fee strategies), and e2e checks subtotal ₱120, delivery ₱39, small-order ₱20, total ₱179 for 2 × Kapeng Barako to Ayala Avenue, the same numbers `cart.feature` gets from the API.
- [x] An out-of-zone address shows "We're not in your area yet — join the waitlist": `serviceability.feature`, `e2e/customer.spec.ts` (Kapitolyo, Pasig → waitlist row saved).

Deliverables:
- [x] Address onboarding `/address`: GPS, pin map (move the map under the pin), Google Places autocomplete through `/api/geo/autocomplete` + `/api/geo/place` (session tokens, server key, 10-minute cache, 60/min/IP) when `GOOGLE_MAPS_API_KEY` is set; signed-in customers save the address with a required landmark and contact number. Guests' pin lives in an httpOnly `kg_loc` cookie (`PUT /api/location`).
- [x] Out of zone → waitlist (`waitlist_signups`, admin-only RLS, 5/hour/network).
- [x] Home feed rails (Order again, Near you, Under ₱100, Fast, Free delivery), category chips, featured promos (`promos.is_featured`), cached per zone for 60 s.
- [x] Search with filters (category, open now, sort) over Postgres full-text + trigram (`pg_trgm`), grouped by store, with recent searches.
- [x] Store page `/s/[slug]` (old `/stores/[slug]` redirects): hero, info strip (ETA, delivery fee, COD), opening status in Manila time, sticky category tabs with scroll-spy, item bottom sheet with modifier rules, sticky "View cart" bar.
- [x] Single-store cart (Zustand, persisted on the device) priced only by the server: delivery fee strategies (distance bands, zone base + per km), small-order and service fees, sold-out / removed / choice issues.
- [x] PWA: manifest, icons, hand-written service worker (shell + feed, offline page), offline banner, skeletons; images through `next/image` WebP.
- [x] Map tile provider configurable (`NEXT_PUBLIC_MAP_TILE_URL`, https only, origin added to the CSP).
- [x] Tests: 3 new features (Cucumber 70/70), core unit tests for pricing/feed/search/serviceability/addresses/places, repository DB tests, Playwright customer flows on Pixel 7 + desktop with axe checks (50/50). Screenshots: `docs/screenshots/phase-4-*`.
- [x] CI green on the PR: [CI run 42032573863](https://github.com/Klik-Go/delivery-services/actions/runs/42032573863) on `c347cbd` (lint, typecheck, unit, Supabase + build + Cucumber 70/70 + Playwright 50/50 + Lighthouse: store page 98, Home 100) and CodeQL clean.

Next: Phase 5, checkout and payments, after this PR is reviewed and merged.

## Business validation (parallel, doc §8)
- [ ] 20–30 customer interviews in the pilot barangay
- [ ] 10–15 merchant surveys (commission tolerance, packaging, subscription interest)
- [ ] 2-week waitlist, target 50 or more sign-ups
- [ ] Real inputs for the unit economics model (rider pay per trip, delivery fee, COD share)

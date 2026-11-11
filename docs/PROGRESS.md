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
| 3.1 | Follow-up: launch zones (Makati, San Fernando, San Marcelino) + owner answers | ✅ Done (merged) | [Klik-Go/delivery-services#9](https://github.com/Klik-Go/delivery-services/pull/9) | Owner: `main` ruleset target (Q6), Gemini paid tier (Q16) |
| 4 | Customer discovery, store page, cart (PWA) | ✅ Done (merged) | [Klik-Go/delivery-services#10](https://github.com/Klik-Go/delivery-services/pull/10) | Owner: `GOOGLE_MAPS_API_KEY` for address search (optional, Q17) |
| 4.1 | Follow-up: deploy fixes (readiness, migration deploy) + placeholder sign-in code | ✅ Done (merged) | [Klik-Go/delivery-services#11](https://github.com/Klik-Go/delivery-services/pull/11), [#12](https://github.com/Klik-Go/delivery-services/pull/12), [#13](https://github.com/Klik-Go/delivery-services/pull/13) | 4.1.1 readiness fix, 4.1.2 bootstrap-admin workflow; owner confirmed sign-in works on production |
| 5 | Checkout and payments (PayMongo + COD) | ✅ Done (merged) | [Klik-Go/delivery-services#14](https://github.com/Klik-Go/delivery-services/pull/14) | Owner: PayMongo keys + webhook (Q22), BSP/legal check on holding payments (Q23) |
| 6 | Order lifecycle, merchant queue, SLA | ✅ Done (merged) | [Klik-Go/delivery-services#15](https://github.com/Klik-Go/delivery-services/pull/15) | Owner: Vault secrets + `CRON_SECRET`, VAPID keys, store phones (Q25); SLA penalty (Q26) |
| 6.1 | Follow-up: demo data for the hosted app | ✅ Done (merged) | [Klik-Go/delivery-services#16](https://github.com/Klik-Go/delivery-services/pull/16) | Owner: run **Load demo data** (Q28) |
| 6.2 | Follow-up: notifications never fail an order | ✅ Done (merged) | [Klik-Go/delivery-services#22](https://github.com/Klik-Go/delivery-services/pull/22) | Found when production checkout returned 500 (database not yet migrated) |
| 7 | Rider app, dispatch, live tracking | 🟡 In progress (PR open) | branch `phase-7-rider-dispatch` | Owner: rider sign-in needs SMS (Q30); rider pay rule (Q29); Vault secrets from Q25 now also drive dispatch |
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

### Phase 4.1 — Follow-up: deploy fixes and placeholder sign-in (branch `phase-4.1-launch-fixes`)
Owner report 2026-11-05: "Something went wrong" when saving a delivery address on the deployed site; and "for customers accept any PH number for the meantime and add a placeholder code to proceed".
- [x] `GET /api/health/ready`: database reachable and on this build's migrations (`LATEST_MIGRATION`, kept equal to the newest migration file by a unit test); 503 with the reason otherwise (`health.feature`, `e2e/health.spec.ts`, `ReadinessService` tests, `PrismaDatabaseProbe` DB test).
- [x] `.github/workflows/deploy-migrations.yml`: `supabase db push` to the hosted project on merge to `main` (dry run first; never the seed). Skips with a warning until the owner adds the secrets (OPEN_QUESTIONS Q13 step 7).
- [x] Placeholder sign-in code for customers while SMS is off (`PLACEHOLDER_OTP_CODE`; riders/staff refused; switches off when `SEMAPHORE_API_KEY` is set): `placeholder-otp.feature`, `PlaceholderPhoneSignIn` tests, Supabase adapter tests against local Auth (OPEN_QUESTIONS Q20).
- [x] Any Philippine mobile accepted (09xx and 08xx incl. DITO 0895–0898), with matching database checks (migration `20261110100000_ph_mobile_prefixes.sql`, `phone.db.test.ts`).
- [x] Owner: GitHub secrets + run "Deploy database migrations"; check `/api/health/ready`; set `PLACEHOLDER_OTP_CODE` in Vercel (owner confirmed 2026-11-06: "it worked").
- [x] Phase 4.1.1 fix (branch `phase-4.1.1-readiness-fix`): a database that has never been migrated now reads `outdated`, not `unreachable`. Production showed `42P01 relation "supabase_migrations.schema_migrations" does not exist`: the connection worked, but Postgres resolves every table name before running a query, so the single "if the table exists" query failed. Reproduced in `prisma-database-probe.db.test.ts` (table hidden in a rolled-back transaction).
- [x] Phase 4.1.2 (branch `phase-4.1.2-bootstrap-admin-workflow`): manual **Bootstrap first admin** workflow (`.github/workflows/bootstrap-admin.yml`) runs `pnpm bootstrap:admin` against the hosted project; validates inputs and secrets, masks the email, `production` environment gate. Owner: add `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` GitHub secrets, run it, open the link, delete the run logs (OPEN_QUESTIONS Q13 step 8).

### Phase 5 — Checkout and payments (PayMongo + COD) (branch `phase-5-checkout-payments`)
Acceptance (docs/BUILD_PLAN.md §6, Gherkin in `features/checkout/`):
- [x] Double-tapping "Place order" creates one order: the browser sends one `Idempotency-Key` per checkout attempt; `orders(customer_id, idempotency_key)` is unique and the request hash refuses a reused key for a different cart (`CONFLICT`). Proven by `checkout.feature` (two parallel requests → same order, one row), `order-service.test.ts`, `order-repositories.db.test.ts`, `checkout.db.test.ts` and `e2e/checkout.spec.ts` (real double-click on Pixel 7 and desktop → 1 order).
- [x] A replayed webhook doesn't double-credit: every event is stored once in `webhook_events` before it is applied, and capture is conditional on the payment still being unpaid (`payments-webhooks.feature` "A replayed confirmation changes nothing": one capture in the ledger, answer `duplicate`; `payments.test.ts`; repository DB test).
- [x] A failed or expired payment leaves the order `awaiting_payment`; `pg_cron` job `cancel-unpaid-orders` (every minute) cancels it after 15 minutes as the system (`reason: payment_timeout`), marks the payment failed and releases the promo (`checkout.db.test.ts`, `payments-webhooks.feature`). A payment that arrives after that is refunded in full automatically (Cucumber + unit + DB tests). PayMongo's `payment.failed` is acknowledged and ignored on purpose (OPEN_QUESTIONS Q21).
- [ ] An e2e test in PayMongo test mode passes (ready, waiting for a test key): `packages/adapters/src/payments/paymongo.external.test.ts` and the **PayMongo test mode** workflow call PayMongo's real API with a test key (hosted GCash checkout for the exact total, page loads, status pending, refund refusal). It needs the `PAYMONGO_TEST_SECRET_KEY` secret (Q22) and has not run yet. The full browser flow runs on every PR against the local test checkout (`/dev/pay`), which sends PayMongo-format signed webhooks through the real verifier.
- [x] The ledger balances for every order: `LedgerService` refuses unbalanced transactions, a deferred DB trigger checks every `txn_id`, and `ledger.feature` / `payments-webhooks.feature` check each order's transactions sum to zero after capture, partial refund and late-payment refund.

Deliverables:
- [x] Single-screen checkout `/checkout`: address (label, landmark, contact number, notes; saved default prefilled), ASAP or a slot later today (30-minute slots in the store's Manila hours), payment method (only what the store and the configured gateways take), promo code, tip chips (₱10/20/50), server totals, sticky "Place order · ₱X". Order page `/orders/[id]` (status, payment, "Pay" again while unpaid; refreshes every 4 s until Phase 6 Realtime). Cart "Checkout" button enabled.
- [x] `OrderService.placeOrder` / `quoteCheckout` / `view` (re-price on the server, promo + tip, store open or valid slot, COD only where accepted, idempotent, payment started after the order row exists; a gateway outage answers `UNAVAILABLE` and the same key resumes).
- [x] `IPaymentGateway` with `PayMongoGateway` (hosted Checkout Sessions: GCash, Maya, card, QR Ph; refunds) and `CashOnDeliveryGateway`, chosen through `PaymentGatewayRegistry` (no switch on method names); `FakePaymentGateway` for tests and local dev.
- [x] Signed, idempotent webhook `POST /api/webhooks/paymongo`: HMAC-SHA256 over `t.rawBody` compared in constant time (`te` test / `li` live), 5-minute replay window, livemode must match, 401 on a bad signature, 503 while the secret is missing so PayMongo retries.
- [x] Ledger entries: capture = Dr gateway clearing (net) + Dr gateway fees, Cr customer deposits; refunds reverse from deposits. Settlement to merchant/rider/platform at delivery is Phase 7/10.
- [x] Refunds: `POST /api/admin/orders/[id]/refunds` (admin, or the zone's coordinator, with TOTP), full or partial, reserved before calling PayMongo so two clicks can never refund more than was paid; cash refunds are by hand. `refunds` table with RLS.
- [x] Migration `20261111100000_checkout_payments.sql` (order codes, idempotency, payment fields, refunds, `customer_deposits`, timeout job) with DB tests; Prisma schema + ERD regenerated.
- [x] Tests: Cucumber 94/94 (20 new), unit 378 (ordering services 94–100% lines), DB 150, Playwright 60/60 on Pixel 7 + desktop (8 new checkout runs with axe), Lighthouse store page 97 / Home 100. Screenshots: `docs/screenshots/phase-5-*`.
- [ ] Owner: PayMongo account, keys and webhook (Q22); legal/BSP check (Q23).

Merged in [Klik-Go/delivery-services#14](https://github.com/Klik-Go/delivery-services/pull/14). Owner 2026-11-06: PayMongo comes later; testing starts with cash on delivery.

### Phase 6 — Merchant order queue, lifecycle, notifications, SLA timers (branch `phase-6-order-lifecycle`)
Acceptance (docs/BUILD_PLAN.md §6, Gherkin in `features/orders/`):
- [x] Illegal transitions are rejected (unit tests for every pair): `order-state-machine.test.ts` checks all 100 status pairs × 8 actors against a hand-written rulebook (conflict when the change does not exist, forbidden for the wrong actor); the database guard repeats the check.
- [x] The merchant sees a new order in under 2 s locally: `e2e/order-board.spec.ts` opens the store's board (Realtime private channel `merchant:<id>`, "Live"), places a cash order in a second browser context and requires the card within 2,000 ms, on Pixel 7 and desktop.
- [x] An unacknowledged order is auto-cancelled at 180 s and the refund triggered: `pg_cron` `merchant-sla` (every 30 s) texts at 60 s, alerts the coordinator at 120 s and cancels at 180 s (`order-lifecycle.db.test.ts`, `merchant-sla.feature`); the paid case is refunded in full by the background job and the ledger balances.
- [x] The customer's tracking stepper updates live: the same e2e test accepts and marks ready on the store's board while the customer's order page (channel `order:<id>`) changes to "Being prepared" and "Ready for pickup" within 3 s without a reload.

Deliverables:
- [x] `OrderLifecycleService`: accept with prep time (accepted → preparing in one transaction), reject with reason, mark ready, cancel (customer until the store accepts; coordinator/admin later); conditional on the status read (`FOR UPDATE`), actor recorded on `order_events`, promo released, paid orders refunded.
- [x] Merchant board `/merchant/orders`: New / Preparing / Ready / Picked up, 3-minute countdown, prep chips 10/15/20/30, reject reasons, quick "sold out", Web Audio alarm until acknowledged (one tap to allow sound), live badge, polling fallback. Dashboard link.
- [x] Realtime: DB trigger → `realtime.send` on private topics; `realtime.messages` SELECT policy `private.can_follow_topic` (customer, store staff with TOTP, zone coordinator, admin; no INSERT); `/api/realtime/token` for the browser; clients refetch through the BFF.
- [x] Notifications: `NotificationService` + policy table; `WebPushSender` (VAPID, `web-push` 3.6.7), `SmsNotificationSender` (Semaphore/dev), `InAppNotificationSender`; push opt-in on the board; service worker `push`/`notificationclick`.
- [x] SLA escalation in SQL with thresholds in the `merchant_sla` feature flag; background jobs `POST /api/internal/jobs` (`CRON_SECRET`) called by `pg_cron` + `pg_net` with Vault secrets.
- [x] Customer order page: live stepper with times, ready-by estimate, rejection/cancellation reason, Cancel button while allowed.
- [x] Migration `20261112100000_order_lifecycle.sql` with DB tests; Prisma schema + ERD regenerated.
- [x] Tests: Cucumber 107/107 (13 new), unit 515, DB 168 (137 + 31 repository), Playwright 66/66 (6 new board runs on Pixel 7 + desktop with axe), Lighthouse store page 98 / Home 100. Screenshots: `docs/screenshots/phase-6-*`.
- [ ] Owner: Vault secrets + `CRON_SECRET`, VAPID keys, store phone numbers (Q25); penalty rule (Q26).

Merged in [Klik-Go/delivery-services#15](https://github.com/Klik-Go/delivery-services/pull/15).

### Phase 6.1 — Follow-up: demo data (branch `phase-6.1-demo-data`)
Owner request 2026-11-06: "Fill out all the data needed for a test demo."
- [x] `pnpm demo:data` (`scripts/demo-data.ts`, data in `scripts/demo/demo-data.ts`): 9 open stores with full menus in the three launch zones, fee bands for zones without any, promo codes DEMOKAIN / DEMOHATID / DEMO10, one owner account for all demo stores with a one-time set-password link; idempotent; `DEMO_ACTION=hide` suspends them.
- [x] Manual workflow **Load demo data** (`.github/workflows/demo-data.yml`, `production` gate, masked inputs).
- [x] `features/demo-data.feature`: every zone's demo stores open with full menus and cash on delivery, a San Fernando customer can price an order, reloading duplicates nothing, hiding returns 404 (Cucumber 109/109).
- [x] Demo walkthrough in OPEN_QUESTIONS Q28.
- [ ] Owner: run **Load demo data** with `action: load`.

### Phase 7 — Rider app, dispatch and live tracking (branch `phase-7-rider-dispatch`)
Acceptance (docs/BUILD_PLAN.md §6, Gherkin in `features/dispatch/`):
- [x] With 3 seeded riders the offer goes to the nearest online rider under their cash limit: `dispatch.feature` (Rosa nearest, Rico next, Rey pending approval never offered; Rosa skipped when the order's cash would take her over her limit; offline riders skipped). Unit tests in `dispatch-service.test.ts`.
- [x] A declined or expired offer cascades within 30 s: a decline re-dispatches at once; an offer past its 30 seconds expires on the next background run (every 10 seconds) and goes to the next rider (`dispatch.feature`, `dispatch-repositories.db.test.ts`). When nobody is left (or after 5 offers) the zone coordinator is alerted once and dispatch keeps trying.
- [x] The customer's map shows the rider moving, throttled: `e2e/rider-tracking.spec.ts` moves the rider's mocked GPS and the customer's map follows (positions every 7 s when moving, server keeps one per 4 s, the map refetches at most every 5 s), on Pixel 7 and desktop.
- [x] Location stops when offline or after delivery: the app stops watching GPS when offline and the server refuses positions from offline riders (409, `rider-flow.feature`, e2e); the customer's tracking hides the rider once delivered.
- [x] A delivery PIN is required above a configurable amount: the `dispatch` flag's `pin_threshold_centavos` (₱500.00); the PIN is issued by the database, shown only to the customer, checked by the server with 5 tries per 10 minutes (`rider-flow.feature`, `rider-dispatch.db.test.ts`).

Deliverables:
- [x] Core: `DispatchService` (offer, answer, tick), `IDispatchStrategy` → `NearestAvailableStrategy`, `IRiderPayRule` → `DistancePayRule` (₱35 + ₱10/km after 2 km, shown on the offer), `RiderService` (online switch, location, offers, arrived / picked up / delivered, settlement in the ledger, earnings), `TrackingService` (rider visible only while assigned, ETA), in-memory fakes; dispatch starts when the store accepts (or `lead_minutes` before ready, configurable).
- [x] Adapters: `PrismaDispatchRepository` (PostGIS `nearest_available_riders`, conditional offers and answers, rider transitions as the actor), `SupabaseDeliveryProofStorage` (private `delivery-proofs` bucket).
- [x] BFF: `/api/rider/{me,status,location,offers/current,offers/:id/accept|decline,job,jobs/:id/arrived|picked-up|delivered,earnings}`, `/api/orders/:id/tracking`; zod schemas in `packages/types/src/rider.ts`.
- [x] Rider PWA `/rider`: online switch, Screen Wake Lock, GPS every 7 s while moving (heartbeat every minute), offer card with countdown, pay and cash to collect, slide-to-confirm steps, Waze / Google Maps links, masked contact (call relay stub), PIN or photo proof, earnings and cash on hand; live over `rider:<id>`.
- [x] Customer order page: live map (Leaflet) with the rider and arrival estimate, delivery PIN for big orders.
- [x] Migration `20261113100000_rider_dispatch.sql` with DB tests; Prisma schema + ERD regenerated; `pg_cron` app jobs every 10 s.
- [x] Docs: ARCHITECTURE §4h (incl. PWA background-GPS limits and when to build an Expo rider app), OPEN_QUESTIONS Q29–Q31.
- [ ] Owner: rider sign-in on production needs SMS (Q30); confirm the rider pay rule (Q29).

Next: Phase 8, coordinator and admin console (after review).

## Business validation (parallel, doc §8)
- [ ] 20–30 customer interviews in the pilot barangay
- [ ] 10–15 merchant surveys (commission tolerance, packaging, subscription interest)
- [ ] 2-week waitlist, target 50 or more sign-ups
- [ ] Real inputs for the unit economics model (rider pay per trip, delivery fee, COD share)

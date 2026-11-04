# Klik Go — Build Plan for Claude Agents (Klik-Go/delivery-services)

Source document: `docs/BUSINESS.md` (Klik Go Business Documentation v1.0, July 2026, "Hybrid Aggregator + Managed Logistics Model").
Prepared: 5 Nov 2026 (Asia/Manila).

> This file lives at `docs/BUILD_PLAN.md`; the business doc is `docs/BUSINESS.md`. Every prompt below tells the agent to read both. Ready-to-paste kickoff and continuation prompts are in `docs/CLAUDE_PROMPTS.md`. The doc links to `overview.md` and `technical-overview.md`; if those exist, add them as `docs/overview.md` and `docs/technical-overview.md` too.
>
> Repo: `Klik-Go/delivery-services` (https://github.com/Klik-Go/delivery-services), default branch `main`. Work only in this repository; never touch the `senate-ph` org.

---

## 1. Summary

Klik Go is a PH delivery platform for barangays and provincial towns that GrabFood/foodpanda underserve. It starts with food delivery in one pilot zone, then adds groceries, parcels, pharmacy and B2B. The doc is strong on the business side (zones, the order lifecycle, compliance, KPIs). Its weak spots are the tech setup, which is too heavy for a solo founder on free tiers, and the money math, which doesn't add up.

Top recommendations:
1. **Fix the unit economics before building.** The cost plan leaves out rider pay per trip, counts the whole delivery fee as revenue, and pairs 0% founding commission and free delivery with break-even in 2–4 weeks. Model the contribution per order first (calculator on the Page).
2. **Collapse the stack for the MVP.** Next.js is the BFF and the only public entry point. Domain logic goes in a framework-free `packages/core` (keeping the doc's SOLID ports and adapters). Supabase handles Postgres+PostGIS, Auth, Realtime, Storage and pg_cron. Don't run a separate NestJS host until you need one: Render's free tier sleeps and Railway has no free tier.
3. **Don't build auth yourself.** Use Supabase Auth: phone OTP for customers and riders, with a Send-SMS hook that sends through Semaphore. Staff (merchant, coordinator, admin) get email, password and TOTP MFA, plus invite-only RBAC, the same pattern as your current projects.
4. **Ship the customer app as a mobile-first PWA**, plus web dashboards for merchants and coordinators. The rider app starts as a PWA in the pilot. Move to Expo when you need background GPS at scale.
5. **Make the pilot dense and narrow:** one zone, food only, lunch and dinner hours, GCash plus COD/QR Ph, a flat zone fee, and coordinator-assisted dispatch. Consider a "Pabili" (buy-for-me) mode so a zone can launch before many merchants are signed.
6. **Free tiers are for building, not for commercial launch.** Vercel Hobby is for non-commercial use only, and the Supabase free tier pauses inactive projects and has no backups. Budget for Vercel Pro and Supabase Pro before you take real orders.

---

## 2. Setup review (your concerns, item by item)

| Area | What the doc says | Concern | Recommendation |
|---|---|---|---|
| Backend | NestJS on Railway/Render, Next.js on Vercel | Two hosts to run. Render free sleeps (cold starts kill live order flows). Railway has no free tier. Needs a public API next to the web app, which breaks your BFF rule | MVP: `apps/web` (Next.js) is the only public entry. Route handlers call services in `packages/core` through a small composition root (keeps SOLID/DI, drops Nest). Later, move core into `apps/api` (NestJS) on a private network when volume or a team justifies it. The service code moves unchanged |
| Auth | NestJS owns phone OTP, JWT, bcrypt | Custom auth is the riskiest code you could write: OTP brute force, token rotation, session revocation | Supabase Auth phone OTP with the Send SMS hook to Semaphore. Staff: email, password and TOTP (AAL2 required). RBAC in `user_roles` with merchant/zone scope. Never trust a role claim from the client |
| Mobile | Expo customer and rider apps from day 1 | 2 native apps + store reviews + EAS builds for a solo dev. Store fees | Customer = PWA (installable, links shareable in FB/Viber groups, no store review). Rider = PWA in the pilot (Wake Lock, foreground GPS). Expo rider app when you have more than about 5 riders or the GPS gaps hurt. Android first (assumption: most PH riders use Android) |
| Realtime | Clients subscribe with the anon key | Under BFF, an anon-key subscription can leak other people's orders if RLS or channel auth is wrong | Supabase Realtime private channels with Realtime Authorization (RLS on `realtime.messages`). The user's JWT, channel per order `order:{id}`. Writes only via BFF. Throttle rider GPS to about 5–10 s and only during an active job |
| Jobs and timers | 3-min merchant SLA, weekly payouts, offer timeouts | Vercel Hobby cron runs once a day at most, and Redis is deferred | Supabase `pg_cron` for SQL-only timers (auto-cancel, offer expiry, stale-rider cleanup). `pg_net` or a signed internal endpoint for jobs that call gateways |
| Geo | `polygon_json`, nearest rider | JSON polygons can't be indexed, and "nearest" in app code is slow and buggy | PostGIS `geography` columns: `ST_Contains` for zone lookup, `ST_DWithin` + KNN `<->` for nearest rider. GiST indexes |
| Maps | Google Places/Directions/Distance Matrix; "free tier covers ~28,500 map loads" | That figure comes from Google's old $200 credit. Google changed Maps pricing in 2025 to free usage per SKU, and Distance Matrix is now legacy (Routes API replaces it). Map loads on every tracking screen add up | Places Autocomplete (with session tokens) for address search only. Render maps with MapLibre GL + a free tile provider. Fee = zone base + haversine × road factor (no API call). Routes API only at dispatch. Set quotas and budget alerts in GCP. Check the current pricing page |
| Addresses | `address_json` on users | PH addresses depend on landmarks, and a typed address alone fails | A pin drop is required. Add a landmark field, rider notes, contact number and barangay. Snapshot the address on each order |
| Data model | `items_json`, single `role`, `total`/`fee` | Can't report on items. One role per user breaks the "merchant owner who also orders" case. Float money | Use `order_items` snapshot rows, integer centavos everywhere, `user_roles` many-to-many, `order_events` audit trail, `dispatch_offers`, a double-entry `ledger_entries` table, and `webhook_events` for idempotency |
| Payments | PayMongo (GCash/Maya/cards) or Xendit; weekly GCash payouts | Webhooks must be verified and idempotent. Holding and paying out merchants' money may trigger BSP rules (payment aggregator / OPS registration). COD means riders carry cash | PayMongo Payment Intents + signed webhooks. Add COD and QR Ph pay-on-delivery. Rider cash-on-hand limit and a daily remittance check. Pilot payouts are a manual batch with a generated CSV. Ask a lawyer/CPA about the BSP setup and BIR withholding for e-marketplaces (RR 16-2023) and the Internet Transactions Act (RA 11967) |
| Notifications | FCM, Semaphore SMS | Web push on iOS only works for an installed PWA (16.4+). A merchant missing an order = cancelled order | Web Push (VAPID) for the PWA. A loud repeating in-app alert on the merchant dashboard. SMS fallback to the merchant after 60 s unacknowledged. Count SMS costs (Semaphore has no free tier) |
| Privacy | NPC registration "at scale" | Rider KYC (government IDs and selfies) is sensitive personal information from day 1 | Private Storage bucket, signed URLs (short expiry), admin-only access logged in `audit_logs`, a retention policy, and a privacy notice at signup. Check NPC registration thresholds with your lawyer |
| AI (your portfolio angle) | not in doc | — | Gemini (free tier) for **menu import from a photo**: merchant snaps a menu and gets draft items to review. Later: review summaries and support triage. Never send customer personal data on the free tier, because free-tier data may be used to improve Google's products |

### Free tiers: what works for building and what breaks at launch
| Service | OK for | Breaks when | Upgrade |
|---|---|---|---|
| Vercel Hobby | Building, previews, demo | **Taking real commercial orders** (Hobby is for non-commercial use), plus function limits | Pro (per-member monthly) before the pilot |
| Supabase Free | Dev and staging | Pauses after about 1 week inactive, 500 MB DB, no backups, Realtime connection caps | Pro before the pilot (daily backups, no pausing) |
| Google Maps | Low-volume autocomplete | Tracking map loads and route matrices at volume | Quotas, MapLibre tiles, cache geocodes |
| Semaphore SMS | — (paid per SMS) | Every OTP costs money | Use Supabase test OTP numbers in dev. Rate-limit OTP sends |
| PayMongo | Test mode is free | Fees per transaction (doc: about 2.5%) | n/a |
| Expo EAS | Free build quota | Frequent native builds | Only when native apps start |
| Sentry / PostHog | Free tiers fine for the pilot | High event volume | Sample events |
| Gemini free | Menu import prototype | Rate limits, data-use terms | Paid tier for production merchant data |

Limits change, so confirm each one on the provider's pricing page before launch.

---

## 3. UI/UX direction (Uber Eats / GrabFood / foodpanda patterns, adapted for PH)

Principles: mobile-first (design at 360 px), thumb-reachable actions, one primary action per screen, a clear price before tapping "Place order", fast on budget Android phones over 3G/4G, and Taglish-friendly copy. Brand per doc: bold blue/teal, clean sans, map-pin motif, a friendly local tone.

**Navigation:** bottom tab bar with Home · Search · Orders · Account. A persistent "Deliver to" address chip at the top. Bottom sheets (not new pages) for item options, address picker and filters.

**Home feed**
- Top: "Deliver to: [landmark/barangay] ▾", then the search bar.
- A row of category chips: Meals, Merienda, Milk tea, Grocery (coming soon), Pharmacy (coming soon), Pabili.
- A promo carousel (max 3 slides; the doc's paid banner slots go here later).
- Horizontal store rails: "Near you", "Under ₱100 meals", "Fast (≤25 min)", "Free delivery", "Order again".
- Store card: cover photo (16:9, lazy, about 40 KB WebP), name, ★ rating (count), ETA range "20–30 min", fee "₱39 delivery", badges (COD OK, Promo). Closed stores are greyed and show "Opens 10:00 AM · Pre-order".
- Skeleton loaders. An offline banner with the cached feed.

**Search**
- Instant results as you type, grouped by Stores and Dishes. Recent searches and popular-near-you chips.
- Filters sheet: Sort (Recommended, Nearest, Rating, Fee), Price ₱–₱₱₱, Open now, Free delivery, Accepts COD.

**Store page**
- Hero image, name, rating, ETA, fee, minimum order, a "Pick-up time ~15 min" line, and the store's hours.
- Sticky category tabs with scroll-spy. A "Popular" section first.
- Item row: name, 2-line description, price, thumbnail on the right, "+" button. Sold-out items are greyed and show "Sold out today".
- Item bottom sheet: photo, required modifier groups (radio, labeled "Required"), optional add-ons (checkbox with +₱ price), quantity stepper, note to store, sticky "Add · ₱245".
- Sticky bottom bar after adding: "View cart · 3 items · ₱450".

**Cart**
- One store per cart. Adding from another store shows "Start a new cart?". Item edits, a "You might also like" upsell (max 3).
- A clear fee breakdown: subtotal, delivery fee (explain "based on distance"), small-order fee if below minimum, promo, tip, total.

**Checkout (single screen)**
- Address card with a map pin snapshot ("Is this pin right?" lets the customer drag to adjust), landmark, notes for rider, contact number.
- Delivery time: ASAP or Schedule (today's slots).
- Payment: GCash, Maya, Card, QR Ph, Cash on delivery (shows "Prepare exact change" with the amount).
- Promo code, optional rider tip (₱10/₱20/₱50/custom). Total is restated on the button: "Place order · ₱512".
- After placing: a full-screen confirmation that moves into tracking.

**Live order tracking**
- Status stepper: Order placed → Store confirmed → Preparing → Rider picking up → On the way → Delivered, with timestamps.
- Map (MapLibre) with merchant, customer pin and the rider marker moving smoothly. An ETA range that updates.
- Rider card: first name, photo, plate number, rating, and a call button (masked or in-app later). Delivery PIN for high-value orders (doc §9.2.3).
- Push/SMS at key changes. On cancellation, a clear reason plus the refund status.

**After delivery:** a rating sheet with separate store and rider ratings (stars + quick tags like "Hot food", "Polite"), an optional tip, and a receipt. "Reorder" in Orders.

**Account:** saved addresses, payment methods (tokenised by the gateway, never stored by you), referral code, loyalty stamps (10th order free delivery per doc), language (English/Tagalog), notifications, delete account (DPA right).

**Merchant dashboard (web, phone- or tablet-first):** an order board with columns New · Preparing · Ready · Picked up. New orders trigger a loud repeating sound and a big Accept/Reject with prep-time chips (10/15/20/30 min), a 3-minute countdown visible, and a "mark sold out" toggle per item. Also menu manager (drag to reorder, photo upload, AI import from photo), store open/closed toggle and hours, sales today/week, payouts and CSV.

**Rider app:** a large Online/Offline toggle. A job offer card with pickup, drop-off, distance, **earnings shown up front** and a 30 s countdown to accept. Then swipe-to-confirm steps (Arrived at store → Picked up → Arrived → Delivered with PIN/photo), Waze/Google Maps deep links, a cash-to-collect banner for COD, today's earnings and the weekly payout preview.

**Coordinator/Admin console (desktop):** a live map of riders and active orders, an order board with SLA timers turning amber/red, manual assign/reassign, refunds and cancellations, a zone polygon editor, KYC and merchant approval queues, fee tables, feature flags and the finance ledger.

**Design system:** Tailwind + shadcn/ui, tokens in `packages/config`, Lucide icons, `vaul` bottom sheets, 44 px minimum tap targets, WCAG AA contrast, `prefers-reduced-motion`, and ₱ formatting through one `formatPeso()` helper.

---

## 4. Business improvements (based on the doc; assumptions labeled)

**A. The doc's numbers are internally inconsistent. Fix these first.**
1. **Rider pay is missing from costs.** §6.2 lists only "Rider incentive bonuses", but §5.3 pays riders a base per-trip rate + distance + surge. If riders get most of the delivery fee, the "Delivery fee revenue" line in §6.3 is mostly pass-through, not platform revenue.
2. **Launch promos make early revenue close to zero.** Founding merchants pay 0% commission for 3 months (§4.2) and customers get free delivery on their first 3 orders. That conflicts with "break-even within the first 2–4 weeks" (§6.4).
3. **The break-even math doesn't add up.** Month-1 OPEX of ₱12,000 is about ₱400/day. At the doc's own ₱250 AOV × 20% = ₱50 commission per order, break-even would be about 8 orders/day on commission alone, not 24–48. Recompute it from contribution per order after rider pay, gateway fees and promos.
4. **Take-rate target vs positioning.** The KPI target is a 25–30% take rate (§13.1), but the pitch is "lower commission than GrabFood (30%)". Define take rate precisely (commission + platform-kept fees) ÷ GMV, and keep the merchant commission visibly below competitors.
5. **The volume ramp is aggressive.** 400–600 orders/day in Month 12 for one zone (§6.3) is far above the §11 KPI table (15,000 orders/month across 3 cities). The doc's own MVP note says to recast these downward. Use the §11 figures as the plan and §6.3 as the stretch goal.

**B. Unit economics model (use the calculator on the Page)**
Contribution per order = commission + service/small-order fees + (delivery fee − rider pay) − gateway fee on online orders − promo cost − SMS/maps cost.
Decision rule: only grow marketing spend when contribution per order is positive in the pilot zone for 4 straight weeks.

**C. Differentiation for the PH market**
- **Pabili mode (buy-for-me):** customers ask a rider to buy from any store, palengke or sari-sari store, and pay item cost + fee on delivery. This solves the cold start in barangays where few merchants are onboarded, matches existing FB/Viber "pabili" behavior the doc competes with, and earns fee revenue with no merchant contract. Add caps (max item value, COD float limit).
- **Barangay trust:** riders who are known locally (doc's community feel). Show the rider's barangay and trip count. Coordinator hotline.
- **Cash-friendly but digital:** COD plus QR Ph on delivery, so riders carry less cash.
- **Scheduled office/school lunch batches** (doc's B2B outreach). One rider, many drop-offs, a pre-order cutoff. Better rider utilisation.
- **Fast merchant onboarding with AI menu import** (Gemini). A karinderia is live in 10 minutes. Also a strong AI-Engineer portfolio feature.
- **Transparent fees:** show the commission % to merchants and the fee breakdown to customers. Supports the "trusted" vision.

**D. Monetisation adjustments**
- Keep 0% founding commission, but add a small **customer service fee** or **small-order fee** so each order still contributes.
- Offer small karinderias a **flat subscription option** (doc §2.2 range ₱500–₱3,000/month) instead of commission. Predictable for them, recurring for you.
- Defer surge, ads and subscriptions-with-analytics until there are more than 30 active merchants. They need volume to matter.
- Cap promos: free delivery up to a ₱ amount, referral credit only after the referred user's first completed paid order, one per device/phone.

**E. Operations and risk**
- **Density first:** pilot hours = lunch + dinner peaks only, so 2–3 riders are actually busy (doc's rider utilisation KPI is above 60%).
- **Merchant SLA:** instead of auto-cancel with a penalty at 3 min, escalate: alert at 0 s, SMS at 60 s, coordinator call at 120 s, auto-cancel + refund at 180 s. Offer "auto-accept" for reliable merchants.
- **Rider classification:** the doc treats riders as independent contractors. Watch DOLE guidance on platform workers. Per-trip micro-insurance (doc §7.3) from day 1 is cheap trust.
- **Fraud:** COD no-shows (limit COD for new accounts and require a verified phone), promo abuse, fake referrals.
- **Founder burnout (doc: High/High):** the coordinator console and runbooks are what let you hand off ops by Month 4.

**F. MVP scope (pilot zone)**
In: food + Pabili (optional) · one zone · customer PWA · merchant web · rider PWA · coordinator/admin console · phone OTP · GCash/Maya/card via PayMongo + COD · flat zone fee + distance bands · assisted auto-dispatch · live tracking · ratings · reorder · referral code · basic promo codes · manual weekly payouts from a ledger.
Out (later): native store apps, grocery/parcel/pharmacy catalogs, surge, ads, merchant subscriptions, loyalty beyond stamps, B2B contracts portal, ML ETA, multi-zone franchise tools.

**G. KPIs to add** to doc §13: contribution margin per order, rider earnings per online hour (mission: "dignified livelihoods"), merchant acceptance rate and time, % orders with pin corrections, COD share, refund rate.

---

## 5. Architecture at a glance

```
Browser PWA / Rider PWA / (later Expo)        PayMongo webhooks
            │  HTTPS only                          │
            ▼                                      ▼
   apps/web  (Next.js on Vercel)  — the ONLY public entry
   ├─ app/(customer) /            ├─ app/merchant/*   ├─ app/rider/*   ├─ app/admin/*
   ├─ app/api/*  (BFF route handlers: authN, RBAC, zod validation, rate limit)
   └─ src/server/container.ts  → packages/core services (ports)
                                       │
                packages/adapters: PrismaRepos, PayMongoGateway, SemaphoreSms,
                GoogleGeocoder, WebPushNotifier, GeminiMenuParser, SupabaseStorage
                                       │
             Supabase: Postgres+PostGIS (RLS on), Auth, Realtime (private channels),
                       Storage (private KYC bucket), pg_cron jobs
```
Rules: browsers never get the service-role key. Realtime is read-only for clients, via RLS-authorised private channels. All writes go through `/api/*`. Money is integer centavos. Every order status change goes through `OrderStateMachine` and writes an `order_events` row.

Order status machine (MVP):
`awaiting_payment → placed → accepted → preparing → ready → picked_up → delivered`; side exits: `rejected`, `cancelled` (with reason + actor), `failed_delivery`. Dispatch state is separate: `unassigned → offered → assigned → at_store → (picked_up)`.

Roles: `customer`, `rider`, `merchant_owner`, `merchant_staff`, `coordinator` (zone-scoped), `admin`. Customers and riders: phone OTP. Merchant/coordinator/admin: email + password + TOTP (AAL2 enforced), invite-only. The first admin is created by a bootstrap script from the `ADMIN_EMAIL` env var (never hardcode it).

---

## 6. Build plan (phases with copyable prompts)

Rough timing (an estimate, solo dev with agents): Phases 0–2 weeks 1–3, 3–5 weeks 4–7, 6–8 weeks 8–11, 9–11 weeks 12–14, 12 = pilot. This matches the doc's 14-week §10.6 shape.

### Shared header: paste at the top of EVERY phase prompt
```
You are working in the GitHub repo Klik-Go/delivery-services (https://github.com/Klik-Go/delivery-services). Only read and write in Klik-Go/delivery-services; never touch any other repository or org, and never touch senate-ph.
Before coding, read: docs/BUSINESS.md (Klik Go business doc — source of truth for business rules), docs/BUILD_PLAN.md (this plan), docs/ARCHITECTURE.md and CLAUDE.md.
Non-negotiables:
- BFF: apps/web (Next.js App Router) is the only public entry point. Browsers/mobile call only /api/* route handlers. Supabase service-role key, PayMongo secret, SMS and Gemini keys are server-only env vars. Never commit secrets; add names to .env.example only.
- Domain logic lives in packages/core (pure TypeScript, SOLID, ports/interfaces, Result types); adapters in packages/adapters; wiring in apps/web/src/server/container.ts. Route handler → Service → Repository/Adapter. No business logic in components or route handlers.
- Money = integer centavos. Times stored UTC, shown Asia/Manila. Zod-validate every input.
- Every order status change goes through OrderStateMachine and writes order_events.
- Update docs/PROGRESS.md in the same PR (tick finished items, add evidence links).
- TDD/BDD: first write a Cucumber.js .feature (Gherkin, business language from docs/BUSINESS.md) + failing step definitions and Vitest unit tests, then implement until green. Add Playwright e2e for UI flows (mobile viewport Pixel 7 + desktop).
- RLS enabled on every table; add a SQL test proving a user can't read another user's rows.
- Next.js middleware must use runtime "nodejs" (not Edge).
- Work on a feature branch, open a PR with: summary, screenshots for UI, test evidence, migration notes. CI must be green. Do not merge.
- Finish by listing what you built, how to test it locally, env vars needed, and open questions.
```

---

### Phase 0: Foundations (repo, rules, CI)
**Goal:** a monorepo that builds, tests and deploys an empty shell with all the guardrails.
**Deliverables:** pnpm + Turborepo; `apps/web`, `packages/{core,adapters,db,types,config,ui}`; `supabase/` (CLI); `CLAUDE.md`; `docs/ARCHITECTURE.md`; Vitest, Cucumber.js, Playwright; GitHub Actions; Vercel project linked; `.env.example`.
**Acceptance:** `pnpm i && pnpm dev` runs; the `features/health.feature` scenario passes in Cucumber and Playwright; CI is green on the PR (lint, typecheck, unit, supabase start + migrate, cucumber, playwright, build); the Vercel preview deploys; security headers present (CSP, HSTS, X-Frame-Options, Referrer-Policy).

Prompt:
```
[Shared header]
Phase 0 — Foundations.
1. Create a pnpm workspace + Turborepo: apps/web (Next.js 15 App Router, TS strict, Tailwind, shadcn/ui, next-intl ready for en + fil), packages/core (no framework imports), packages/adapters, packages/db (Prisma client for Supabase Postgres, using pooled DATABASE_URL + DIRECT_URL), packages/types (shared zod schemas), packages/config (eslint, prettier, tsconfig base, tailwind tokens: brand teal/blue per docs/BUSINESS.md §4.1), packages/ui (shared components).
2. supabase/: init Supabase CLI config with PostGIS + pg_cron enabled in the first migration.
3. CLAUDE.md: convert docs/BUSINESS.md §10.3–10.4 (SOLID, layer order, TypeScript, error handling, naming, comments, testing coverage targets) into agent rules, replacing NestJS DI with a composition root at apps/web/src/server/container.ts. Include the non-negotiables from the shared header.
4. docs/ARCHITECTURE.md: BFF diagram, roles, order state machine, folder map (copy section 5 of docs/BUILD_PLAN.md and expand).
5. Testing: Vitest (unit), Cucumber.js with TS step defs in features/ (world object with API client + db helpers), Playwright (projects: mobile Pixel 7, desktop Chrome). Write features/health.feature: "Given the platform is running When I open the home page Then I see the Klik Go brand" and GET /api/health returns {data:{status:"ok"}}.
6. Security: next.config headers (strict CSP with nonces, HSTS, frame-ancestors none), middleware runtime "nodejs", a request-id + structured JSON logger (pino) helper.
7. GitHub Actions ci.yml: pnpm cache, lint, typecheck, unit, `supabase start` + `supabase db reset`, cucumber, playwright (upload report artifact), next build. Add Dependabot and a CodeQL workflow.
8. .env.example with names only. README with local setup.
Acceptance: all CI jobs green; health scenario passes; no secrets in repo.
```

### Phase 1: Data model, migrations, RLS, seed
**Goal:** the full MVP schema with integrity, geo and security built into the database.
**Deliverables:** SQL migrations (Supabase CLI) + a matching Prisma schema; RLS policies; seed with a pilot zone, 5 merchants, menus and 3 riders; ERD in docs.
**Acceptance:** `supabase db reset` seeds cleanly; RLS tests prove isolation per role; PostGIS queries for "zone containing point" and "nearest available riders" return correct results in tests.

Prompt:
```
[Shared header]
Phase 1 — Data model. Base it on docs/BUSINESS.md §9.3 but apply these corrections: integer centavos, many roles per user, order_items instead of items_json, PostGIS instead of polygon_json, audit/event tables.
Create migrations for:
- profiles(id = auth.users.id, full_name, phone, email, locale, status)
- user_roles(user_id, role enum[customer,rider,merchant_owner,merchant_staff,coordinator,admin], merchant_id null, zone_id null, unique)
- invites(email, role, merchant_id, zone_id, invited_by, expires_at, accepted_at)
- zones(name, area geography(Polygon), base_fee_centavos, per_km_centavos, max_radius_km, is_active, service_hours jsonb, coordinator_id) — doc §5.5 radii
- addresses(user_id, label, location geography(Point), landmark, barangay, city, notes, contact_phone, is_default)
- merchants(zone_id, owner_id, name, slug, category enum[food,grocery,pharmacy], location geography(Point), commission_bps, accepts_cod, is_open, default_prep_minutes, hours jsonb, status enum[pending,active,suspended], rating_avg, rating_count)
- menu_categories, menu_items(price_centavos, is_available, photo_path, sort), modifier_groups(min,max,required), modifier_options(price_delta_centavos)
- riders(user_id, zone_id, vehicle_type enum[motorcycle,bicycle,tricycle], plate_no, status enum[pending_kyc,active,suspended], is_online, cash_limit_centavos, rating_avg)
- rider_kyc_documents(rider_id, type, storage_path, status, reviewed_by, reviewed_at)
- rider_locations(rider_id pk, location geography(Point), heading, speed, updated_at) + rider_location_breadcrumbs(sampled)
- orders(code, customer_id, merchant_id, rider_id, zone_id, status enum, dispatch_status enum, subtotal/delivery_fee/service_fee/small_order_fee/discount/tip/total _centavos, payment_method enum[gcash,maya,card,qrph,cod], payment_status, address_snapshot jsonb, dropoff geography(Point), scheduled_for, prep_minutes, delivery_pin_hash, cancel_reason, cancelled_by, timestamps per status)
- order_items(order_id, menu_item_id, name_snapshot, unit_price_centavos, quantity, modifiers_snapshot jsonb, line_total_centavos)
- order_events(order_id, from_status, to_status, actor_id, actor_role, meta jsonb, created_at)
- dispatch_offers(order_id, rider_id, status enum[offered,accepted,declined,expired], expires_at)
- payments(order_id, gateway, intent_id, gateway_ref, amount_centavos, status, method), webhook_events(gateway, event_id unique, payload, processed_at)
- ledger_entries(double entry: txn_id, account enum, party_type, party_id, debit_centavos, credit_centavos, order_id), payouts(party_type, party_id, period_start, period_end, amount_centavos, status, reference)
- ratings(order_id, from_user_id, target_type enum[merchant,rider,customer], target_id, score 1-5, tags text[], comment)
- promos, promo_redemptions, referrals, loyalty_stamps, device_push_subscriptions, notifications, audit_logs, feature_flags, fee_rules
Indexes (GiST on geography, btree on FKs/status). Helper SQL functions: zone_for_point(point), nearest_available_riders(point, limit) using ST_DWithin + <->, has_role(role, merchant_id, zone_id).
RLS on everything: customers see own orders/addresses; merchant staff see their merchant's orders/menu; riders see offered/assigned orders only; coordinators see their zone; admin all. Storage: public bucket menu-photos, private bucket rider-kyc.
Mirror in Prisma schema (packages/db), generate client. Seed (supabase/seed.sql): one pilot zone polygon (placeholder barangay coords, documented), 5 merchants with menus, 3 riders, test customers.
Tests: SQL/pgTAP or Vitest-against-local-db tests for RLS isolation and the geo functions. Add docs/ERD.md (mermaid).
```

### Phase 2: Auth and RBAC per role
**Goal:** every user type can sign in securely and sees only their surface.
**Deliverables:** phone OTP (customer, rider) through the Supabase Auth Send-SMS hook to a Semaphore adapter; staff email+password+TOTP with forced enrolment; invite-only staff onboarding; route guards; bootstrap-admin script.
**Acceptance (Gherkin):** a customer signs up with a phone OTP and lands on Home; a merchant invite → set password → enrol TOTP → `/merchant`; a rider can't open `/merchant` or `/admin` (403); OTP sends rate-limited (e.g. 5/hour/phone, 20/hour/IP); session refresh works; logout revokes.

Prompt:
```
[Shared header]
Phase 2 — Auth & RBAC (docs/BUSINESS.md §9.2.1 onboarding, §5.3–5.4 onboarding).
- Use Supabase Auth via @supabase/ssr in apps/web (cookies, server-side session checks). Do NOT build custom JWT/bcrypt auth.
- Customers & riders: phone OTP (+63 normalization with libphonenumber-js). Implement the Supabase "Send SMS" auth hook as a signed route /api/hooks/send-sms that verifies the hook secret and sends via a SemaphoreSmsSender adapter implementing ISmsSender (packages/core port). Dev/test: FakeSmsSender + Supabase test OTP numbers.
- Staff (merchant_owner, merchant_staff, coordinator, admin): email+password, TOTP MFA mandatory (require AAL2 for /merchant, /admin, /api/merchant/*, /api/admin/*). Invite-only: admin invites with role + scope; invite link handles token_hash/verifyOtp, PKCE code and hash tokens → /auth/set-password → /auth/mfa/enroll.
- Authorization in core: AuthorizationService.can(user, action, resource) backed by user_roles; route groups (customer)/, merchant/, rider/, admin/ each with a server layout guard; API handlers use requireRole(...). Never trust client-sent roles.
- Rate limiting for auth endpoints (Postgres-backed or Upstash free tier behind an IRateLimiter port).
- scripts/bootstrap-admin.ts: env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL; idempotent; grants admin; sends invite/recovery with redirectTo the site's /auth/callback?next=/auth/set-password.
- Pages: centered auth screens (phone entry, OTP 6-box input with auto-advance + resend timer, set password, MFA enroll with QR + manual key, MFA verify).
Features: features/auth/*.feature covering the acceptance criteria in docs/BUILD_PLAN.md Phase 2. Playwright e2e for staff invite → MFA and customer OTP (using test OTP).
```

### Phase 3: Merchant onboarding and menu manager (+ AI menu import)
**Goal:** a merchant can go live with a full menu without help (doc §5.4, §9.2.2).
**Deliverables:** a merchant application form → admin approval; store settings (hours, COD, prep time, open toggle); menu manager (categories, items, modifiers, photos to Storage with client-side compression, availability toggle); Gemini-powered "Import menu from photo" producing draft items; public store slug.
**Acceptance:** an approved merchant creates 20 items with modifiers in under 15 minutes (manual UAT); photos stay under 200 KB WebP; AI import never publishes without merchant review; staff of merchant A can't edit merchant B (test).

Prompt:
```
[Shared header]
Phase 3 — Merchant onboarding & menu (docs/BUSINESS.md §5.4, §9.2.2, Appendix A).
- Public /partners page: merchant application (business name, owner, phone, email, barangay, category, pin on map). Creates merchants(status=pending). Admin approves in /admin/merchants → sends staff invite (Phase 2 flow) and records commission_bps (default from fee_rules; founding partner flag = 0% for 90 days with end date stored).
- /merchant/settings: hours per weekday + holiday closures, open/closed toggle, default prep time, accepts COD, service radius (≤ zone max).
- /merchant/menu: categories (drag reorder), items (name, description, price in ₱ → centavos, photo, availability), modifier groups (required/optional, min/max) and options (+₱). Client-side image resize to WebP ≤1280px before upload to Storage bucket menu-photos via a signed upload URL from the BFF.
- AI import: /merchant/menu/import — upload a menu photo → /api/merchant/menu/import calls IMenuParser (GeminiMenuParser adapter, model from env GEMINI_MODEL, structured JSON output validated by zod) → shows editable draft rows with confidence → merchant confirms → bulk insert. Never send customer data to Gemini. Add a FakeMenuParser for tests.
- Services in core: MerchantOnboardingService, MenuService (SRP), with repository ports.
Features: merchant_onboarding.feature, menu_management.feature, menu_import.feature (with fake parser). Playwright on mobile viewport.
```

### Phase 4: Customer discovery, store page, cart (PWA)
**Goal:** a customer browses to a full cart smoothly on a budget phone.
**Deliverables:** address onboarding (GPS + pin drag + landmark); home feed rails; category chips; search with filters; store page with sticky tabs and an item bottom sheet; a single-store cart (server-validated prices); PWA manifest + service worker; skeletons and an offline banner.
**Acceptance:** Lighthouse mobile Performance ≥ 85 and PWA installable on the store page; adding from a second store prompts a cart replace; the cart's server re-price matches the UI; an out-of-zone address shows "We're not in your area yet — join the waitlist".

Prompt:
```
[Shared header]
Phase 4 — Customer discovery & cart (docs/BUSINESS.md §9.2.1; UI per docs/BUILD_PLAN.md §3).
Build the customer PWA under app/(customer):
- Address setup: browser geolocation → MapLibre GL map (free tile provider via env) with draggable pin; Places Autocomplete through BFF /api/geo/autocomplete (session tokens, server key, cached); require landmark + contact phone; zone_for_point decides serviceability; out-of-zone → waitlist capture (name/phone/email, barangay).
- Home: "Deliver to" chip, search bar, category chips, promo carousel (from promos table), rails: Near you, Under ₱100, Fast, Free delivery, Order again. StoreCard (cover, name, rating, ETA range, fee, badges, closed state with opens-at). Feed from /api/feed (one round trip, cached per zone 60s).
- Search: /api/search (Postgres full-text + trigram on merchants and menu_items), grouped results, recent searches (localStorage), filters sheet.
- Store page /s/[slug]: hero, info strip, sticky category tabs with scroll-spy, item rows, item bottom sheet (vaul) with modifier validation, sticky "View cart" bar.
- Cart: Zustand store persisted locally, one merchant per cart with replace prompt; /api/cart/quote re-prices server-side via PricingService (DeliveryFeeStrategy: ZoneBaseFee + DistanceBand using haversine × road factor 1.3, configurable; SmallOrderFee; returns breakdown) — UI always displays server quote.
- PWA: manifest, icons, service worker (next-pwa or serwist) caching shell + feed; offline banner; skeleton loaders; images via next/image WebP.
Features: browse_and_search.feature, cart.feature, serviceability.feature. Playwright mobile flows + Lighthouse CI budget check.
```

### Phase 5: Checkout and payments (PayMongo + COD)
**Goal:** place and pay for an order correctly, every time, even when webhooks retry.
**Deliverables:** single-screen checkout; `OrderService.placeOrder`; `IPaymentGateway` with `PayMongoGateway` (GCash, Maya, card, QR Ph via Payment Intents/Methods) and `CashOnDelivery`; signed + idempotent webhook handler; ledger entries; refunds; idempotency keys on place-order.
**Acceptance:** double-tapping "Place order" creates one order; a replayed webhook doesn't double-credit; a failed or expired payment leaves the order `awaiting_payment` → auto-cancelled after N minutes (pg_cron); an e2e test in PayMongo test mode passes; the ledger balances (sum debits = sum credits) for every order.

Prompt:
```
[Shared header]
Phase 5 — Checkout & payments (docs/BUSINESS.md §2.2, §5.2 steps 1 & 6–7, §10.3 O/L/D examples, Appendix C).
- Checkout screen per docs/BUILD_PLAN.md §3: address + pin confirm, ASAP/schedule, payment method (gcash, maya, card, qrph, cod), promo code, tip chips, total restated on the button.
- POST /api/orders with Idempotency-Key header. OrderService.placeOrder: validate merchant open + in zone + items available, reprice via PricingService, apply PromoService, create order + order_items + order_events in one transaction, then: COD → status placed; online → create PayMongo payment intent, status awaiting_payment, return the redirect/next action.
- Ports: IPaymentGateway { createIntent, getStatus, refund } implemented by PayMongoGateway (packages/adapters; secret key server-only) and CashOnDeliveryGateway; no switch statements on method strings in services (strategy registry).
- /api/webhooks/paymongo: verify Paymongo-Signature (HMAC, timestamp tolerance), store in webhook_events (unique event_id) before processing, idempotent transitions awaiting_payment → placed, payment_status updates; return 200 fast.
- LedgerService: on payment captured/COD delivered, write balanced double-entry rows (customer payment, merchant payable = subtotal − commission, rider payable = rider pay rule from fee_rules, platform revenue = commission + platform-kept fees, gateway fee expense). Add a DB check/test that every txn balances.
- pg_cron: cancel awaiting_payment orders older than 15 min (configurable) and release promo redemptions.
- Refund path: RefundService (full/partial) via gateway; COD orders → credit to wallet (stub) or manual.
Features: checkout.feature, payments_webhooks.feature (replay, bad signature, out-of-order), ledger.feature. Use PayMongo test mode keys in CI via GitHub secrets only for a tagged @external suite; default suite uses a FakePaymentGateway.
```

### Phase 6: Merchant order queue, order lifecycle, notifications, SLA timers
**Goal:** merchants never miss an order, and status changes reach everyone in real time.
**Deliverables:** `OrderStateMachine` (allowed transitions + actor rules); merchant order board with a loud alert, accept/reject + prep-time chips, ready; Realtime private channels; Web Push + SMS fallback (`INotificationSender` implementations); pg_cron SLA escalation (alert → SMS 60 s → coordinator flag 120 s → auto-cancel + refund 180 s, per doc §5.4).
**Acceptance:** illegal transitions are rejected (unit tests for every pair); the merchant sees a new order in under 2 s locally; an unacknowledged order is auto-cancelled at 180 s and the refund triggered; the customer's tracking stepper updates live.

Prompt:
```
[Shared header]
Phase 6 — Order lifecycle & merchant queue (docs/BUSINESS.md §5.2, §5.4 SLA, §9.2.2 order queue).
- packages/core OrderStateMachine: explicit transition table (awaiting_payment→placed→accepted→preparing→ready→picked_up→delivered; rejected/cancelled/failed_delivery side exits) with allowed actor roles per transition; every transition writes order_events and timestamp columns in one transaction. Table-driven unit tests for all pairs.
- Realtime: private channel per order (order:{id}) and per merchant (merchant:{id}) using Supabase Realtime Authorization (RLS policies on realtime.messages using has_role). Server broadcasts after commit (or DB trigger → realtime.broadcast_changes). Clients only subscribe.
- /merchant/orders board: columns New / Preparing / Ready / Picked up; new-order sound loop until acknowledged (user-gesture unlock), Accept with prep chips 10/15/20/30, Reject with reason, Mark ready, item 'sold out' quick toggle; 3-minute countdown on New cards.
- Notifications: INotificationSender with WebPushSender (VAPID, device_push_subscriptions), SmsSender (Semaphore), InAppSender; NotificationService picks channels per event via a policy (no ifs on channel names in services).
- SLA via pg_cron every 30s: unacknowledged at 60s → SMS merchant; 120s → flag for coordinator; 180s → cancel(reason=merchant_timeout) + enqueue refund. Make thresholds fee_rules/feature_flags configurable.
- Customer tracking page: status stepper with timestamps subscribed to order channel.
Features: order_lifecycle.feature, merchant_sla.feature (use a controllable clock port IClock), merchant_board.feature (Playwright with two browser contexts: customer + merchant).
```

### Phase 7: Rider app (PWA), dispatch, live tracking
**Goal:** the nearest suitable rider gets the job fast, and the customer watches the delivery live.
**Deliverables:** rider PWA (online toggle, Wake Lock, foreground GPS every 5–10 s while online/active); `DispatchService` (offer to nearest available rider within radius, 30 s expiry, cascade to next, coordinator fallback); job flow (arrived store → picked up → arrived → delivered with PIN or photo proof); COD cash banner and cash-limit check; Waze/Google Maps deep links; earnings view; tracking map for the customer with ETA.
**Acceptance:** with 3 seeded riders, the offer goes to the nearest online rider under their cash limit; a declined or expired offer cascades within 30 s; the customer map shows rider movement (throttled); location stops being shared when offline or after delivery; the delivery PIN is required for orders over a configurable ₱ value.

Prompt:
```
[Shared header]
Phase 7 — Rider app, dispatch & tracking (docs/BUSINESS.md §5.2 steps 4–6, §5.3, §9.2.3).
- Rider PWA under app/rider (installable): big Online/Offline toggle; while online, navigator.geolocation.watchPosition + Screen Wake Lock; POST /api/rider/location throttled to 1 per 7s (and only if moved > 15 m) → upsert rider_locations + sampled breadcrumbs; stop on offline/visibility rules. Document the PWA background-GPS limitation in docs/ARCHITECTURE.md and the trigger to build the Expo rider app later.
- DispatchService (core) with IDispatchStrategy: NearestAvailableStrategy using nearest_available_riders(point) filtered by zone, is_online, not on active job, COD cash_limit ≥ order total for COD. Creates dispatch_offers with expires_at = now()+30s; pg_cron/expiry job cascades to the next rider; after N attempts → flag to coordinator. Trigger dispatch when merchant accepts (configurable: at accept vs. X minutes before ready based on prep time).
- Rider job UI: offer card (pickup, drop-off, distance, earnings shown upfront, countdown, Accept/Decline); steps with swipe-to-confirm: Arrived at store → Picked up → Arrived → Delivered (PIN entry if order total ≥ threshold, else photo proof to private bucket); deep links to Waze and Google Maps; COD 'Collect ₱X' banner; earnings today/week from ledger.
- Customer tracking: MapLibre map with merchant, drop-off, rider marker (interpolated), ETA = remaining distance / zone avg speed (configurable) — Routes API only optional behind a flag.
- Privacy: customers see rider location only between assigned and delivered; riders see customer phone masked via BFF call-relay stub.
Features: dispatch.feature (nearest, decline cascade, expiry, cash limit), rider_flow.feature, tracking.feature (Playwright with geolocation mocks across rider + customer contexts).
```

### Phase 8: Coordinator and Admin console
**Goal:** operations run without developer help (doc §10.6 Phase 6 go/no-go).
**Deliverables:** `/admin` live map + order board with SLA colors; manual assign/reassign/cancel/refund with a reason (audited); zone polygon editor; merchant and rider KYC queues (signed URLs, audited views); fee rules and feature flags editor; user/role management and invites; support notes on orders.
**Acceptance:** a coordinator only sees their zone; every admin action writes `audit_logs`; KYC images are never public (test the URL expiry); changing a zone fee affects new quotes only.

Prompt:
```
[Shared header]
Phase 8 — Coordinator & Admin console (docs/BUSINESS.md §5.5 zone hub, §9.2.4, Appendix B).
- /admin (desktop-first, responsive): live map (riders + active orders, Realtime), order board with SLA timers (amber at 80%, red at 100% of target), filters by zone/status; order detail with timeline from order_events, actions: assign/reassign rider, cancel with reason, refund (full/partial), add support note. All actions through AdminOrderService → audit_logs.
- Zones: polygon draw/edit on MapLibre (terra-draw or mapbox-gl-draw compatible), base fee, per-km, max radius, hours, active toggle; validates polygon; coordinator assignment.
- Merchants: application queue, approve/suspend, commission override with effective date, founding-partner window.
- Riders: KYC queue per Appendix B checklist (IDs, license, OR/CR, selfie, payout account name match), view docs via 60s signed URLs, approve/reject with reason, suspend; rating < 3.5 → coaching queue (doc §5.3).
- Settings: fee_rules, feature_flags, notification templates (en/fil).
- Users: invite staff with role + scope, revoke roles.
- Coordinator role sees only their zone (enforced in service + RLS).
Features: admin_ops.feature, kyc_review.feature, zones.feature, coordinator_scope.feature.
```

### Phase 9: Ratings, reorder, promos, referrals, loyalty
**Goal:** the retention loop (doc §4.2 Phase 2–3, §9.2.1 loyalty).
**Deliverables:** a two-sided rating sheet (merchant + rider; rider rates customer); rating aggregates; reorder; promo codes with caps and eligibility; referral (credit after the referee's first completed paid order, one per device/phone); loyalty stamps (10th order → free delivery).
**Acceptance:** promo abuse tests (same phone or device twice fails); rating can only be submitted once per order per target within 7 days; reorder re-prices and flags unavailable items.

Prompt:
```
[Shared header]
Phase 9 — Retention (docs/BUSINESS.md §4.2 referral ₱50, loyalty stamps, §5.3 ratings, §9.2.1 order history).
- RatingService: after delivered, prompt customer to rate merchant and rider separately (1–5 + tags + comment), rider rates customer; one per order/target, editable 24h, window 7 days; update aggregates via trigger; low ratings (≤2) create a support ticket for the coordinator.
- Orders history with Reorder (re-quote, unavailable items flagged).
- PromoService (strategies: PercentOff with cap, FixedOff, FreeDelivery with cap, FirstNOrders) with eligibility rules (new users, zone, merchant, min subtotal, usage per user, global budget cap in ₱).
- ReferralService: unique code per customer; credit both after referee's first completed non-COD-cancelled order; fraud guards (phone, device fingerprint hash, same address).
- Loyalty: stamp per completed order ≥ min subtotal; 10th → free-delivery voucher.
Features: ratings.feature, promos.feature (incl. abuse), referrals.feature, loyalty.feature.
```

### Phase 10: Finance: settlements, payouts, reports
**Goal:** weekly money is correct and auditable (doc §5.3–5.4 payouts, §6.5 accounting).
**Deliverables:** weekly settlement job (Mon–Sun Asia/Manila) per merchant and rider from the ledger; payout batches (pilot: manual GCash/bank transfer with a CSV export and reference entry; later: a disbursement API adapter); merchant payout tracker + CSV; rider earnings statements; rider COD remittance reconciliation; a platform P&L view; exports for the bookkeeper (doc §6.5 chart of accounts).
**Acceptance:** settlements equal the sum of ledger rows; a payout can't be marked paid twice; COD cash owed by a rider nets against their earnings; CSVs open cleanly in Google Sheets.

Prompt:
```
[Shared header]
Phase 10 — Finance (docs/BUSINESS.md §5.2 step 7, §5.3 Friday payouts, §5.4 weekly settlement, §6.5 chart of accounts, Appendix A payout clause).
- SettlementService: weekly period in Asia/Manila; for each merchant and rider compute payable from ledger_entries (merchant: subtotal − commission − refunds; rider: trip pay + tips + incentives − COD cash collected not yet remitted). Create payouts(status=pending) with line detail; idempotent per period.
- Payout batch UI in /admin/finance: review, export CSV (name, GCash/bank, amount, reference), mark paid with reference (audited, immutable after paid). IDisbursementGateway port with ManualDisbursement now; leave a stub for a future API adapter.
- Merchant /merchant/payouts and rider earnings: statements per week, CSV download.
- Reports: GMV, take rate (define in docs: (commission + platform-kept fees)/GMV), contribution per order, refunds, promo cost, COD share — by zone and week. Export mapping to doc §6.5 chart of accounts.
- Flag in docs/OPEN_QUESTIONS.md: BIR withholding for e-marketplace remittances and BSP payment-aggregator rules — needs CPA/lawyer before real payouts.
Features: settlement.feature, payouts.feature, cod_remittance.feature, reports.feature.
```

### Phase 11: Hardening: security, privacy, observability, performance
**Goal:** safe to put real people's money and data on it (doc §12 data-breach risk, §13.2 uptime).
**Deliverables:** Sentry (web + server, PII scrubbing); structured logs with request IDs; an uptime monitor on `/api/health`; PostHog funnels (home → store → cart → checkout → paid); rate limits on all public endpoints; dependency + secret scanning; an OWASP ASVS L1 checklist pass; a k6 load test for peak lunch; privacy notice, terms, account deletion and data export; backup and restore drill.
**Acceptance:** k6 at 5× the expected pilot peak with p95 API latency < 500 ms and no errors; the security checklist is done with issues ticketed; restore from backup tested in staging; zero high-severity findings open.

Prompt:
```
[Shared header]
Phase 11 — Hardening (docs/BUSINESS.md §7.2 privacy/RA 10173, §12 risks, §13.2 ops KPIs).
- Observability: Sentry for Next.js (client + server, beforeSend scrubs phone/email/address), pino logs with request_id propagated to services, /api/health deep check (db, storage), uptime monitor config doc, PostHog (self-identify only by user id; no PII) with checkout funnel events; a /admin/system page showing webhook failures, job lag, SLA breaches.
- Security: run through OWASP ASVS L1 and write docs/SECURITY.md with results; rate limit every public /api route; CSRF protection for cookie-auth mutations (origin check); verify all file uploads (type sniffing, size); RLS regression suite; secret scanning (gitleaks) in CI; dependency audit.
- Privacy: privacy notice + ToS pages (templates marked 'for lawyer review'), consent capture at signup, account deletion + data export endpoints, KYC retention job (configurable), audit log of KYC views.
- Performance: k6 script for lunch peak (browse, quote, place COD order, merchant accept, dispatch) at 5× pilot peak; fix N+1s; DB indexes per pg_stat_statements; Lighthouse budgets in CI.
- Resilience: payment gateway down → COD-only mode via feature flag (doc §12); Maps down → manual pin + flat fee fallback.
Features: privacy.feature, resilience.feature.
```

### Phase 12: Pilot launch (doc Tier 1: one barangay)
**Goal:** a soft launch to the first 100 invited customers with 5–10 merchants and 2–3 riders (doc §3.3, §4.2).
**Deliverables:** production Supabase (Pro) and Vercel (Pro) projects, domain + email (Resend with a verified domain); a separate staging env; seed of real merchants via onboarding; an invite-code gate for customers; runbooks (order stuck, rider no-show, payment dispute, refund, merchant offline, outage); a coordinator training doc; a launch checklist; a KPI dashboard (doc §13).
**Acceptance:** 3 staged dry-run days with internal orders (food actually delivered); every runbook rehearsed once; KPIs visible daily; go/no-go per doc §10.6 Phase 7 (zero P0 bugs).

Prompt:
```
[Shared header]
Phase 12 — Pilot launch readiness (docs/BUSINESS.md §3.3 Tier 1, §4.2 Phase 1–2, §10.6 Phase 7, §13 KPIs).
- Environments: document and script promotion staging → production (Supabase migrations via CI on tag, Vercel production deploy on main). Production env checklist in docs/LAUNCH.md (Vercel Pro, Supabase Pro + PITR/backups, custom domain, Resend domain verified, PayMongo live keys, Semaphore sender name approved, Maps key restricted by referrer/API).
- Invite-only gate: customer invite codes (doc: first 100 customers), waitlist import.
- Feature flags for pilot scope: food only, Pabili (off by default), schedule orders, surge off.
- KPI dashboard /admin/kpis: doc §13.1 and §13.2 metrics + contribution per order, rider earnings/online hour, merchant acceptance time, COD share.
- Runbooks in docs/runbooks/*.md: stuck order, rider no-show, payment captured but order missing, refund, merchant offline, Supabase/Vercel outage, data incident (NPC 72h notification steps).
- Seed script for real pilot merchants is NOT allowed — real merchants onboard through the product.
- Smoke test suite (@smoke Cucumber tag) runnable against production with a test merchant and test customer.
Output docs/LAUNCH.md with the go/no-go checklist and current status.
```

### Later phases (after the pilot proves contribution is positive)
- **13 — Pabili mode** (if not done in the pilot): free-text shopping list, receipt photo, item-cost cap, COD float.
- **14 — Expo rider app** (background location with TaskManager, push via FCM) once you have more than about 5 riders or GPS gaps.
- **15 — Expo customer app** if PWA install rates or iOS push limitations hurt retention.
- **16 — Multi-category** (grocery → parcels → pharmacy with Rx photo verification; doc §1.3 roadmap).
- **17 — Zone replication tool** + coordinator self-serve (doc Months 7–9).
- **18 — B2B scheduled batches and contracts**, then surge, ads and merchant subscriptions.
- **19 — Extract `packages/core` into NestJS `apps/api`** on a private network when scale or a team needs it (the code moves; the BFF keeps the public contract).

---

## 7. How to run this with Claude agents
1. Repo: `Klik-Go/delivery-services`. `docs/BUSINESS.md` (your doc), `docs/BUILD_PLAN.md` (this file), `CLAUDE.md` and `docs/CLAUDE_PROMPTS.md` are already committed.
2. One phase per agent session or PR. Paste the shared header + the phase prompt. Review the PR yourself, merge, then start the next phase.
3. Secrets: add them in Vercel/GitHub/Supabase dashboards only, never in prompts.
4. After each phase, tick the phase in `docs/PROGRESS.md`, record acceptance evidence, and update `docs/OPEN_QUESTIONS.md`.
5. Business tasks run in parallel (doc §8): 20–30 customer interviews, 10–15 merchant surveys, and the 50-signup waitlist test. Do these before Phase 5 so pricing inputs are real.

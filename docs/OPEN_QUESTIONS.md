# Open questions and doc conflicts

Agents add items here when a decision is blocked, docs conflict, or the plan could be better. A human answers in place, and the item moves to **Resolved** with the date.

## Open

### Q28. Demo data for showing Klik Go — how to load it and run a demo (owner, 2026-11-06)
Owner request: "Fill out all the data needed for a test demo." The hosted database only gets migrations (never the local seed), so demo stores are loaded on purpose with **Actions → Load demo data**.
- **What it adds** (safe to run again; nothing is duplicated):
  - 9 open stores (6 AM–11 PM daily, cash on delivery, normal prices) with full menus and choices:
    Makati: Lutong Bahay ni Lola Ising, Kape at Pandesal Salcedo, Inasal Grill Poblacion.
    San Fernando: Kusinang Kapampangan, Tibok-Tibok at Kakanin, Pancit at Lomi House.
    San Marcelino: Mangga ng Zambales, Pares at Mami ni Mang Lito, Sari-Sari Plus San Marcelino (grocery).
  - Delivery fees for zones with none yet: ₱39 up to 2 km, ₱49 to 4 km, ₱59 beyond (₱69 in San Marcelino), ₱20 small-order fee under ₱150.
  - Promo codes on Home: **DEMOKAIN** (₱50 off ₱300+), **DEMOHATID** (free delivery on ₱200+), **DEMO10** (10% off ₱150+, up to ₱60), valid 90 days.
  - One store owner account (`owner_email`) that manages all 9 stores. Use an inbox you control (a `+demo` alias works, e.g. `you+demo@gmail.com`); nothing is emailed.
- **Run it:** GitHub → Actions → **Load demo data** → Run workflow → action `load`, your `owner_email`, optionally a `store_phone` for the 1-minute texts (needs Semaphore, Q13) → approve the `production` gate. Open the one-time link from the log, set a password, enrol an authenticator app, then delete the run's logs. Needs the same secrets as **Bootstrap first admin** and a deployed migration (`/api/health/ready` = ready).
- **Demo walkthrough (two phones or two browser windows):**
  1. *Store:* sign in at `/auth/staff` with the owner account, open **Orders** (`/merchant/orders`), tap **Turn on sound** (and **Get alerts on this device** if VAPID keys are set, Q25). Use `?store=<id>` or the dashboard to switch stores.
  2. *Customer:* open the app, set the pin in the store's town (e.g. San Fernando), browse, add items, **Checkout** → sign in with any mobile number and the placeholder code (Q20) → landmark, contact number → **Cash on delivery** → **Place order**. Try **DEMOKAIN** on ₱300+.
  3. *Store:* the order appears within 2 seconds with the 3-minute countdown; accept with a prep time, then **Mark ready**. The customer's tracker updates live. Leave one order unaccepted to show the 3-minute auto-cancel (needs the jobs setup in Q25 for the text; the cancel itself always runs).
  4. Riders ("picked up", "delivered") arrive in Phase 7.
- **Remove it:** run the workflow with action `hide`: the stores are suspended and the codes switched off; orders and history stay. Running `load` again brings them back. Fee bands stay (real orders need them too).

### Q25. Order alerts and background jobs in production — owner checklist (Phase 6)
Without these, the board still updates live and in-app messages work, but there are no phone alerts or SLA texts, and refunds a crash left unfinished are not retried.
1. **Background jobs.** Make a random secret (e.g. `openssl rand -hex 32`). Put it in Vercel as `CRON_SECRET`. In Supabase → SQL Editor, run once (replace the two values; they are stored encrypted in Vault and never shown in logs):
   `select vault.create_secret('https://<your production domain>', 'klikgo_app_url');`
   `select vault.create_secret('<the same secret>', 'klikgo_cron_secret');`
   The `app-jobs` job then calls `/api/internal/jobs` every 30 seconds. Check it under Supabase → Integrations → Cron (job runs) and `net._http_response`.
2. **Web Push.** Run `npx web-push generate-vapid-keys` once. In Vercel set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (e.g. `mailto:ops@your-domain`). Keep the keys: changing them turns everyone's alerts off. On iPhone, Web Push works only after "Add to Home Screen".
3. **SLA texts** use the same Semaphore account as sign-in codes (`SEMAPHORE_API_KEY`, Q13). Until it is set they are only logged. Please add each store's phone number (store settings, Phase 8 editor; for now in Supabase `merchants.phone`), because owners sign in by email.

### Q26. Penalty for stores that miss the 3-minute confirmation (decision needed)
docs/BUSINESS.md §5.4 says an unconfirmed order is "auto-cancelled with penalty". Phase 6 cancels it, refunds the customer and records `merchant_timeout` on the order, but charges nothing yet. **Question:** what is the penalty (a fee per miss, a strike count before suspension, a lower ranking in the feed)? Phase 10 (finance) can apply it from these records.

### Q27. Phase 6 timing and Phase 7 hand-off (recorded)
Stores confirm at 60/120/180 seconds as BUILD_PLAN says. Orders can reach "ready" now; "picked up" and "delivered" need the rider app (Phase 7), so the board's Picked up column stays empty until then. Customers can cancel only until the store accepts; after that, support (coordinator/admin) cancels (Phase 8 console).

### Q22. PayMongo account, keys and webhook — owner checklist (Phase 5; later, by owner decision)
Owner 2026-11-06: no PayMongo account yet; launch testing starts with **cash on delivery**. Until these are set, production checkout offers cash on delivery only (online methods are hidden, nothing breaks).
1. Create the PayMongo account (dashboard.paymongo.com). Test keys work at once; live keys need PayMongo's business verification. In **Settings → Payment methods**, make sure GCash, Maya, cards and QR Ph are on.
2. Vercel → Settings → Environment Variables: `PAYMONGO_SECRET_KEY` = the **test** secret key (`sk_test_…`) for Preview; the **live** key (`sk_live_…`) for Production only after you have tested on Preview. Never put either key in chat, code or GitHub issues.
3. PayMongo → **Developers → Webhooks → Add endpoint**: URL `https://<your production domain>/api/webhooks/paymongo`, events `checkout_session.payment.paid` and `payment.refund.updated` (adding `payment.failed` is harmless). Copy the endpoint's signing secret (`whsk_…`) into Vercel as `PAYMONGO_WEBHOOK_SECRET`. Test mode and live mode have separate webhooks and secrets: use the test one for Preview. If Vercel Deployment Protection is on for Preview, PayMongo cannot reach it; use a protection bypass or test on a stable staging domain.
4. GitHub → Settings → Secrets → Actions: add `PAYMONGO_TEST_SECRET_KEY` (the `sk_test_…` key), then run **Actions → PayMongo test mode**. This is the Phase 5 "e2e in PayMongo test mode" check; it can only use a test key.
5. Redeploy, then on Preview: place a GCash order, pay with PayMongo's test page, and check the order turns "Sent to the store". In Supabase, `ledger_entries` for that order should sum to zero.

### Q21. Failed payments and the 15-minute timeout (decision taken; please confirm the minutes)
PayMongo's `payment.failed` event names a payment intent, not the checkout session Klik Go stores, and the customer can still retry on the same session, so Klik Go acknowledges and ignores it. PayMongo sends no event when a session expires. Instead, `pg_cron` cancels any order still awaiting payment after **15 minutes** (PayMongo's own session lasts 30), so a store never sees an unpaid order and the promo is released. If a payment still arrives later, Klik Go refunds it in full automatically and the customer sees it as refunded. **Question:** is 15 minutes right for the pilot? It is one value in `private.cancel_unpaid_orders` (a migration to change).

### Q23. Holding customer payments before paying merchants — legal check (owner)
Online payments go to Klik Go's PayMongo account and are paid out to merchants and riders later (Phase 10). Collecting money on behalf of merchants may bring rules on payment systems and e-money (BSP, Republic Act 11127 National Payment Systems Act), on official receipts and VAT (BIR), and PayMongo's own marketplace terms. This is not legal advice: please ask a Philippine lawyer or accountant before taking live payments, and tell us if payouts should instead go through a PayMongo split/marketplace product (that would be one more `IPaymentGateway`).

### Q24. Promo limits under heavy use (recorded)
Per-customer limits and `max_redemptions` are checked by `PromoService` when the order is placed, not by a database constraint, so two orders placed at the same instant could both use the last redemption. Acceptable for the pilot (small volumes, promos funded by Klik Go); a counter row with a conditional update can close it in Phase 9 (promos).

### Q6. GitHub repository settings — almost done (owner, re-checked 2026-11-05 from screenshots)
Already correct: Actions permissions (Klik-Go + GitHub actions only, no SHA pinning, read-only token, no PR creation), CodeQL on **Advanced setup**, Secret Protection + push protection, Dependabot alerts + security updates, private vulnerability reporting, the `main` ruleset's rules (restrict deletions, require a PR, require status checks, block force pushes, require CodeQL results at High or higher / Errors). Still to do:
1. **The `main` ruleset targets nothing yet.** GitHub shows "This ruleset does not target any resources and will not be applied". Settings → Rules → Rulesets → `main` → **Target branches → Add target → Include default branch** → Save changes. Until then `main` is not protected.
2. In the same ruleset, under **Require status checks to pass → Show additional settings**, make sure these four checks are listed (add them if not): `Lint · typecheck · unit`, `Supabase · build · Cucumber · Playwright`, `Analyze (javascript-typescript)`, `Analyze (actions)`.
3. Settings → Advanced Security → **Dependency graph: On** (Dependabot alerts rely on it).
4. Optional: Settings → General → Pull Requests → tick **Automatically delete head branches**. Allowing merge, squash and rebase merges is fine.

### Q10. How the BFF talks to the database under RLS — partly applied in Phase 2
Phase 2 only needs **server reads of roles** (`PrismaUserRoleRepository`) and **privileged writes** (invites, role grants, rate-limit counters), which use the server connection as proposed. The user-scoped path (`withUserContext`: `set local role authenticated` + `request.jwt.claims` from the verified session, so RLS also applies to the BFF) will land with the first user-owned writes (addresses and menus, Phase 3–4). Objections welcome before then.

### Q12. Supabase's own per-IP limits behind the BFF — hosted project setting (owner)
All auth requests reach Supabase from the BFF's server address, so Supabase's built-in per-IP limits (sign-ins, OTP sends, verifications) count *all* Klik Go users together and could block everyone at once. Klik Go enforces the real per-phone and per-network limits itself. **Action when creating the hosted project:** Authentication → Rate Limits: raise "SMS messages sent", "Sign-ups and sign-ins" and "Token verifications" well above expected peak traffic (e.g. 1000/hour) and keep Klik Go's limits as the guard. Locally `supabase/config.toml` already does this.

### Q13. Hosted Supabase and Vercel settings for auth — owner checklist
When the hosted Supabase project exists (Supabase Pro before taking real orders, BUILD_PLAN §2):
1. **Authentication → Providers → Phone**: enable. SMS provider: any (it is ignored when the hook is on).
2. **Authentication → Hooks → Send SMS hook**: type HTTPS, URL `https://<your-domain>/api/hooks/send-sms`, generate a secret, and put the same value in Vercel as `SEND_SMS_HOOK_SECRET`.
3. **Authentication → Multi-Factor**: enable TOTP (enroll + verify).
4. **Authentication → URL Configuration**: Site URL `https://<your-domain>`; redirect URLs `https://<your-domain>/auth/callback` and your Vercel preview pattern.
5. **Authentication → Policies**: minimum password length 12. **Rate limits**: see Q12.
6. **Vercel env vars** (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (pooler), `DIRECT_URL`, `SEND_SMS_HOOK_SECRET`, `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME`, `NEXT_PUBLIC_APP_URL`.
7. **Migrations (automatic since Phase 4.1).** In GitHub → Settings → Secrets and variables → Actions, add `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access tokens), `SUPABASE_PROJECT_REF` (the project's 20-letter ref, Project Settings → General) and `SUPABASE_DB_PASSWORD` (the database password). Then Actions → **Deploy database migrations** → Run workflow once; after that it runs by itself whenever migrations merge to `main`. Seed data is never pushed. (Done 2026-11-06: all 15 migrations applied to the hosted project.)
   - **Check it worked:** open `https://<your-domain>/api/health/ready`. `"database": "ok"` means the app can reach the database and it has every migration this build needs. `"outdated"` means migrations are missing (run the workflow). `"unreachable"` means the app cannot connect: re-copy `DATABASE_URL` in Vercel from Supabase → Connect → ORMs (Transaction pooler, port 6543) and check the password.
   - 2026-11-05: `PUT /api/location` returned 500 ("Something went wrong") on the deployed site. The zone lookup is the first database query on that screen; the likely cause is a hosted database without the migrations (nothing pushed them before this workflow) or a wrong `DATABASE_URL`. The readiness URL above tells which; Vercel's logs show the full error under the request id the API returns.
   - 2026-11-06 update: with `DATABASE_URL` set to the Transaction pooler string, the deployed app reaches the database, and the logs show the hosted database has **no migration history at all** (`supabase_migrations.schema_migrations` does not exist). So no migration has ever been applied there: running the workflow above is what fixes the address screen. (Readiness wrongly said `unreachable` for this case until the Phase 4.1.1 fix; it now says `outdated`.)
   - The three `SUPABASE_*` values above are **GitHub Actions secrets**, not Vercel variables: the app never reads them. Keep `SUPABASE_ACCESS_TOKEN` out of Vercel (it can manage the whole Supabase account).
   - `DIRECT_URL` is only for the Prisma CLI on a developer machine (Session pooler, port 5432); Vercel needs only `DATABASE_URL` (Transaction pooler, port 6543). Never use the "Direct connection" host on Vercel: it is IPv6-only.
8. **First admin (GitHub Actions, since Phase 4.1.2).** Add two more repository secrets: `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API Keys → service_role / secret) and `DATABASE_URL` (the same Transaction pooler string as in Vercel). Then Actions → **Bootstrap first admin** → Run workflow, with your email. Open the **one-time link** printed in the "Create the admin and print the one-time link" step straight away (it works once and expires), set a password (12+ characters) and enrol your authenticator app; you land on `/admin`. Then delete that run's logs (run page → ⋯ → Delete all logs), because the link is a credential and the logs are readable by anyone with access to the repository. Running it again for the same email gives a fresh recovery link and never a second admin role. The link needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel to work. From a computer instead: `pnpm bootstrap:admin` with `ADMIN_EMAIL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and `NEXT_PUBLIC_APP_URL` set.
9. Semaphore: register the sender name (e.g. KLIKGO) and top up credits (every OTP costs money; BUILD_PLAN §2).

### Q14. Email provider for staff invites — later
Invites currently return a one-time link that the admin shares (e.g. Viber). For branded invite and recovery emails, pick a provider (Resend or Postmark free tiers, or Supabase custom SMTP). It plugs in behind a new `IEmailSender` port; no flow changes.

### Q15. BUILD_PLAN says applications create `merchants(status=pending)` — recorded conflict (decision taken)
The Phase 3 prompt says the partner form "creates merchants(status=pending)". `merchants.owner_id` is a required link to an account, and an applicant has none yet (staff join by invite only). Phase 3 therefore stores applications in `merchant_applications`; approval creates the merchant (status `active`, closed until the owner opens it), the owner's account and the invite in one transaction. The `pending` merchant status stays for stores that an admin pauses before they are live. Say if you want it the other way round.

### Q16. Gemini for menu import — paid tier still to do (owner)
`GEMINI_API_KEY` is set (free tier, owner 2026-11-05). Remaining:
1. **Before real merchants import menus, enable billing (paid tier).** On the free tier Google may use submitted content to improve its products (BUILD_PLAN §2). Only menu photos are sent, never customer data, but they are still merchants' business data.
2. Check the key is set for both **Production and Preview** in Vercel; `GEMINI_MODEL` is optional (default `gemini-flash-latest`).
3. Never set `MENU_PARSER=fake` in Vercel (ignored on production anyway).

### Q17. Maps — tiles and address search (owner, optional before launch)
Phase 4 status: the pin maps (partner form, customer address) use Leaflet with OpenStreetMap's public tiles (attribution shown), and the tile URL is now an env var.
1. **Tiles.** OpenStreetMap's usage policy is fine for a low-traffic pilot but not for heavy use. Before marketing pushes traffic, pick an OSM-based provider with a free tier (e.g. MapTiler, Stadia) and set `NEXT_PUBLIC_MAP_TILE_URL` in Vercel to its https template (`…/{z}/{x}/{y}.png?key=…`; a browser key restricted to the Klik Go domains). The CSP picks up its origin automatically.
2. **Address search (autocomplete).** Optional. Create a Google Maps Platform key with only **Places API (New)** enabled, restrict it by API (it is used server-side, so no referrer restriction), set a daily quota, and add it to Vercel as `GOOGLE_MAPS_API_KEY`. Until then the search box is hidden and customers use GPS or move the map.
3. Deviation recorded: BUILD_PLAN asks for MapLibre GL; Leaflet is used instead (much smaller on the address screen, raster tiles are enough to drop a pin). See ARCHITECTURE decision log.

### Q18. Default commission
BUILD_PLAN says the default commission comes "from fee_rules", but `fee_rules` only holds delivery, small-order and service fees. The approval form defaults to **20%** (`DEFAULT_COMMISSION_BPS`, Appendix A's example) and the admin can change it per store. If you want a per-zone default, a `commission_default_bps` column on `zones` is a small follow-up.

### Q20. Placeholder sign-in code while SMS is off (owner decision 2026-11-05; remove before launch)
Owner request: "for customers accept any PH number for the meantime and add a placeholder code to proceed".
- **What it does.** While `PLACEHOLDER_OTP_CODE` is set (and `SEMAPHORE_API_KEY` is not), entering that code signs a customer in with any Philippine mobile number. The server finds or creates the customer's account by phone and signs them in with a fresh random password that is never stored; Supabase issues a normal session. Real texted codes keep working.
- **Safety rails.** Customers only: a number that belongs to a rider or staff member is refused. The usual limits still apply (5 code requests per number per hour, 10 wrong codes per number per 15 minutes, 20 requests per network per hour). The sign-in screens say a test code is needed but never show it. The code is never logged and is not in the repository: CI uses a different test-only value.
- **Owner action to turn it on.** In Vercel → Settings → Environment Variables (Production and Preview), add `PLACEHOLDER_OTP_CODE` with the 6-digit code you chose (the one you gave in chat), then redeploy. It also needs `SUPABASE_SERVICE_ROLE_KEY` (already required for partner approvals), and the **Phone** provider enabled in Supabase → Authentication → Sign In / Providers (Q13 step 1), because the session is a phone sign-in.
- **It switches itself off** as soon as `SEMAPHORE_API_KEY` is set. Before real customers arrive: delete `PLACEHOLDER_OTP_CODE` from Vercel, and treat accounts created during testing as test data.
- **Phone numbers.** Any Philippine mobile is accepted now: +63 then 10 digits starting with 9 (0917, 0991, …) or 8 (Globe 0817, DITO 0895–0898). This part is permanent; phone-number libraries lagged behind new prefixes.

### Q19. Phase 4 library deviations from BUILD_PLAN (decision taken, recorded)
BUILD_PLAN §6 Phase 4 names vaul for the item sheet and next-pwa/Serwist for the service worker. vaul is unmaintained, so the sheet is a native `<dialog>` (focus trap, Esc, backdrop built in). next-pwa and Serwist need webpack plugins while the app builds with Turbopack, so `public/sw.js` is hand-written and versioned. Lighthouse 12+ no longer has a PWA category, so "PWA installable" is checked with Chrome's own installability API in Playwright. No owner action needed.

### Q11. Prisma model names stay snake_case — decision to confirm
`db:pull` keeps the database names (`prisma.orders`, `order.total_centavos`). Renaming to PascalCase/camelCase with `@@map`/`@map` would need a hand-maintained mapping layer that drifts. Repositories map rows to domain objects anyway (CLAUDE.md), so I propose keeping snake_case inside `packages/adapters`/`packages/db` only.

### Q9. Tooling that is not on its newest major yet — follow-up
"Use what is up to date" (Q2) is applied everywhere except where the newest release cannot work yet:
- **TypeScript 6.0.3, not 7.0.** TypeScript 7 is the native (Go) compiler; `typescript-eslint` 8.72 (latest) supports only `<6.1`, so type-aware linting would break. Upgrade when typescript-eslint supports 7.
- **Prisma 7.10.1, not 8.0.** npm's `latest` tag points at `8.0.0-rc.30`, a release candidate; we use the newest stable.
- **lucide-react 1.67.0, not 1.68.0.** 1.68.0 was under a day old, and pnpm 12's `minimumReleaseAge` rejects it. Dependabot (2-day cooldown) will bump it.
- **Prisma 7 prints "Prisma only supports Node.js 20.19+, 22.12+, 24.0+" on Node 26.** Its own `engines` field allows `>=24`; the banner is cosmetic. Recheck on the next Prisma release.
- **Dependabot and pnpm 12:** if Dependabot cannot parse the pnpm 12 lockfile, its PRs will fail to open; then update deps with `pnpm update --latest` in a chore PR.

## Resolved

### Q8. Pilot zones — resolved 2026-11-05
**Answer: the whole of Makati City, the whole of San Marcelino (Zambales) and the whole of San Fernando (Pampanga).** Migration `20261108100000_launch_zones.sql` adds the three zones (active) with PSA/PSGC 3Q 2026 boundaries (`faeldon/philippines-json-maps`, MIT, checksum verified), simplified to ~5 m. Makati excludes the ten EMBO barangays that the Supreme Court placed under Taguig (the dataset's barangay list agrees; its city outline did not, so the zone is the city outline minus those barangays, ~18.3 km²). Types and maximum delivery radius: Makati and San Fernando are `city` (8 km), San Marcelino is `provincial` (20 km). The seed's stores, riders and customers moved into Makati; the placeholder zone is gone. Fees are still the pilot defaults (₱39 base, ₱10/km) until Phase 5 pricing.

### Q1. Vercel project link — resolved 2026-11-05
The owner linked Vercel project `delivery-services-web` with Root Directory `apps/web`. The preview for Klik-Go/delivery-services#3 (Next 16, Node 26 toolchain, pnpm 12) built and reported **Ready**. If a future deploy fails at install, the original setup notes still apply: Node.js Version 26.x (or 24.x); for pnpm 12 use `ENABLE_EXPERIMENTAL_COREPACK=1` (Node 24) or Install Command `npx pnpm@12.16.1 install --frozen-lockfile`.

### Q2. Dependency versions behind "latest" — resolved 2026-11-05
**Answer: use what is up to date.** Done in the Phase 0.1 PR: Node 26 LTS, pnpm 12, Next.js 16.4 (middleware → `src/proxy.ts`, Turbopack builds), React 19.3, TypeScript 6.0 (see Q9), ESLint 10, Vitest 5, Prisma 7.10 (`prisma.config.ts` + `@prisma/adapter-pg`), Playwright 1.64, Supabase CLI 3, jsdom 30, @types/node 26. Dependabot now proposes major updates too (one PR per package), with a 2-day cooldown.

### Q3. CLAUDE.md already existed — resolved 2026-11-04
Extended in place in Phase 0; nothing was dropped.

### Q4. BUSINESS.md §10.4 rules that BUILD_PLAN overrides — recorded 2026-11-04
Kept for reference so nobody "fixes" them back:
- §10.4.3 "NestJS JWT / phone OTP via Semaphore, not Supabase Auth" → **Supabase Auth** phone OTP with the Send-SMS hook (BUILD_PLAN §2).
- §10.4.3 "All schema changes via Prisma migrations" → **Supabase CLI SQL migrations**, with Prisma mirroring (RLS/PostGIS/pg_cron need SQL).
- §10.4.4 "Realtime subscribe (anon key)" → **private channels with Realtime Authorization**, the user's JWT.
- §10.4.4 "packages/config/tailwind.config.ts" → Tailwind v4 is CSS-first, so tokens are `packages/config/tailwind/tokens.css` (+ `src/tokens.ts`).
- §10.4.5 React Native rules → deferred until the Expo rider app (PWAs first).

### Q5. Branch naming — resolved 2026-11-05
**Answer: use whatever is necessary.** Phase PRs keep the `phase-N-short-name` convention from CLAUDE.md. Follow-ups and fixes may use the agent session branch (e.g. `claude/<session>`) when the environment requires it; the PR title always names the phase.

### Q7. Brand assets — resolved 2026-11-05
**Answer: the KGo logo and colour theme supplied by the owner.** Applied everywhere: blue `#228be6` + yellow `#ffd43b` (Open Color scales), Lilita One display type, outlined production logo, favicon and app icons, `<BrandLogo />`, home page, and docs. See `docs/BRAND.md`. The pilot-zone half of the old Q7 is now Q8.

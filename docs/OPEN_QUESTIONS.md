# Open questions and doc conflicts

Agents add items here when a decision is blocked, docs conflict, or the plan could be better. A human answers in place, and the item moves to **Resolved** with the date.

## Open

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
7. Run `supabase db push` for the migrations, then `pnpm bootstrap:admin` with `ADMIN_EMAIL` to create the first admin.
8. Semaphore: register the sender name (e.g. KLIKGO) and top up credits (every OTP costs money; BUILD_PLAN §2).

### Q14. Email provider for staff invites — later
Invites currently return a one-time link that the admin shares (e.g. Viber). For branded invite and recovery emails, pick a provider (Resend or Postmark free tiers, or Supabase custom SMTP). It plugs in behind a new `IEmailSender` port; no flow changes.

### Q15. BUILD_PLAN says applications create `merchants(status=pending)` — recorded conflict (decision taken)
The Phase 3 prompt says the partner form "creates merchants(status=pending)". `merchants.owner_id` is a required link to an account, and an applicant has none yet (staff join by invite only). Phase 3 therefore stores applications in `merchant_applications`; approval creates the merchant (status `active`, closed until the owner opens it), the owner's account and the invite in one transaction. The `pending` merchant status stays for stores that an admin pauses before they are live. Say if you want it the other way round.

### Q16. Gemini for menu import — paid tier still to do (owner)
`GEMINI_API_KEY` is set (free tier, owner 2026-11-05). Remaining:
1. **Before real merchants import menus, enable billing (paid tier).** On the free tier Google may use submitted content to improve its products (BUILD_PLAN §2). Only menu photos are sent, never customer data, but they are still merchants' business data.
2. Check the key is set for both **Production and Preview** in Vercel; `GEMINI_MODEL` is optional (default `gemini-flash-latest`).
3. Never set `MENU_PARSER=fake` in Vercel (ignored on production anyway).

### Q17. Map tiles — OpenStreetMap for now
The partner pin map uses OpenStreetMap's public tiles (attribution shown). Their usage policy is fine for a low-traffic pilot but not for heavy use. When the customer address picker arrives (Phase 4), choose a provider (e.g. MapTiler or Google Maps, both have free tiers) and switch the tile URL behind the maps adapter; the CSP allows `https://tile.openstreetmap.org` only.

### Q18. Default commission
BUILD_PLAN says the default commission comes "from fee_rules", but `fee_rules` only holds delivery, small-order and service fees. The approval form defaults to **20%** (`DEFAULT_COMMISSION_BPS`, Appendix A's example) and the admin can change it per store. If you want a per-zone default, a `commission_default_bps` column on `zones` is a small follow-up.

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

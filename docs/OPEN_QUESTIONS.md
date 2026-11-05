# Open questions and doc conflicts

Agents add items here when a decision is blocked, docs conflict, or the plan could be better. A human answers in place, and the item moves to **Resolved** with the date.

## Open

### Q6. GitHub repository settings — owner checklist (answered: "show me steps")
The repo is **public**, so everything below is free. Menu names are GitHub's as of Nov 2026; if a label differs slightly, the search box in Settings finds it.

**A. Protect `main` (Settings → Rules → Rulesets → New ruleset → New branch ruleset)**
1. Name: `main`. Enforcement status: **Active**. Bypass list: leave empty (or add *Repository admin* for emergencies only).
2. Target branches → Add target → **Include default branch**.
3. Tick **Restrict deletions** and **Block force pushes**.
4. Tick **Require a pull request before merging**. Required approvals: **0** while you are the only maintainer (the agent's PRs are opened under your account, and GitHub does not let an author approve their own PR); raise it to 1 when a second reviewer joins. Tick **Require conversation resolution before merging**.
5. Tick **Require status checks to pass** → **Add checks** and add these four (they appear after one CI run): `Lint · typecheck · unit`, `Supabase · build · Cucumber · Playwright`, `Analyze (javascript-typescript)`, `Analyze (actions)`. Tick **Require branches to be up to date before merging**.
6. Tick **Require code scanning results** → add **CodeQL**, security alerts threshold **High or higher**, alerts threshold **Errors**.
7. Create.

**B. Security features (Settings → Advanced Security, formerly "Code security")**
1. **Secret Protection** → Enable. Then **Push protection** → Enable (blocks pushes that contain secrets).
2. **Dependabot alerts** → Enable. **Dependabot security updates** → Enable. (Version updates already run from `.github/dependabot.yml`.)
3. **Code scanning → CodeQL analysis**: keep it on **Advanced** (our `.github/workflows/codeql.yml`). Do **not** switch on *Default setup*, or GitHub rejects the workflow's uploads.
4. Optional: **Private vulnerability reporting** → Enable.

**C. Actions (Settings → Actions → General)**
1. Actions permissions: select the 4th option, **Allow Klik-Go, and select non-Klik-Go, actions and reusable workflows**. Its sub-options only appear *after* you select it. Then tick **Allow actions created by GitHub**, leave "Marketplace verified creators" unticked and the "Allow specified actions" box empty, and click **Save**. CI uses only `actions/*` and `github/*` actions, so nothing else is needed.
2. Leave **Require actions to be pinned to a full-length commit SHA** unticked. Our workflows reference GitHub's actions by version tag (`@v4`); ticking it would fail every CI run unless every `uses:` is rewritten to a commit SHA.
3. Further down the same page, Workflow permissions: **Read repository contents and packages permissions**. Leave **Allow GitHub Actions to create and approve pull requests** unticked. Save.

**D. Pull requests (Settings → General → "Pull Requests" section)**
This is the repository's main settings page: the **General** item at the very top of the Settings sidebar, *not* Actions → General. Scroll about halfway down to the "Pull Requests" heading.
1. Tick **Allow squash merging** (default commit message: pull request title and description); optionally untick **Allow merge commits** for a linear history.
2. Tick **Automatically delete head branches** (lower in the same section). These checkboxes save as soon as you tick them.

Done when: a test PR shows the four required checks, and pushing a fake key like `ghp_` + 36 characters to a branch is blocked by push protection.

### Q8. Pilot barangay — needed before launch (placeholder in use)
Which barangay (and city/municipality) is the pilot? Phase 1 seeds a **placeholder** zone (`pilot-zone`, "Pilot Zone (placeholder)"): a 4 km × 4 km square centred on 14.5995° N, 120.9842° E, 5 merchants and 3 riders inside it (owner said on 2026-11-05: "use a placeholder zone for now"). When the barangay is chosen, a migration replaces the polygon (ideally the official PSA/NAMRIA boundary) and moves the seed merchants inside it.

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

### Q16. Gemini for menu import — owner action before real merchants use it
1. Create an API key in Google AI Studio and set `GEMINI_API_KEY` in Vercel (Production + Preview). Optionally set `GEMINI_MODEL` (default `gemini-flash-latest`).
2. **Before real merchants import menus, enable billing (paid tier).** On the free tier Google may use submitted content to improve its products (BUILD_PLAN §2). Only menu photos are sent, never customer data, but merchants' menus are still their business data.
3. Never set `MENU_PARSER=fake` in Vercel (it is ignored on production anyway).

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

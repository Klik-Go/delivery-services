# Open questions and doc conflicts

Agents add items here when a decision is blocked, docs conflict, or the plan could be better. A human answers in place, and the item moves to **Resolved** with the date.

## Open

### Q1. Vercel project link (needs owner action) — Phase 0
I can't create or link the Vercel project from the agent sandbox. Steps for the owner:
1. Vercel → Add New → Project → import `Klik-Go/delivery-services`.
2. **Root Directory:** `apps/web`. Framework preset: Next.js. Leave install/build commands at their defaults (Vercel installs at the repo root).
3. **Settings → Build and Deployment → Node.js Version:** `26.x` if offered, otherwise `24.x` (`package.json` allows `>=24`).
4. **pnpm 12:** the repo pins `pnpm@12.16.1` in `packageManager`. If the first deploy fails at install with a pnpm version error, add the env var `ENABLE_EXPERIMENTAL_COREPACK=1` (Node 24 only; Node 26 has no corepack), or set **Install Command** to `npx pnpm@12.16.1 install --frozen-lockfile`.
5. Env vars: none required yet. Optionally `LOG_LEVEL=info`.
6. Re-run the PR checks; the Vercel preview comment should appear on the PR.

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
1. Actions permissions: **Allow Klik-Go, and select non-Klik-Go, actions and reusable workflows** → tick **Allow actions created by GitHub**. CI uses only `actions/*` and `github/*` actions, so nothing else is needed.
2. Workflow permissions: **Read repository contents and packages permissions**. Leave **Allow GitHub Actions to create and approve pull requests** unticked.

**D. Pull requests (Settings → General → Pull Requests)**
1. Allow **squash merging** (default commit message: pull request title and description); optionally disable merge commits for a linear history.
2. Tick **Automatically delete head branches**.

Done when: a test PR shows the four required checks, and pushing a fake key like `ghp_` + 36 characters to a branch is blocked by push protection.

### Q8. Pilot barangay — needed by Phase 1
Phase 1 seeds one pilot zone polygon. Which barangay (and city/municipality) is the pilot? Without an answer, Phase 1 uses clearly labelled placeholder coordinates.

### Q9. Tooling that is not on its newest major yet — follow-up
"Use what is up to date" (Q2) is applied everywhere except where the newest release cannot work yet:
- **TypeScript 6.0.3, not 7.0.** TypeScript 7 is the native (Go) compiler; `typescript-eslint` 8.72 (latest) supports only `<6.1`, so type-aware linting would break. Upgrade when typescript-eslint supports 7.
- **Prisma 7.10.1, not 8.0.** npm's `latest` tag points at `8.0.0-rc.30`, a release candidate; we use the newest stable.
- **lucide-react 1.67.0, not 1.68.0.** 1.68.0 was under a day old, and pnpm 12's `minimumReleaseAge` rejects it. Dependabot (2-day cooldown) will bump it.
- **Prisma 7 prints "Prisma only supports Node.js 20.19+, 22.12+, 24.0+" on Node 26.** Its own `engines` field allows `>=24`; the banner is cosmetic. Recheck on the next Prisma release.
- **Dependabot and pnpm 12:** if Dependabot cannot parse the pnpm 12 lockfile, its PRs will fail to open; then update deps with `pnpm update --latest` in a chore PR.

## Resolved

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

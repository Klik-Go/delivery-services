# Open questions and doc conflicts

Agents add items here when a decision is blocked, docs conflict, or the plan could be better. A human answers in place, and the item moves to **Resolved** with the date.

## Open

### Q1. Vercel project link (needs owner action) — Phase 0
I can't create or link the Vercel project from the agent sandbox. Steps for the owner:
1. Vercel → Add New → Project → import `Klik-Go/delivery-services`.
2. **Root Directory:** `apps/web`. Framework preset: Next.js. Leave install/build commands as default (Vercel detects pnpm from `packageManager` and installs at the repo root).
3. Env vars: none are required for Phase 0. Optionally set `LOG_LEVEL=info`.
4. Re-run the PR checks. The Vercel preview comment should appear on the PR.

Until then, the "Vercel preview deploys" acceptance item stays unticked.

### Q2. Dependency versions behind "latest" — Phase 0
The plan says Next.js 15. As of 2026-11-04, npm `latest` is Next 16.4, Prisma 8 (rc tagged latest; 7.10 is stable), TypeScript 7.0 (native compiler), ESLint 10, Vitest 5. Phase 0 pins:
- **Next.js 15.5.29** (per plan; 15.5 has stable Node.js middleware).
- **Prisma 6.19**, because 7+ moves connection URLs out of `schema.prisma` into `prisma.config.ts` and requires driver adapters. That changes the `DATABASE_URL` + `DIRECT_URL` setup the plan describes.
- **TypeScript 5.9, ESLint 9, Vitest 3.2**, because typescript-eslint and the Next ESLint plugin are proven on these.

Proposal: upgrade to Next 16 + Prisma 7 as a dedicated chore PR after Phase 2, once auth middleware exists to regression-test. Dependabot ignores major bumps until then.

### Q3. CLAUDE.md already existed — Phase 0
Phase 0 asked to create `CLAUDE.md` from BUSINESS.md §10.3–10.4. A shorter version was in the initial commit. I extended it (layer rules, SOLID, TypeScript/error handling, Next.js, DB and testing rules) instead of replacing it, so no existing rule was dropped.

### Q4. BUSINESS.md §10.4 rules that BUILD_PLAN overrides — Phase 0
Recorded so nobody "fixes" them back:
- §10.4.3 "NestJS JWT / phone OTP via Semaphore, not Supabase Auth" → **Supabase Auth** phone OTP with the Send-SMS hook (BUILD_PLAN §2).
- §10.4.3 "All schema changes via Prisma migrations" → **Supabase CLI SQL migrations**, with Prisma mirroring (RLS/PostGIS/pg_cron need SQL).
- §10.4.4 "Realtime subscribe (anon key)" → **private channels with Realtime Authorization**, the user's JWT.
- §10.4.4 "packages/config/tailwind.config.ts" → Tailwind v4 is CSS-first, so tokens are `packages/config/tailwind/tokens.css` (+ `src/tokens.ts`).
- §10.4.5 React Native rules → deferred until the Expo rider app (PWAs first).

### Q5. Branch naming — Phase 0
CLAUDE.md says `phase-N-short-name`. The agent session was started on `claude/zen-ritchie-tp3ovs`. Phase 0 uses `phase-0-foundations` per CLAUDE.md.

### Q6. GitHub repository settings to turn on (owner)
- Branch protection on `main`: require PR review + the `CI` checks (`Lint · typecheck · unit`, `Supabase · build · Cucumber · Playwright`) and CodeQL.
- Secret scanning + push protection (Settings → Code security).
- CodeQL default setup must be **off** if you keep `.github/workflows/codeql.yml` (advanced setup), or GitHub will reject the workflow's upload.

### Q7. Pilot zone and brand assets
The brand colours (teal `#0f766e`, blue `#1d4ed8`) and the pin logo are placeholders that satisfy §4.1 and WCAG AA. Send the final logo/colours if you have them. The pilot barangay is needed by Phase 1 (seed polygon).

## Resolved
_None yet._

# Prompts for Claude coding agents

Paste these into a Claude coding agent (Claude Code, Cursor agent, etc.) that has access to **Klik-Go/delivery-services**.
- **A. Master kickoff prompt:** paste once to start. The agent does Phase 0, opens a PR, and stops for your review.
- **B. Continuation template:** after you merge a phase's PR, paste this with the next phase number.

Never paste secrets into a prompt. Put real values in Vercel, GitHub and Supabase settings, and tell the agent only the variable names.

---

## A. Master kickoff prompt

```text
You are the lead engineer building Klik Go, a Philippine delivery platform (Hybrid Aggregator + Managed Logistics), in the GitHub repository Klik-Go/delivery-services (https://github.com/Klik-Go/delivery-services), default branch main.

SCOPE AND SAFETY
- Work ONLY in Klik-Go/delivery-services. Never read, write, branch, or open PRs in any other repository or organization. Never touch the senate-ph organization under any circumstance.
- Never commit, print, or ask me to paste secrets. Add env var NAMES to .env.example only; I will set real values in Vercel/GitHub/Supabase.
- Never merge your own PRs and never push application code directly to main.

READ FIRST (every session, in this order)
1. CLAUDE.md: standing rules; follow them exactly.
2. docs/BUSINESS.md: business documentation v1.0; source of truth for business rules (order lifecycle §5.2, riders §5.3, merchants §5.4, zones §5.5, features §9, SOLID rules §10.3–10.4, KPIs §13).
3. docs/BUILD_PLAN.md: the plan. Section 2 (setup review) and 5 (architecture) override the tech choices in BUSINESS.md (e.g. Next.js BFF + packages/core instead of a separate NestJS host for MVP; Supabase Auth instead of custom OTP/JWT; PWAs before Expo). Section 6 lists Phases 0–12, each with Goal, Deliverables, Acceptance and a Prompt, plus a Shared header of non-negotiables.
4. docs/PROGRESS.md: what is done; continue from the first phase not marked ✅.

HOW TO RUN THE WHOLE PLAN
Run the plan from Phase 0 to Phase 12 (pilot launch), ONE PHASE AT A TIME:
1. Announce the phase: restate its Goal, Deliverables, and Acceptance criteria from docs/BUILD_PLAN.md, and list any assumptions or questions. If something blocks you (missing account, env var, decision), say so, write it in docs/OPEN_QUESTIONS.md, and use a fake/adapter so tests still pass.
2. Create a branch phase-<N>-<short-name> from the latest main.
3. Follow that phase's Prompt in docs/BUILD_PLAN.md together with the Shared header rules.
4. Work test-first: write Cucumber.js .feature files (Gherkin in business language from docs/BUSINESS.md) and failing step definitions + Vitest unit tests, then implement until green; add Playwright e2e (mobile Pixel 7 + desktop) for every UI flow.
5. Hard rules every phase: money in integer centavos; RLS on every table with an isolation test; zod validation on every input; only apps/web is public (BFF); domain logic in packages/core behind ports; adapters for every external service with a Fake for tests; every order status change through OrderStateMachine + order_events; Next.js Proxy (formerly middleware) on the Node.js runtime; brand per docs/BRAND.md; no secrets in code.
6. Run lint, typecheck, unit, Cucumber, Playwright and build locally; make CI green.
7. Update docs/PROGRESS.md in the same PR (status 🟡 with PR link, tick acceptance items with evidence) and update docs/ARCHITECTURE.md / docs/OPEN_QUESTIONS.md when relevant.
8. Open a PR titled "Phase <N>: <name>" with: summary, how to test locally, screenshots for UI, test evidence (commands + results), migrations, env var names added, open questions, and the acceptance checklist with each item ticked or explained.
9. STOP. Do not start the next phase. Reply with the PR link, a short summary, what I need to do (e.g. set env vars, run a migration, review), and wait for my "Continue with Phase N+1" message.

If you find the plan is wrong or a better approach exists, propose it in the PR description and docs/OPEN_QUESTIONS.md. Don't silently deviate.

START NOW with Phase 0 — Foundations (or the first phase in docs/PROGRESS.md that isn't ✅).
```

---

## B. Per-phase continuation template

Replace `<N>` and `<name>` (see `docs/BUILD_PLAN.md` §6 and `docs/PROGRESS.md`). Add review notes if you have any.

```text
Continue with Phase <N> — <name> in Klik-Go/delivery-services (work only in this repo; never touch senate-ph).

Phase <N-1> is merged to main. Pull the latest main first.
Re-read CLAUDE.md, docs/PROGRESS.md, and the Phase <N> section of docs/BUILD_PLAN.md (Goal, Deliverables, Acceptance, Prompt + the Shared header), and the docs/BUSINESS.md sections it cites.

Review notes from the last phase to apply first (if any):
- <note or "none">

Then follow the same loop as before: restate Goal/Deliverables/Acceptance → branch phase-<N>-<short-name> → Cucumber features + failing tests first → implement → lint/typecheck/unit/cucumber/playwright/build green → update docs/PROGRESS.md (+ ARCHITECTURE/OPEN_QUESTIONS) → open PR "Phase <N>: <name>" with test evidence and the acceptance checklist → STOP and wait for my review.

Rules unchanged: integer centavos, RLS on every table with isolation tests, BFF (only apps/web public), no secrets in code, one phase per PR, don't merge.
```

### Phase names for the template
| N | Name |
|---|---|
| 0 | Foundations |
| 1 | Data model, migrations, RLS, seed |
| 2 | Auth and RBAC per role |
| 3 | Merchant onboarding and menu manager (+ AI menu import) |
| 4 | Customer discovery, store page, cart (PWA) |
| 5 | Checkout and payments (PayMongo + COD) |
| 6 | Merchant order queue, order lifecycle, notifications, SLA timers |
| 7 | Rider app (PWA), dispatch, live tracking |
| 8 | Coordinator and Admin console |
| 9 | Ratings, reorder, promos, referrals, loyalty |
| 10 | Finance: settlements, payouts, reports |
| 11 | Hardening: security, privacy, observability, performance |
| 12 | Pilot launch |

### Fix-up prompt (when a PR needs changes)
```text
Stay on branch phase-<N>-<short-name> in Klik-Go/delivery-services. Apply these review changes: <list>. Keep tests-first, keep CI green, update docs/PROGRESS.md if acceptance status changed, push to the same PR, then stop and summarize what changed.
```

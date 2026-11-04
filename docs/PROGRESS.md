# Progress

Phases are defined in `docs/BUILD_PLAN.md` §6. Agents update this file in every PR. Tick only what is merged or verified, and link the evidence (PR, CI run, screenshot).

| Phase | Name | Status | PR | Notes |
|---|---|---|---|---|
| — | Docs: BUSINESS, BUILD_PLAN, CLAUDE.md, prompts | ✅ Done | initial commit | |
| 0 | Foundations (monorepo, rules, CI) | ⬜ Not started | | |
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
_Copy the current phase's acceptance criteria from `docs/BUILD_PLAN.md` here and tick them as they pass._

## Business validation (parallel, doc §8)
- [ ] 20–30 customer interviews in the pilot barangay
- [ ] 10–15 merchant surveys (commission tolerance, packaging, subscription interest)
- [ ] 2-week waitlist, target 50 or more sign-ups
- [ ] Real inputs for the unit economics model (rider pay per trip, delivery fee, COD share)

# Klik Go — Delivery Services

Klik Go is a delivery platform for the Philippines, built for barangays and provincial towns, on a Hybrid Aggregator + Managed Logistics model. It starts with food delivery in one pilot zone, then grows into groceries, parcels, pharmacy and B2B.

> Status: planning. No application code yet. See `docs/PROGRESS.md`.

## Docs
| File | What it is |
|---|---|
| `docs/BUSINESS.md` | Business documentation v1.0, the source of truth for business rules |
| `docs/BUILD_PLAN.md` | Setup review, UX direction, business fixes and the phased build plan (Phase 0 → pilot launch) |
| `docs/CLAUDE_PROMPTS.md` | Prompts for coding agents: a master kickoff prompt and a per-phase continuation template |
| `docs/PROGRESS.md` | Phase checklist, updated in every PR |
| `CLAUDE.md` | Standing instructions for AI coding agents |

## Planned stack (MVP)
Next.js (App Router, TypeScript) on Vercel as the only public entry point (BFF) · domain logic in `packages/core` · Supabase (Postgres + PostGIS, Auth, Realtime, Storage, pg_cron) · Prisma · PayMongo (GCash, Maya, cards, QR Ph) + COD · Semaphore SMS · MapLibre + Google Places · Vitest, Cucumber.js and Playwright · GitHub Actions.

## Working agreement
One phase per pull request. Tests are written first (BDD/TDD). Secrets never go in code. Every table has RLS.

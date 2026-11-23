# Pilot launch (Phase 12)

The soft launch: **one pilot barangay, the first 100 invited customers, 5–10 stores, 2–3 riders**
(docs/BUSINESS.md §3.3 Tier 1, §4.2 Phase 2). This page is the checklist, the go/no-go decision
and the current status. Update the status column as items are done (owner initials and date).

Status: ✅ done · 🟡 in progress · ⬜ to do · 👤 owner action.

## 1. What launch needs from the app (done in code)
| Item | Status | Where |
|---|---|---|
| Invite-only gate: customers order only after redeeming a code; capped at 100 customers | ✅ | Settings → `invite_only`; `/admin/invites`; customers enter codes at `/join` (flyer QR codes link to `/join?code=…`) |
| Waitlist import: text a code to the oldest waitlist sign-ups | ✅ | `/admin/invites` → Invite the waitlist (needs SMS, Q13) |
| Pilot scope: food stores only; scheduled orders on/off | ✅ | Settings → `pilot_scope`, `scheduled_orders` |
| Pabili | ✅ off | Built in Phase 13, off by default (Settings → `pabili`, Q38). Surge pricing is not built |
| Free delivery on the first 3 orders (BUSINESS §4.2) | ✅ | `/admin/promos`: a free-delivery campaign limited to customers' first 3 orders |
| KPI dashboard (BUSINESS §13) | ✅ | `/admin/kpis`, reviewed daily |
| System status, uptime checks, error tracking | ✅ | `/admin/system`, `/api/health/ready`, Sentry (docs/runbooks/UPTIME.md) |
| Smoke test against production | ✅ | **Actions → Smoke test (production)** (§5) |
| Runbooks and coordinator training | ✅ | docs/runbooks/, docs/COORDINATOR_GUIDE.md |
| Promotion staging → production | ✅ | **Deploy database migrations** pushes to staging, then production after approval (§2) |

Real stores are **not** seeded: they apply at `/partners` and are approved in `/admin/merchants`,
exactly as after launch.

## 2. Environments and promotion
| | Staging | Production |
|---|---|---|
| Supabase | project `klikgo-staging` (Free or Pro) | project `klikgo` on **Pro**, Point-in-Time Recovery on |
| Vercel | Preview deployments (env vars scoped to Preview point at staging) | Production deployment from `main` |
| GitHub environment | `staging` (no approval) | `production` (required reviewer) |
| Migration secrets | `STAGING_SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_DB_PASSWORD`, `STAGING_SUPABASE_PROJECT_REF` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` |

A PR merges to `main` → Vercel builds production → **Deploy database migrations** applies new
migrations to staging, then waits for approval on `production`. Approve only after checking the
preview on staging. `/api/health/ready` says `outdated` until production's migrations are applied.
Never point a preview at the production database.

## 3. Production checklist (👤 owner)
| # | Item | Status |
|---|---|---|
| P1 | Vercel **Pro** (team), production domain added, HTTPS on, `NEXT_PUBLIC_APP_URL` set to it | ⬜ |
| P2 | Supabase **Pro**, daily backups + **PITR** on, region Singapore | ⬜ |
| P3 | Supabase Auth: Site URL and redirect URLs = the domain (Q13); per-IP limits reviewed (Q12) | ⬜ |
| P4 | Email: a sending domain verified in **Resend** (SPF, DKIM), Supabase Auth → SMTP → Resend, sender `no-reply@<domain>` (staff invites, Q14) | ⬜ |
| P5 | **Semaphore**: account funded, sender name approved, `SEMAPHORE_API_KEY` + `SEMAPHORE_SENDER_NAME` set; the Send-SMS hook secret set in both Supabase and Vercel (Q13) | ⬜ |
| P6 | Placeholder sign-in code **removed** (`PLACEHOLDER_OTP_CODE` unset; it switches off when SMS is on) (Q20, SEC-1) | ⬜ |
| P7 | **PayMongo live** keys and webhook (`PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`), one real ₱20 payment and refund tested (Q22) — or launch cash-only with `online_payments` off | ⬜ |
| P8 | Google Maps key restricted by HTTP referrer (tiles) and API (Places only), `GOOGLE_MAPS_API_KEY` set (Q17) | ⬜ |
| P9 | Scheduler: Vault secrets and `CRON_SECRET` set, `/admin/system` shows jobs running (Q25) | ⬜ |
| P10 | Web Push VAPID keys set (Q25) | ⬜ |
| P11 | `SENTRY_DSN` and `POSTHOG_API_KEY` set, regions chosen, DPAs signed (Q36, SEC-6) | ⬜ |
| P12 | Uptime monitor on `/api/health` and `/api/health/ready`, alerts to the owner's phone (runbooks/UPTIME.md, SEC-5) | ⬜ |
| P13 | Staging project created and a backup restored into it (runbooks/BACKUP_RESTORE.md, SEC-4) | ⬜ |
| P14 | Lawyer review of terms and privacy notice, DPO named, NPC registration if required (Q36, SEC-2) | ⬜ |
| P15 | CPA review of withholding before the first payout (Q35) | ⬜ |
| P16 | Penetration test, or at least a second person's review of docs/SECURITY.md (SEC-7) | ⬜ |
| P17 | Smoke test variables set on the `production` environment (§5) and one green run | ⬜ |
| P18 | First admin bootstrapped, staff invited (coordinator for the pilot zone), everyone's authenticator enrolled | ⬜ |

## 4. Pilot settings on launch day (`/admin/settings`)
1. `invite_only` **on**, `max_customers` 100.
2. `pilot_scope` **on**, categories `food`.
3. `scheduled_orders`: off for the first week (simpler for stores), then on.
4. `online_payments`: on only once P7 is done; otherwise off (cash on delivery only).
5. Zone: only the pilot barangay's zone active; its delivery fee bands set; other zones paused.
6. `merchant_sla` and `dispatch` settings as agreed (Q26, Q29, Q32).
7. Codes: one batch per flyer run and per partner store (e.g. "Flyers Poblacion week 1", "Kape't Tinapay counter"), and the waitlist invited in groups of 20 so stores aren't flooded.

## 5. Smoke test (every deploy and every pilot morning)
**Actions → Smoke test (production)** runs automatically at 07:17 Manila and on demand. It checks
health and readiness, the home and legal pages, that the test store shows at the pilot pin and
prices a cart, and that the test customer can sign in and reach checkout. Tick *place order* to
also place a cash order at the test store and cancel it at once.

Configure on the `production` environment:
- Variables: `SMOKE_BASE_URL` (the domain), `SMOKE_STORE_SLUG` (a test store, kept open, in the
  pilot zone), `SMOKE_LAT`, `SMOKE_LNG` (a pin in the pilot zone).
- Secrets: `SMOKE_CUSTOMER_PHONE` and `SMOKE_OTP_CODE` — a Supabase **test phone number** with a
  fixed code (Authentication → Phone → Test phone numbers). Give the test customer an invite code
  once (they then always pass the gate).

Locally: `pnpm test:bdd -- --tags @smoke` (or with `BASE_URL` pointing at a deployment).

## 6. Dry runs (3 staged days with internal orders)
Each dry run uses the production app with real stores and riders, internal customers only
(team, friends; invited with a "Dry run" batch), and **food actually delivered and paid for**.

| Day | Plan | Pass when | Status |
|---|---|---|---|
| 1 | 2 stores, 1 rider, 5 cash orders spread over lunch; coordinator watches `/admin` | every order delivered; no store misses the 3-minute deadline; the rider sees and follows each job | ⬜ |
| 2 | 4 stores, 2 riders, 10 orders incl. 2 online (if P7), 1 cancellation, 1 rejected order, 1 refund | refund reaches the customer; the cancelled/rejected orders leave nothing in the ledger | ⬜ |
| 3 | all signed stores, 2–3 riders, 20 orders in the lunch peak; run the rehearsals below | KPIs on `/admin/kpis` match the orders; no P0 bug | ⬜ |

Log each day in §9 (orders, problems, fixes). Settle the dry-run week in `/admin/finance` and pay
it out for real, so the payout path is rehearsed too.

### Runbook rehearsals (each once, during dry runs)
| Runbook | Rehearse by | Status |
|---|---|---|
| [Order stuck](runbooks/ORDER_STUCK.md) | Store doesn't accept for 3 minutes; coordinator follows the runbook | ⬜ |
| [Rider no-show](runbooks/RIDER_NO_SHOW.md) | Rider goes offline after accepting; coordinator reassigns | ⬜ |
| [Payment taken, order missing](runbooks/PAYMENT_MISSING_ORDER.md) | Staging: pay on the fake checkout with the webhook blocked; replay it | ⬜ |
| [Refund](runbooks/REFUND.md) | Refund one delivered dry-run order (partial) | ⬜ |
| [Store offline](runbooks/MERCHANT_OFFLINE.md) | Store's phone off during an order | ⬜ |
| [Outage](runbooks/OUTAGE.md) | Turn `online_payments` off and back on; read `/admin/system` | ⬜ |
| [Data incident](runbooks/DATA_INCIDENT.md) | Table-top: walk through the 72-hour NPC steps | ⬜ |

## 7. Go / no-go (BUSINESS §10.6 Phase 7: zero P0 bugs)
Go only if **every** line is yes. The owner decides and records the decision in §9.
- [ ] Zero open P0 bugs (P0: wrong money, lost order, personal data exposed, sign-in impossible, ordering impossible).
- [ ] §3 items P1–P12, P14, P17, P18 done (P13, P15, P16 before the first payout or by end of week 2).
- [ ] 3 dry-run days passed (§6), every runbook rehearsed once.
- [ ] At least 5 stores live with complete menus, hours and payout accounts; at least 2 riders approved with payout accounts.
- [ ] A coordinator trained (docs/COORDINATOR_GUIDE.md) and on duty for every launch-week lunch and dinner.
- [ ] KPI dashboard reviewed on each dry-run day; smoke test green on launch morning.
- [ ] CI green on `main`; the last production migration applied (`/api/health/ready` = ready).

## 8. Daily during the pilot
- 07:17 smoke test (automatic) — check it is green.
- Morning: `/admin/system` (jobs, webhooks, missed deadlines), `/admin/kpis` (yesterday and 7 days).
- Lunch and dinner peaks: coordinator on `/admin` (live board) with the runbooks open.
- Evening: refunds and tickets cleared, cash hand-ins recorded.
- Monday: settle last week (`/admin/finance`), pay out by Friday.
- Weekly KPI review with the targets (BUSINESS §13); NPS survey after week 2 (a simple form to delivered customers).

## 9. Log
| Date | What | Who |
|---|---|---|
| | | |

# Security and privacy (OWASP ASVS L1 pass, Phase 11)

Klik Go holds people's phone numbers, addresses, rider ID documents and money. This page records
the OWASP ASVS 4.0.3 Level 1 pass done in Phase 11: each requirement area, how the app meets it,
and the evidence (tests, code). Items that are not done yet are listed at the end with an id
(`SEC-n`) and an owner. Review this page before launch and after any change to auth, payments or
uploads.

**Result:** no high or critical findings open. 9 open items, all low or owner actions (see
[Open items](#open-items)).

## How to report a problem
Email the owner (contact in the private notice to staff) with steps to reproduce. Do not open a
public issue for a vulnerability. Never paste real customer data or secrets into an issue, a PR
or a chat.

## ASVS Level 1 checklist

Status: ✅ meets L1 · ⚠️ partly (open item) · n/a not applicable.

### V1 Architecture (L1 items)
| Area | Status | How |
|---|---|---|
| One public entry point | ✅ | Browsers and apps call only `/api/*` route handlers in `apps/web` (BFF). Supabase is never called from the browser for writes. |
| Layered, testable design | ✅ | Route handler → service (`packages/core`, ports) → repository/adapter. ESLint stops components and core from importing adapters or the database. |
| Secrets server-only | ✅ | `apps/web/src/server/env.ts` validates them; only `NEXT_PUBLIC_*` reach the browser (Supabase URL and anon key). |

### V2 Authentication
| Area | Status | How |
|---|---|---|
| Customers and riders: phone one-time code | ✅ | Supabase Auth OTP through `/api/auth/otp*`; 6-digit codes; per-phone and per-IP limits (`PhoneOtpService`). |
| Staff: password + TOTP (AAL2) | ✅ | `StaffAuthService`, `MfaService`; staff surfaces require AAL2 (`requireSurface`). Invite-only accounts. |
| Brute force | ✅ | Per-phone code-guess limit, per-account password limit, global API limit in the proxy (`security/api-guard.ts`, `security.feature`). |
| Pre-launch placeholder code | ⚠️ | Off once SMS is on (`SEMAPHORE_API_KEY`); customers only (SEC-1). |
| Password storage | ✅ | Supabase Auth (bcrypt); passwords never logged. |

### V3 Session management
| Area | Status | How |
|---|---|---|
| Cookies | ✅ | `@supabase/ssr` cookies (HttpOnly, Secure in production, SameSite=Lax); the proxy refreshes and verifies the JWT on every request. |
| Sign-out and account deletion end sessions | ✅ | `/api/auth/sign-out`; account deletion removes the sign-in and its sessions (soft delete) and clears the cookies. |
| CSRF | ✅ | Same-site cookies plus an origin check on every state-changing `/api/*` request (`isCrossSiteChange`, `security.feature`). |

### V4 Access control
| Area | Status | How |
|---|---|---|
| Roles from the database, never the client | ✅ | `getSessionUser()` reads `user_roles`; `AuthorizationService` checks in services (defence in depth). |
| Row-level security on every table | ✅ | `rls-coverage.db.test.ts` fails if a table lacks RLS or policies; `rls-visibility` and `rls-writes` prove who sees and changes what (incl. Phase 11 `consents`, `job_runs`). |
| IDOR | ✅ | Ids are UUIDs, validated (`parseIds`); others' orders answer "not found". |
| Admin-only pages | ✅ | `/admin/system`, settings, staff: `ConsoleAccess.platform` (coordinators get 403, `observability.feature`). |

### V5 Validation, sanitisation and encoding
| Area | Status | How |
|---|---|---|
| Input validation | ✅ | Every body, query and segment is zod-parsed with schemas from `packages/types`. |
| Output encoding | ✅ | React escapes output; no `dangerouslySetInnerHTML`; CSP with nonces (no `unsafe-inline` scripts). CodeQL on every PR. |
| SQL injection | ✅ | Prisma and tagged-template raw SQL only (parameters bound); no string-built SQL with input (CodeQL). |
| CSV injection | ✅ | `toCsv` prefixes cells starting with `= + - @` (Phase 10). |
| Open redirects | ✅ | `next` parameters pass `safeNext()` (same-site paths only). |

### V7 Errors and logging
| Area | Status | How |
|---|---|---|
| No internals in responses | ✅ | Unexpected errors become a generic 500 envelope (`jsonError`). |
| Structured logs with request ids | ✅ | pino JSON lines; the request id is attached to every line written while a request runs, services included (`runWithRequestContext`). |
| No personal data in logs or trackers | ✅ | pino redaction of personal fields; Sentry events and browser error reports pass `scrubPii` (phones, emails, long numbers, tokens, address fields) — `pii.test.ts`. |
| Audit trail | ✅ | `audit_logs` for console actions, KYC views, payouts, privacy exports and erasures, KYC purges. |

### V8 Data protection
| Area | Status | How |
|---|---|---|
| Rider ID files | ✅ | Private bucket, 60-second signed links, every view audited; deleted after the retention period (`kyc_retention` setting, background job). |
| Data minimisation | ✅ | Analytics carry ids only (no names, phones or addresses), Do Not Track / GPC honoured; nothing personal is sent to Gemini. |
| Right to access and erasure (RA 10173) | ✅ | `/account`: download all data (JSON) and delete the account (anonymises, keeps financial records) — `privacy.feature`. |
| Consent | ✅ | Agreement to dated versions of the terms and privacy notice is recorded (`consents`); a new version asks again. |
| Legal text | ⚠️ | Templates marked "for lawyer review" (SEC-2). |
| Caching of sensitive responses | ✅ | API responses send `cache-control: no-store`. |

### V9 Communications
| Area | Status | How |
|---|---|---|
| TLS everywhere | ✅ | Vercel and Supabase serve HTTPS only; HSTS header set (`security-headers.ts`). |
| Outbound calls | ✅ | PayMongo, Semaphore, Google, Sentry, PostHog over HTTPS with timeouts. |

### V10 Malicious code / supply chain
| Area | Status | How |
|---|---|---|
| Dependencies | ✅ | Exact versions, `pnpm audit --audit-level high` in CI (Security workflow), Dependabot, install scripts allow-listed (`allowBuilds`). `effect` pinned to a patched version through an override. |
| Secrets in the repository | ✅ | gitleaks scans every PR's commits (Security workflow, `.gitleaks.toml`). |

### V11 Business logic
| Area | Status | How |
|---|---|---|
| Money integrity | ✅ | Integer centavos; balanced ledger enforced by a trigger; payouts frozen once paid; idempotent order placement and webhooks. |
| Abuse limits | ✅ | Promo/referral guards (Phase 9), per-account and per-IP API limits, OTP limits. |

### V12 Files and resources
| Area | Status | How |
|---|---|---|
| Upload type checked from the bytes | ✅ | `verifiedFileType` (magic bytes) for KYC documents, delivery photos and menu imports; a web page renamed to `.jpg` is refused (`security.feature`). |
| Size limits | ✅ | zod limits per route (10 MB documents, 5 MB menu photos) and bucket limits (menu photos: WebP ≤ 200 KB). |
| Served files | ✅ | Private buckets behind signed links; `X-Content-Type-Options: nosniff`. |
| Menu photo bucket | ⚠️ | Direct signed uploads are limited by the bucket (type and size) but not byte-sniffed (SEC-3, low). |

### V13 API
| Area | Status | How |
|---|---|---|
| Rate limits on every public route | ✅ | Proxy: 60 changes/min and 300 reads/min per account, 600 reads/min per IP (CGNAT-friendly); 429 with `Retry-After`. |
| Webhooks | ✅ | Signature verified (HMAC over timestamp and body), idempotent (`webhook_events`). |
| CORS | ✅ | No CORS headers: the API is same-origin only. |

### V14 Configuration
| Area | Status | How |
|---|---|---|
| Security headers | ✅ | CSP (nonce), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `nosniff` (`security-headers.feature`). |
| Environments | ✅ | Fakes (payments, menu reader) refuse to run on Vercel production. |
| Health | ✅ | `/api/health` (liveness), `/api/health/ready` (database migrations and file storage). |

## Open items

| Id | Item | Severity | Owner |
|---|---|---|---|
| SEC-1 | Turn off the placeholder sign-in code: set `SEMAPHORE_API_KEY` (Q20, Q30). | Medium before launch | Owner |
| SEC-2 | Lawyer review of the privacy notice and terms; name the Data Protection Officer and contact; register with the NPC when processing at scale (Q36). | Medium before launch | Owner |
| SEC-3 | Byte-check menu photos after upload (they go straight to the public bucket, limited by type and size). | Low | Dev |
| SEC-4 | Restore a full Supabase backup (with the auth schema) into a staging project and run the smoke checks (runbooks/BACKUP_RESTORE.md). | Medium before launch | Owner |
| SEC-5 | Set up the uptime monitor and alerts (runbooks/UPTIME.md). | Medium before launch | Owner |
| SEC-6 | Set `SENTRY_DSN` and `POSTHOG_API_KEY` in Vercel, choose data regions and sign their DPAs (Q36). | Low | Owner |
| SEC-7 | Penetration test before launch (BUSINESS §12: "pen testing before launch"). | Medium before launch | Owner |
| SEC-8 | Two moderate advisories in ESLint's `minimatch` (dev tooling only, not shipped). Update when ESLint ships the fix. | Low | Dev |
| SEC-9 | Quarterly review of this page and the RLS tests (BUSINESS §12 "quarterly security audit"). | Low | Owner |

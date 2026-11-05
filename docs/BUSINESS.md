# KLIK GO

**Delivery Platform**

Full Business Documentation

Hybrid Aggregator + Managed Logistics Model

Version 1.0  •  July 2026

Confidential — For Internal Use Only

> **DTI-registered name:** Klik Go
>
> **Related docs:** [Overview](overview.md) · [Technical Overview (MVP-first)](technical-overview.md)

---

## Table of Contents

- 1. Executive Summary
- 2. Business Model
- 3. Market Analysis
- 4. Marketing Plan
- 5. Operations Plan
- 6. Financial Plan
- 7. Legal & Compliance
- 8. Market Validation & Surveying
- 9. Application Design
- 10. Technical Implementation
- 11. Implementation Timeline
- 12. Risk Register
- 13. KPI Dashboard
- 14. Appendices

# 1. Executive Summary

Klik Go is a multi-category, geography-agnostic delivery platform built on a Hybrid Aggregator + Managed Logistics model. Starting as a food-delivery aggregator and transitioning into a full-scale delivery platform, Klik Go is designed from day one to serve barangay-level communities all the way up to provincial and national routes without requiring a separate rebuild.

Because the founder is a developer, the platform skips manual social-media ordering and launches immediately with a purpose-built application — compressing the conventional two-phase growth model into a single, software-first launch.

## 1.1 Vision

To be the most trusted last-mile delivery platform in the Philippines — accessible in every barangay, reliable across every province, and scalable to every delivery category.

## 1.2 Mission

To connect merchants, riders, and customers through a transparent, technology-driven platform that reduces delivery costs, empowers local entrepreneurs, and builds dignified livelihoods for Filipino riders.

## 1.3 Key Success Factors

- Software-first launch eliminates Facebook/Viber ordering friction and enables real-time tracking from day one
- Hybrid model: marketplace aggregator on the merchant side, managed dispatch on the logistics side
- Zone-based rollout: each barangay/municipality is a self-contained delivery zone replicated as growth demands
- Category-expansion roadmap: food → groceries → parcels → pharmacy → B2B freight
- SOLID-principled codebase built in Cursor IDE: clean, testable, and maintainable as the team grows

# 2. Business Model

Klik Go operates as a two-sided marketplace with a managed logistics layer. This means the platform owns neither the food nor the goods, but does own the ordering system, the dispatch engine, and the customer relationship.

## 2.1 Model Type: Hybrid Aggregator + Managed Logistics

| Layer | What Klik Go owns | What partners own |
| --- | --- | --- |
| Merchant side | Listing, menu management, order routing, commission | Food, inventory, preparation |
| Customer side | App, UX, payment processing, loyalty | Purchase decision |
| Logistics side | Dispatch algorithm, rider app, tracking, SLA | Their motorcycle (freelance riders) |
| Data side | All transaction data, analytics dashboard, pricing engine | Nothing |

## 2.2 Revenue Streams

| Revenue stream | How it works | Typical rate (PH market) |
| --- | --- | --- |
| Commission per order | % of order value charged to merchant | 15–25% |
| Customer delivery fee | Fixed or dynamic fee paid by the customer | ₱30–₱120 per order |
| Merchant subscription | Optional monthly plan for premium listing and analytics | ₱500–₱3,000/month |
| Surge pricing margin | Platform retains a margin during peak-hour surge pricing | 10–20% of surge delta |
| In-app advertising | Banner/feature slots sold to merchants wanting visibility | ₱1,000–₱5,000/month |
| B2B delivery contracts | Fixed monthly contracts with businesses for bulk deliveries | Negotiated per volume |

## 2.3 Cost Structure

- Rider incentives and bonuses (primary variable cost)
- Cloud infrastructure: server hosting, CDN, SMS/push notifications
- Payment gateway fees (GCash, Maya, Stripe PH): 1.5–2.5% per transaction
- Customer acquisition: Facebook Ads, referral rewards, promo credits
- Operations: coordinator salaries, customer support, merchant onboarding
- Compliance: DTI/SEC fees, BIR registration, insurance

# 3. Market Analysis

## 3.1 Target Market

Klik Go targets three primary market segments simultaneously:

### Segment A — Merchants (Supply Side)

- Small to medium restaurants without existing delivery setups
- Sari-sari stores, grocery shops, and convenience stores
- Pharmacies and health product retailers
- Bakeries, karinderias, and home-based food businesses (MSME)
- Local retailers in areas not served by GrabFood or Foodpanda

### Segment B — Customers (Demand Side)

- Urban and peri-urban residents aged 18–45
- Provincial and barangay-level consumers currently underserved by major apps
- Offices and businesses needing regular food and supply deliveries
- Elderly and mobility-limited residents relying on delivery for daily necessities

### Segment C — Riders (Logistics Side)

- Motorcycle owners looking for supplemental or primary income
- Tricycle and bicycle riders in dense barangay zones
- Delivery drivers transitioning from informal transport

## 3.2 Competitive Landscape

| Competitor | Strength | Weakness | Klik Go advantage |
| --- | --- | --- | --- |
| GrabFood | Brand recognition, large rider pool | Metro-centric, high commission (30%) |  |
| Klik Go: lower commission
+ provincial reach |  |  |  |
| Foodpanda | Restaurant variety, promos | Limited provincial presence, app-only |  |
| Klik Go: barangay-level coverage |  |  |  |
| Lalamove | Strong B2B, large vehicle types | Not food-focused, no restaurant aggregation |  |
| Klik Go: food + parcel in one app |  |  |  |
| Local riders / FB ordering | Community trust, cash-friendly | No tracking, unreliable, no SLA |  |
| Klik Go: trust + tech + community feel |  |  |  |

## 3.3 Geographic Rollout Strategy

Klik Go uses a zone-first, not city-first, expansion strategy. Each zone is a self-contained delivery unit.

- Tier 1 (Months 1–3): Single pilot barangay. 5–10 merchants, 2–3 riders, manual coordinator oversight.
- Tier 2 (Months 3–6): Adjacent barangays. 20–40 merchants, 5–10 riders, automated dispatch.
- Tier 3 (Months 6–12): Full municipality/city coverage. 50+ merchants, dedicated fleet, multi-category.
- Tier 4 (Year 2+): Provincial network. Intercity dispatch, freight partnerships, B2B contracts.
- Tier 5 (Year 3+): National/wide-area. 3PL partnerships, inter-island freight, enterprise accounts.

# 4. Marketing Plan

## 4.1 Brand Identity

- Name: Klik Go (DTI-registered)
- Tagline: 'Delivered to your door, wherever you are.'
- Brand values: speed, reliability, community, accessibility
- Visual identity: bold primary color (blue or teal), clean sans-serif typography, map/pin motif
  - Final identity (owner decision, 5 Nov 2026): the **KGo** logo, yellow (#ffd43b) Lilita One lettering on a blue (#228be6) tile. Full guide: `docs/BRAND.md`.
- Tone of voice: friendly, local, dependable — not corporate

## 4.2 Go-to-Market Strategy

### Phase 1 — Pre-launch (Month −1)

- Build a waitlist landing page before the app goes live
- Post in local Facebook groups, community pages, and barangay Viber chats — not for ordering, but for awareness
- Personally visit 20–30 local restaurants and sign the first 10 merchant partners
- Recruit and train the first 5 riders
- Offer founding merchant partners 0% commission for the first 3 months in exchange for exclusivity

### Phase 2 — Launch (Month 1)

- Soft launch: invite-only for first 100 customers in the pilot barangay
- Offer free delivery on first 3 orders per customer (subsidized from marketing budget)
- Distribute flyers with QR codes linking to the app download at partner restaurants
- Run ₱500/day Facebook and TikTok Ads targeting the pilot barangay by location
- Activate a referral program: ₱50 credit for every friend who places their first order

### Phase 3 — Growth (Month 2 onwards)

- Weekly TikTok content: behind-the-scenes with riders, restaurant spotlights, delivery time challenges
- Monthly ‘Klik Go Merchant of the Month’ feature to incentivize partner engagement
- Loyalty stamps: every 10th order earns a free delivery
- B2B outreach: approach offices, schools, and factories for recurring lunch delivery contracts
- Expand Facebook Ads spend proportionally with revenue growth

## 4.3 Marketing Budget Allocation

| Channel | Monthly budget (PHP) | Expected outcome |
| --- | --- | --- |
| Facebook/Instagram Ads | ₱2,000–₱5,000 | 500–1,500 new app installs |
| TikTok content (organic) | ₱0 (time investment) | Brand awareness, viral potential |
| Referral program credits | ₱1,000–₱3,000 | 20–60 new referred customers |
| Flyers and printed QR codes | ₱500–₱1,500 | Local foot traffic conversion |
| Promo delivery credits | ₱2,000–₱5,000 | Retention of first-time users |
| Total | ₱5,500–₱14,500 | — |

# 5. Operations Plan

## 5.1 Organizational Structure

At launch, the founder wears multiple hats. As the business grows, roles are progressively delegated.

| Role | Month 1–3 | Month 4–6 | Month 7–12 |
| --- | --- | --- | --- |
| Founder/CEO | All roles | Strategy, tech, partnerships | Strategy only |
| Zone Coordinator | Founder | 1 hired coordinator per zone | Team lead per city |
| Customer Support | Founder + WhatsApp/Viber | 1 part-time support agent | Dedicated support team |
| Marketing | Founder (organic content) | Freelance content creator | In-house marketing |
| Finance/Accounting | Founder + bookkeeping app | Part-time bookkeeper | Full-time accountant |
| Riders | 3–5 freelancers | 10–20 per zone | Mixed: employed + freelance |

## 5.2 Order Lifecycle

Every order follows a standardized lifecycle managed by the platform:

- Step 1: Customer places order via mobile app (iOS/Android)
- Step 2: Platform routes order to the merchant's merchant dashboard
- Step 3: Merchant confirms and begins preparation; estimated ready time sent to system
- Step 4: Dispatch engine assigns the nearest available rider automatically
- Step 5: Rider picks up order; real-time GPS tracking activates for customer
- Step 6: Delivery confirmed; payment settled; ratings prompt sent to both parties
- Step 7: Commission auto-deducted; rider earnings logged; payout batch processed weekly

## 5.3 Rider Management

- Onboarding: ID verification, motorcycle registration, live photo KYC, app training
- Compensation: base per-trip rate + distance bonus + peak-hour surge
- Performance: star rating system; riders below 3.5 stars enter a coaching queue
- Payout schedule: weekly GCash/Maya payout every Friday
- Incentives: top-rider badge, bonus for completing 50+ trips/week, referral bonus for new rider sign-ups

## 5.4 Merchant Management

- Onboarding: store registration, menu upload, photo guidelines, commission agreement signing
- Dashboard: real-time order queue, sales analytics, payout tracker, menu editor
- SLA: merchants must confirm orders within 3 minutes or order is auto-cancelled with penalty
- Payouts: weekly settlement of order revenue minus commission, direct to merchant bank or GCash

## 5.5 Zone Hub Model

Each delivery zone operates as a mini-franchise unit with the following structure:

- 1 Zone Coordinator (part-time to full-time depending on volume)
- A rider pool of 3–20 depending on zone size
- A designated hub location (can be the coordinator's home initially)
- Dedicated merchant cluster: restaurants and shops within a defined service radius
Service radius: 3–5 km for barangay zones; 8–15 km for city zones; 20–40 km for provincial zones.

# 6. Financial Plan

## 6.1 Startup Costs

| Item | Estimated cost (PHP) | Notes |
| --- | --- | --- |
| DTI/SEC business registration | ₱2,000–₱5,000 | DTI for sole prop; SEC for corp/partnership |
| Barangay clearance + Mayor's permit | ₱1,500–₱3,000 | Varies by LGU |
| BIR registration + OR/invoices | ₱500–₱1,500 | TIN, book of accounts, OR printing |
| Cloud infrastructure (3 months) | ₱3,000–₱6,000 | Supabase free/paid tier + NestJS hosting + CDN |
| Domain + SSL + email | ₱500–₱1,500 | Annual |
| App Store + Play Store accounts | ₱1,600 + ₱1,400 | One-time developer accounts |
| Initial marketing budget (3 months) | ₱5,000–₱15,000 | Flyers, ads, promo credits |
| Merchant onboarding materials | ₱1,000–₱3,000 | Printed kits, stickers, QR stands |
| Contingency (10%) | ₱1,500–₱3,500 | Buffer for unexpected costs |
| TOTAL ESTIMATED STARTUP COST | ₱16,600–₱40,000 | Within ₱10K–₱50K budget |

## 6.2 Monthly Operating Cost Projection (Zone of 1 City)

| Cost item | Month 1–3 | Month 4–6 | Month 7–12 |
| --- | --- | --- | --- |
| Cloud + tech infra | ₱2,000 | ₱4,000 | ₱8,000 |
| Marketing spend | ₱5,000 | ₱10,000 | ₱20,000 |
| Rider incentive bonuses | ₱3,000 | ₱8,000 | ₱15,000 |
| Zone coordinator salary | ₱0 (founder) | ₱12,000 | ₱15,000 |
| Customer support | ₱0 (founder) | ₱6,000 | ₱10,000 |
| Payment gateway fees | ₱1,000 | ₱3,000 | ₱8,000 |
| Accounting / bookkeeping | ₱0 (founder) | ₱3,000 | ₱6,000 |
| Miscellaneous / contingency | ₱1,000 | ₱2,000 | ₱4,000 |
| TOTAL MONTHLY OPEX | ₱12,000 | ₱48,000 | ₱86,000 |

## 6.3 Revenue Projection (Conservative, 1 Zone)

| Metric | Month 1 | Month 3 | Month 6 | Month 12 |
| --- | --- | --- | --- | --- |
| Daily orders | 10–20 | 50–80 | 150–250 | 400–600 |
| Avg. order value (PHP) | ₱250 | ₱280 | ₱300 | ₱320 |
| Commission (20% avg) | ₱500–₱1,000/day | ₱2,800–₱4,480/day | ₱9,000–₱15,000/day | ₱25,600–₱38,400/day |
| Delivery fee revenue | ₱500–₱1,000/day | ₱2,500–₱4,000/day | ₱7,500–₱12,500/day | ₱20,000–₱30,000/day |
| Estimated monthly gross | ₱30,000–₱60,000 | ₱160,000–₱256,000 | ₱495,000–₱825,000 | ₱1.4M–₱2.1M |

## 6.4 Break-Even Analysis

Based on the cost and revenue projections above, break-even at the pilot zone level is estimated at:

- Minimum orders needed daily to cover Month 1 OPEX (₱12,000): approximately 24–48 orders per day
- This is achievable within the first 2–4 weeks with 8–10 active merchant partners
- Full profitability (after founder salary equivalent) expected by Month 4–5
All projections are conservative estimates based on Philippine urban market data. Actual results depend on execution quality, merchant partner quality, and local demand.

## 6.5 Accounting Setup

### Recommended Tools

- Wave Accounting (free) or QuickBooks Simple Start (₱800/month) for bookkeeping
- Google Sheets for early-stage daily order reconciliation
- GCash for Business or Maya Business for merchant and rider payouts
- BIR-compliant official receipts (printed or e-invoicing via certified providers)

### Chart of Accounts (Simplified)

- Income: Commission Revenue, Delivery Fee Revenue, Subscription Revenue, Ad Revenue
- Cost of Revenue: Rider incentives, payment gateway fees, promo credits issued
- Operating Expenses: Cloud infra, marketing, salaries, merchant kits, office/hub rent
- Taxes: VAT (if VAT-registered), income tax, witholding tax on rider payments

### Tax Obligations (Philippines)

- BIR Form 2551Q: Quarterly percentage tax (if non-VAT, gross receipts below ₱3M/year)
- BIR Form 1701 / 1702: Annual income tax return
- BIR Form 1601-C: Monthly withholding tax remittance if you have employees
- BIR Form 2307: Certificate of creditable withholding for merchant payouts
Consult a CPA or enrolled agent once monthly gross revenue exceeds ₱100,000 to ensure full BIR compliance and optimal tax structure.

# 7. Legal & Compliance

## 7.1 Business Registration Checklist

| Step | Agency | Document | Estimated cost |
| --- | --- | --- | --- |
| 1. Business name registration | DTI (sole prop) or SEC (corp) | Certificate of Business Name / Articles of Inc. | ₱200–₱2,000 |
| 2. Barangay business clearance | Barangay Hall | Barangay Clearance | ₱200–₱500 |
| 3. Mayor’s / Business permit | City/Municipal Hall | Mayor’s Permit | ₱500–₱2,000 |
| 4. BIR registration | BIR Revenue District Office | COR (Certificate of Registration), TIN | ₱500–₱1,000 |
| 5. Books of accounts | BIR | Stamped journals and ledgers | ₱300–₱600 |
| 6. Official receipts printing | BIR-accredited printer | OR booklet | ₱400–₱1,000 |

## 7.2 Key Contracts and Agreements

- Merchant Partnership Agreement (MOA): commission rate, payout schedule, exclusivity terms, SLA obligations, termination clauses
- Rider Service Agreement: classification as independent contractor (not employee), rate schedule, conduct policy, data handling
- Customer Terms of Service and Privacy Policy: GDPR/NPC-compliant; data collected, how used, deletion rights
- Data Privacy Act Compliance (RA 10173): register as personal information controller with the National Privacy Commission (NPC) once you process personal data at scale
Have all contracts reviewed by a Philippine-licensed lawyer before your first merchant signs. A one-time legal review costs ₱3,000–₱10,000 and protects you significantly.

## 7.3 Insurance Considerations

- Rider accident insurance: consider partnering with a micro-insurance provider for per-trip coverage
- General liability insurance: covers platform liability for delivery incidents
- Consider PhilCare or Maxicare group health insurance as a rider retention benefit once you have 10+ regular riders

# 8. Market Validation & Surveying

## 8.1 Pre-Launch Validation Activities

Before writing a single line of production code or signing the first merchant, validate your assumptions:

- Conduct 20–30 customer interviews in your target barangay: Do they order food online? What do they hate about current options? What would make them switch?
- Survey 10–15 local restaurant owners: Are they interested in delivery? What commission would they accept? Do they have packaging?
- Mystery-shop competitor deliveries: Order from GrabFood/Foodpanda 3–5 times and document pain points, timing, and quality
- Run a 2-week pre-launch waitlist: If you can’t get 50 sign-ups organically, the demand signal is weak — investigate before investing

## 8.2 Merchant Survey Template

| Question | What you’re learning |
| --- | --- |
| Do you currently offer delivery? How? | Existing behavior and competition |
| How many delivery orders do you receive per day? | Volume baseline |
| What commission rate would be acceptable? | Price sensitivity |
| Do you have packaging for delivery? | Operational readiness |
| Would you pay ₱500–₱1,500/month for a listing? | Willingness to pay for premium features |
| What is your biggest problem with delivery today? | Pain point to solve first |

## 8.3 Ongoing Metrics to Track

- Customer NPS (Net Promoter Score): monthly survey, target >50
- Merchant satisfaction rate: quarterly survey, target >80% satisfied
- Rider retention rate: % of riders still active after 60 days, target >70%
- Order cancellation rate: target <5% platform-side cancellations
- Average delivery time: target <35 minutes for food in urban zones

# 9. Application Design

## 9.1 Platform Components

Klik Go consists of four distinct application surfaces, each targeting a different user persona:

| App surface | Users | Platform | Primary function |
| --- | --- | --- | --- |
| Customer app | End customers | iOS + Android (React Native / Expo) | Browse, order, pay, track |
| Merchant dashboard | Restaurant/store owners | Web (Next.js) + mobile-responsive | Manage orders, menu, earnings |
| Rider app | Delivery riders | iOS + Android (React Native / Expo) | Accept jobs, navigate, confirm delivery |
| Admin panel | Klik Go operations team | Web (Next.js; same app as merchant for MVP) | Zone management, analytics, support, settings |

## 9.2 Core Feature Set by Surface

### 9.2.1 Customer App

- Onboarding: phone number OTP sign-up, address setting with GPS pin
- Home: nearby merchants by category (food, grocery, pharmacy, parcels)
- Merchant detail: menu browsing, item customization, add to cart
- Checkout: address confirmation, payment method (GCash, Maya, COD, card), tip option
- Order tracking: real-time GPS map with rider position, ETA countdown
- Order history: reorder button, rating and review, receipt download
- Loyalty: stamp card, referral code, promo code input
- Profile: saved addresses, payment methods, notification preferences

### 9.2.2 Merchant Dashboard

- Order queue: incoming orders with accept/reject + prep time input
- Menu manager: add/edit items, toggle availability, upload photos, set pricing
- Analytics: daily/weekly/monthly revenue, order volume, peak hours chart
- Payout tracker: commission breakdown, settlement history, download CSV
- Store settings: operating hours, service radius, holiday closures
- Promotions: create discount codes, set item-level promos

### 9.2.3 Rider App

- Status toggle: online/offline, current location broadcast
- Job offer: incoming delivery request card with pickup location, destination, estimated fare
- Navigation: deep link to Google Maps or Waze with pre-filled destination
- Delivery flow: picked up confirmation, OTP delivery confirmation (for high-value orders)
- Earnings tracker: today's trips, total earnings, weekly payout preview
- Performance: star rating, trip count, badges, tier status

### 9.2.4 Admin Panel

- Zone manager: create/edit delivery zones with polygon map drawing
- Merchant management: onboarding queue, status, commission override, suspension
- Rider management: KYC queue, status, rating, manual assignment
- Order management: live order map, manual reassignment, cancellation management
- Analytics: platform-wide GMV, take rate, zone performance heatmap
- Finance: commission ledger, payout batches, dispute management
- System settings: surge rules, fee tables, notification templates, feature flags

## 9.3 Database Schema Overview

| Table / Entity | Key fields | Relationships |
| --- | --- | --- |
| users | id, phone, name, role, address_json, status | Has many orders, addresses |
| merchants | id, user_id, name, category, location, commission_rate, status | Has many menu_items, orders |
| menu_items | id, merchant_id, name, price, category, available, photo_url | Belongs to merchant |
| riders | id, user_id, vehicle_type, status, rating, zone_id | Has many deliveries |
| orders | id, customer_id, merchant_id, rider_id, status, total, fee, items_json, timestamps | Belongs to customer, merchant, rider |
| delivery_zones | id, name, polygon_json, base_fee, surge_multiplier, coordinator_id | Has many merchants, riders |
| payments | id, order_id, method, amount, status, gateway_ref | Belongs to order |
| ratings | id, order_id, from_user_id, to_entity_type, to_entity_id, score, comment | Belongs to order |

# 10. Technical Implementation

## 10.1 Technology Stack

| Layer | Technology | Rationale |
| --- | --- | --- |
| Mobile apps | React Native (Expo) | Single codebase for iOS + Android; Expo simplifies build/OTA updates |
| Web (merchant + admin) | Next.js (App Router) + TypeScript | One web app with role-based route groups; Vercel-friendly; shared React ecosystem with Expo |
| Backend API | NestJS (TypeScript) | Modular architecture and built-in DI map cleanly to SOLID; clear boundaries for orders, payments, dispatch |
| Database | Supabase Postgres via Prisma | Hosted Postgres with migrations in-repo; relational integrity for orders/payments |
| Real-time | Supabase Realtime | Live order status, throttled GPS tracking, dispatch events (NestJS writes; clients subscribe) |
| File storage | Supabase Storage | Menu photos, merchant logos, rider KYC documents |
| Maps + routing | Google Maps Platform (Places, Directions, Distance Matrix) | Best PH map coverage; Waze redirect for rider navigation |
| Payments | PayMongo (GCash, Maya, cards) or Xendit | Both support PH e-wallets natively with simple API |
| Push notifications | Firebase Cloud Messaging (FCM) | Covers both iOS and Android; free tier generous |
| SMS / OTP | Semaphore (PH) via NestJS Auth | Local PH SMS gateway; NestJS owns OTP + JWT (Supabase Auth not used for MVP) |
| CI/CD | GitHub Actions | Automated test + deploy pipeline |
| Hosting | Railway.app or Render (NestJS); Vercel (Next.js); Supabase cloud; Expo EAS (mobile) | Cost-effective, minimal DevOps overhead for a solo developer |

> **Note:** Redis is deferred past MVP. Dispatch presence and queues start on Postgres + Supabase Realtime; add Redis later if volume requires it. See [technical-overview.md](technical-overview.md).

## 10.2 Repository Structure

Use a monorepo structure to share types and utilities across all surfaces. The tree below is the **end-state** layout.

> **MVP adjustment:** Start with `apps/api` (NestJS), `apps/web` (Next.js merchant + thin admin), and `apps/customer-app` (Expo) plus Supabase/Prisma. Add `rider-app` and shared `packages/*` as reuse appears. See [technical-overview.md](technical-overview.md).

```
klik-go/
  apps/
    customer-app/        (React Native / Expo)
    rider-app/           (React Native / Expo)
    web/                 (Next.js — merchant + admin)
    api/                 (NestJS)
  packages/
    types/               (Shared TypeScript interfaces)
    utils/               (Shared utility functions)
    ui/                  (Shared component library)
    config/              (ESLint, Prettier, tsconfig base)
  prisma/                (Schema + migrations for Supabase Postgres)
  .cursor/
    rules/               (Cursor AI rules per project)
  turbo.json             (Turborepo task runner)
  package.json           (Root workspace)
```

## 10.3 SOLID Principles in Practice

Every module in the Klik Go codebase must adhere to SOLID principles. The following provides concrete guidance for the Cursor AI agent and all developers.

### S — Single Responsibility Principle

Each class, service, or module does exactly one thing and has one reason to change.

- Good: OrderService handles order creation and status transitions only
- Good: PaymentService handles payment gateway calls only
- Bad: OrderService that also sends SMS, calculates delivery fees, AND logs analytics
- Fix: extract NotificationService, PricingService, AnalyticsService

### O — Open/Closed Principle

Software entities should be open for extension but closed for modification.

- Good: A PaymentGateway interface implemented by PayMongoAdapter and XenditAdapter — adding a new gateway means adding a new adapter, not editing existing code
- Good: DeliveryFeeStrategy interface with FixedFeeStrategy, DistanceFeeStrategy, SurgeFeeStrategy implementations
- Bad: A switch statement inside OrderService checking payment method string to decide which API to call

### L — Liskov Substitution Principle

Subtypes must be substitutable for their base types without altering correctness.

- Good: Any class implementing the NotificationSender interface (SMSNotifier, PushNotifier, EmailNotifier) can be injected into OrderService without OrderService knowing which one it is
- Bad: A MockPaymentGateway that implements PaymentGateway but throws ‘not implemented’ for refunds — breaks LSP

### I — Interface Segregation Principle

Clients should not be forced to depend on interfaces they do not use.

- Good: Separate IReadableOrderRepository and IWriteableOrderRepository interfaces; the analytics service only gets IReadableOrderRepository
- Bad: One giant IOrderRepository with 20 methods that every consumer must implement fully

### D — Dependency Inversion Principle

High-level modules should not depend on low-level modules. Both should depend on abstractions.

- Good: OrderService receives a PaymentGateway interface via NestJS constructor injection, not a concrete PayMongoClient
- Good: Use NestJS module providers to wire dependencies (custom tokens for repository/gateway interfaces)
- Bad: new PayMongoClient() called directly inside OrderService

## 10.4 Cursor IDE Setup

### 10.4.1 .cursor/rules/ Directory Structure

Create a rules file for each layer of the application to guide the Cursor AI agent consistently:

```
.cursor/rules/
  global.mdc          ← Applies to all files
  api.mdc             ← NestJS API rules
  nextjs.mdc          ← Next.js web rules
  react-native.mdc    ← Mobile app rules
  database.mdc        ← Prisma + Supabase migration rules
  testing.mdc         ← Test writing rules
```

### 10.4.2 global.mdc (Applies to all files)

```markdown
---
description: Global Klik Go coding standards
globs: ['**/*.ts', '**/*.tsx']
---

# Klik Go Global Rules

## Architecture
- Follow SOLID principles on every file you create or edit
- Use NestJS dependency injection for all service dependencies in apps/api
- Never instantiate services with `new` inside other services
- All business logic lives in NestJS services, never in controllers or UI components
- All external API calls live in adapters or repositories, never in services as concrete SDKs inlined

## TypeScript
- Strict mode is always on. Never use `any`; use `unknown` and narrow it
- All function parameters and return types must be explicitly typed
- Use interfaces for public contracts; types for unions and utility types
- Enums only for values with business meaning (OrderStatus, PaymentMethod)

## Error handling
- All async functions must be wrapped in try/catch or return Result<T, E> types
- Never swallow errors silently; always log with context
- Use custom error classes (AppError, ValidationError, NotFoundError)

## Naming
- Files: kebab-case (order-service.ts)
- Classes: PascalCase (OrderService)
- Functions/variables: camelCase (createOrder)
- Constants: SCREAMING_SNAKE_CASE (MAX_DELIVERY_RADIUS_KM)
- Interfaces: prefix with I only for repository and gateway contracts (IOrderRepository)

## Comments
- No comments explaining WHAT the code does; the code should be self-documenting
- Comments only for WHY a non-obvious decision was made
- Every public function must have a JSDoc comment
```

### 10.4.3 api.mdc (NestJS API rules)

```markdown
---
description: NestJS API layer rules
globs: ['apps/api/**/*.ts']
---

# NestJS API Layer Rules

## Layer architecture (strict order)
  Controller → Service → Repository / Adapter → Prisma / external API

- Controllers: validate input (Zod or class-validator DTOs), call one service method, return HTTP response
- Services: orchestrate business logic; no raw Prisma in controllers; no HTTP calls to gateways directly
- Repositories: all DB access via Prisma; return domain objects, not raw rows when mapping helps
- Adapters: all external API calls (PayMongo, Semaphore, Maps, FCM, Supabase Storage); implement interfaces
- Wire dependencies with NestJS DI (custom tokens for interfaces)

## Database
- Use Prisma against Supabase Postgres; never string-interpolate user input into SQL
- All schema changes via Prisma migrations; never run raw ALTER TABLE in production code
- Supabase service-role key only on the NestJS server; never expose to clients

## API design
- RESTful routes: plural nouns, no verbs (GET /orders not GET /getOrders)
- All responses: { data, error, meta } envelope
- Auth: NestJS JWT Bearer on all protected routes; phone OTP via Semaphore (not Supabase Auth for MVP)
- Rate limiting: apply to all public auth endpoints

## Security
- Validate and sanitize all inputs before they touch the service layer
- Store secrets in environment variables only; never hardcode credentials
- Passwords hashed with bcrypt (cost factor 12+); never store plaintext
```

### 10.4.4 nextjs.mdc (Web frontend rules)

```markdown
---
description: Next.js web frontend rules
globs: ['apps/web/**']
---

# Next.js Web Rules

## App structure
- App Router only; merchant and admin under role-based route groups (e.g. /merchant, /admin)
- Server Components by default; use Client Components for interactive dashboards and Realtime
- One component per file; filename matches component name
- Components do: render UI and handle local UI state only
- Components do NOT: contain payment/dispatch business logic (that lives in NestJS)

## State management
- Server state: TanStack Query for NestJS API calls and caching
- Global client state: Zustand (keep stores small and focused)
- Local UI state: useState / useReducer inside the component
- Order/status live updates: Supabase Realtime subscribe (anon key); writes go through NestJS

## API calls
- All mutating/business API calls go through NestJS client helpers (one module per entity)
- Never call the Supabase service role from the browser
- Always handle loading, error, and empty states explicitly

## Styling
- Tailwind CSS utility classes; no inline styles; no CSS modules
- Use the design token config in packages/config/tailwind.config.ts
- Never hardcode colors or spacing values inline

## Forms
- React Hook Form for all forms
- Zod schema for validation (shared from packages/types where possible)
```

### 10.4.5 react-native.mdc (Mobile app rules)

```markdown
---
description: React Native mobile app rules
globs: ['apps/customer-app/**', 'apps/rider-app/**']
---

# React Native Rules

## Performance
- Use React.memo on list item components to prevent unnecessary re-renders
- FlatList for all lists of >10 items; never map() into ScrollView for long lists
- useCallback for all functions passed to child components or FlatList renderItem
- Image components: always specify explicit width/height; use expo-image for caching

## Navigation
- Expo Router (file-based routing); never use React Navigation directly
- Navigation lives in /app directory following Expo Router conventions
- Type all route params; never pass objects through navigation params (use IDs)

## Device APIs
- Location: expo-location with foreground permission only at launch; background for riders
- Push notifications: expo-notifications wrapping FCM
- Biometrics: expo-local-authentication for payment confirmation

## Offline handling
- All network calls must handle offline gracefully (show cached data + offline banner)
- Use NetInfo from @react-native-community/netinfo to detect connectivity
```

### 10.4.6 testing.mdc (Test rules)

```markdown
---
description: Testing standards
globs: ['**/*.test.ts', '**/*.spec.ts']
---

# Testing Rules

## Coverage targets
- Services: 90% line coverage minimum
- Repositories: 80% minimum (test with real test DB, not mocks)
- Controllers: 70% minimum (happy path + validation failure)
- React components: 60% minimum (critical user flows)

## Test structure (AAA pattern)
  // Arrange: set up data and mocks
  // Act: call the function under test
  // Assert: verify the outcome

## Rules
- Unit tests: mock all external dependencies (DB, APIs, email)
- Integration tests: use a real test database (Docker Compose in CI)
- Test file lives next to the file it tests (order-service.test.ts)
- Test names: describe what it does, not what it is
  Good: 'creates order and deducts stock when payment succeeds'
  Bad: 'test createOrder'
- Never test implementation details; test observable behavior
```

## 10.5 Backend API Layer Architecture

The following illustrates the SOLID-aligned NestJS architecture for a typical API feature (e.g., creating an order):

```typescript
// Controller (apps/api/src/orders/orders.controller.ts)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createOrder(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const dto = CreateOrderSchema.parse(body); // Zod validation
    const order = await this.orderService.createOrder(dto, user.id);
    return { data: order };
  }
}

// Service (apps/api/src/orders/order.service.ts)
// Responsibility: business logic only
// Depends on abstractions (interfaces), never on concrete implementations
@Injectable()
class OrderService {
  constructor(
    @Inject(ORDER_REPOSITORY) private orderRepo: IOrderRepository,
    @Inject(PAYMENT_GATEWAY) private paymentGateway: IPaymentGateway,
    @Inject(NOTIFICATION_SENDER) private notifier: INotificationSender,
    private pricingService: PricingService
  ) {}

  async createOrder(dto: CreateOrderDto, customerId: string): Promise<Order> {
    const fee = await this.pricingService.calculate(dto);
    const payment = await this.paymentGateway.charge(dto.paymentMethod, dto.total + fee);
    const order = await this.orderRepo.create({ ...dto, customerId, fee, paymentId: payment.id });
    await this.notifier.send(order.merchantId, 'new_order', order);
    return order;
  }
}

// Repository (apps/api/src/orders/order.repository.ts)
// Responsibility: Prisma / Supabase Postgres access only
@Injectable()
class OrderRepository implements IOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateOrderData): Promise<Order> {
    const row = await this.prisma.order.create({ data: OrderMapper.toPrisma(data) });
    return OrderMapper.toDomain(row);
  }
}
```

## 10.6 Development Phases and Milestones

The table below is the **full-platform aspirational plan**. For solo-founder execution, prefer the shorter MVP-first milestones in [technical-overview.md](technical-overview.md) (food-only, thinner admin, deferred rider polish and multi-category).

| Phase | Duration | Deliverable | Go/No-go criteria |
| --- | --- | --- | --- |
| 0 — Setup | Week 1 | Monorepo, Cursor rules, CI/CD pipeline, DB schema v1 | All environments running; DB connects |
| 1 — Auth + Core | Weeks 2–3 | OTP login, user roles, merchant + rider registration | End-to-end login working on device |
| 2 — Ordering | Weeks 4–5 | Customer app browse/cart/checkout, merchant order queue | First test order placed end-to-end |
| 3 — Dispatch | Weeks 6–7 | Rider app, auto-dispatch, GPS tracking, order status flow | Live tracking visible to customer |
| 4 — Payments | Week 8 | PayMongo integration (GCash, Maya, COD), payout ledger | Real payment processed in staging |
| 5 — Merchant panel | Weeks 9–10 | Full merchant web dashboard, analytics, menu manager | Merchant can self-manage fully |
| 6 — Admin panel | Weeks 11–12 | Zone manager, rider KYC, order ops, finance dashboard | Ops team can manage without dev help |
| 7 — QA + Launch | Weeks 13–14 | End-to-end testing, performance, security audit, app store submission | Zero P0 bugs; app approved on stores |

# 11. Implementation Timeline

The following master timeline covers the first 12 months from company registration to provincial expansion.

> **MVP adjustment:** Treat Months 1–3 as food-only pilot validation. Recast Year-1 daily order targets downward vs. major-app density (see [overview.md](overview.md) feasibility notes). Defer grocery/parcel/pharmacy and ML-assisted ETA until the pilot zone is stable.

| Month | Business milestones | Technical milestones | KPI targets |
| --- | --- | --- | --- |
| Month 1 | DTI/BIR registration; sign first 10 merchants; recruit 5 riders | Dev environment, monorepo, auth, DB schema | 0 live orders (build phase) |
| Month 2 | Merchant onboarding kit; launch marketing waitlist; first rider training | Ordering flow, merchant dashboard v1, rider app v1 | First 50 beta customers registered |
| Month 3 | Soft launch in pilot barangay; first real orders | Payment integration live; real-time tracking live | 100 orders, 10 merchant partners |
| Month 4 | Expand to 3 adjacent barangays; hire zone coordinator | Admin panel v1; dispatch algorithm v2 | 500 orders/month, 25 merchants |
| Month 5–6 | Full municipality coverage; add grocery category | Multi-category support; promo engine; loyalty stamps | 2,000 orders/month, 40 merchants |
| Month 7–9 | Expand to neighboring town/city; first B2B contract | Zone replication tool; merchant self-serve onboarding | 5,000 orders/month, 80 merchants |
| Month 10–12 | Provincial footprint; 3 cities; add parcel/pharmacy | Native apps on stores; v2 dispatch (ML-assisted ETA) | 15,000 orders/month, 150 merchants |

# 12. Risk Register

| Risk | Likelihood | Impact | Mitigation strategy |
| --- | --- | --- | --- |
| Rider shortage during peak hours | High | High | Surge pricing; pre-shift scheduling; rider referral bonuses |
| Merchant churn to competitor | Medium | High | 0% commission for 3-month founding partners; merchant analytics value-add |
| Payment gateway downtime | Low | High | COD fallback always enabled; dual gateway (PayMongo + Xendit) |
| App crash on launch day | Medium | High | Staged rollout; feature flags; beta testing with 50 users minimum |
| Regulatory / LGU restriction | Low | High | Legal review before launch; engage barangay/city officials early |
| Slow customer acquisition | Medium | Medium | Referral program; merchant partner marketing; promo budget reserved |
| Data breach / security incident | Low | Very High | Quarterly security audit; pen testing before launch; NPC compliance |
| Founder burnout (solo early stage) | High | High | Delegate zone coordination by Month 4; hire part-time support early |

# 13. KPI Dashboard

The following KPIs should be reviewed weekly by the founder and monthly with any team members:

## 13.1 Business KPIs

| KPI | Measure | Target (Month 6) | Target (Month 12) |
| --- | --- | --- | --- |
| Gross Merchandise Value (GMV) | Total order value processed | ₱500,000/month | ₱5,000,000/month |
| Take rate | Platform revenue / GMV | 25–30% | 28–33% |
| Monthly Active Users (MAU) | Unique customers ordering monthly | 300 | 2,000 |
| Monthly Active Merchants | Merchants with at least 1 order | 30 | 120 |
| Monthly Active Riders | Riders completing at least 10 trips | 20 | 80 |
| Average Order Value (AOV) | GMV / total orders | ₱280 | ₱310 |
| Customer Retention Rate | % customers ordering again in 30 days | 40% | 55% |
| Net Promoter Score (NPS) | Customer survey score (0–100) | 40 | 55 |

## 13.2 Operations KPIs

| KPI | Measure | Target |
| --- | --- | --- |
| Average delivery time | Order confirmed to delivered | <35 minutes (urban) |
| Order completion rate | Orders delivered / orders placed | >95% |
| Cancellation rate (platform) | Cancelled by platform / total | <2% |
| Rider utilization | Active delivery time / online time | >60% |
| Merchant confirmation time | Avg time to confirm new order | <3 minutes |
| App crash-free rate | Sessions without crash / total sessions | >99.5% |
| API uptime | Monthly availability | >99.5% |

# 14. Appendices

## Appendix A — Merchant MOA Template (Summary)

A full Merchant MOA should include the following clauses at minimum. Have a lawyer draft and review the actual agreement.

- Parties: Legal name and address of Klik Go entity and the merchant
- Services: Description of order routing, dispatch, and payment processing services
- Commission: Agreed rate (e.g., 20% of order subtotal, excl. delivery fee)
- Payout: Weekly settlement schedule; payout method (GCash / bank); minimum payout threshold
- Merchant obligations: Menu accuracy, order confirmation within 3 minutes, packaging standards
- Platform obligations: Order routing, payment processing, customer support escalation
- Data ownership: Customer data belongs to Klik Go; merchant receives only aggregate analytics
- Exclusivity: Optional; consider first-90-day soft exclusivity for founding partners
- Termination: 30-day written notice required from either party; immediate for breach
- Governing law: Republic of the Philippines; disputes resolved via mediation first

## Appendix B — Rider Onboarding Checklist

- Valid government-issued ID (at least 2 forms)
- LTO driver's license (at least Restriction Code 1 for motorcycles)
- Vehicle registration (OR/CR) in the rider's name or a close relative's
- Selfie with ID for KYC (uploaded via rider app)
- GCash or Maya account for payout (must match name on ID)
- Completed in-app training modules (estimated 30 minutes)
- Signed Rider Service Agreement (digital signature via app)
- Passing score on delivery protocol quiz (score 80%+)

## Appendix C — Recommended Third-Party Services

| Category | Recommended provider | Approx. cost | Notes |
| --- | --- | --- | --- |
| Payment gateway | PayMongo | 2.5% per transaction | GCash, Maya, cards, GrabPay |
| SMS / OTP | Semaphore PH | ₱0.50–₱1.00 per SMS | Local PH rates; NestJS Auth OTP (not Supabase Auth for MVP) |
| Backend hosting | Railway.app (or Render) | ~₱500–₱2,000/month | NestJS API; auto-deploys from GitHub |
| Web hosting | Vercel | Free tier → usage | Next.js merchant + admin |
| Database / Realtime / Storage | Supabase | Free tier → paid | Postgres via Prisma; Realtime; Storage |
| Maps API | Google Maps Platform | ~₱0 (free tier) to ₱5,000+ | Free tier covers ~28,500 map loads/month |
| Push notifications | Firebase FCM | Free up to 1M messages/day | Sufficient until very large scale |
| Accounting | Wave Accounting | Free | Invoicing, expense tracking, reports |
| Legal review | Local PH business lawyer | ₱3,000–₱10,000 one-time | For contract templates + registration |
| Insurance (riders) | AXA Philippines micro | ₱20–₱50/rider/day | Per-trip accident coverage available |

---

*End of Document*

*Klik Go Business Documentation v1.0 — July 2026 — Confidential*

# Coordinator guide (pilot training)

You run one zone during the pilot: you watch every order at lunch and dinner, help stores and
riders, and step in when something goes wrong. You never need a developer for day-to-day work.
Read this once, do the practice tasks with the owner, and keep the runbooks open during peaks.

## 1. Signing in
- Go to `/auth/staff`, enter your email and password, then the 6-digit code from your
  authenticator app (Google Authenticator, Authy, 1Password). Lost your phone? Tell the owner at
  once; they remove your access and invite you again (docs/runbooks/DATA_INCIDENT.md).
- The first time, agree to the terms and privacy notice.
- Never share your account, never screenshot customer details into group chats, and sign out on
  shared computers.

## 2. Your screens
| Screen | What for |
|---|---|
| **Live orders** (`/admin`) | Every live order in your zone with a timer per step: amber at 80% of the target, red when late. The map shows stores, orders and online riders. |
| An order | History, customer and store contacts, notes, **Assign rider**, **Cancel**, **Refund**. |
| **Riders** | Who is online, applications to review (documents), suspend or reinstate, coaching list (average rating below 3.5). |
| **Low ratings** | Ratings of 2 or less open a ticket; call, sort it out, mark it done with what you did. |
| **Finance → Cash hand-ins** | Record cash riders hand in at the hub (amount and receipt number). |

Targets (BUSINESS §13.2, Q32): store confirms within **3 minutes**, food ready by the store's prep
time, rider picks up within **10 minutes** of ready, delivers within **30 minutes** of pickup.

## 3. A normal peak
1. 30 minutes before: check riders online (**Riders**), stores open (their status on the map).
2. Watch **Live orders**. The system texts a store at 1 minute, alerts you at 2, and cancels at 3
   (refunding online payments). Call the store at the alert if you can.
3. "No rider took it" alert: assign a rider (docs/runbooks/RIDER_NO_SHOW.md).
4. Write a **note** on any order you touch: what happened, who you called, what was agreed.
5. After the peak: clear **Low ratings**, record cash hand-ins, tell the owner about anything
   unusual.

## 4. When things go wrong
Open the runbook and follow it step by step:
- Order not moving → [Order stuck](runbooks/ORDER_STUCK.md)
- Rider missing → [Rider no-show](runbooks/RIDER_NO_SHOW.md)
- "I paid but…" → [Payment taken, order missing](runbooks/PAYMENT_MISSING_ORDER.md) (admin)
- Wrong or missing food → [Refund](runbooks/REFUND.md)
- Store not answering → [Store offline](runbooks/MERCHANT_OFFLINE.md)
- App or payments down → [Outage](runbooks/OUTAGE.md) (tell the owner first)
- Someone saw data they shouldn't → [Data incident](runbooks/DATA_INCIDENT.md) (tell the owner
  at once; the 72-hour clock starts)

Golden rules: be kind and quick on the phone; promise only what you can check; never change data
outside the console; never share customers' numbers or addresses outside the order.

## 5. Riders and cash
- Riders carry cash from cash-on-delivery orders up to their cash limit (₱3,000 by default). When
  they reach it they get no more cash orders until they hand cash in to you.
- At the hub: count the cash, record it in **Finance → Cash hand-ins** with a receipt number, give
  the rider a receipt. You can never record more than they hold.
- Approving riders: check all five documents (clear, matching names, valid dates). Viewing a
  document is logged; open only what you need.

## 6. Practice before launch (with the owner, on a dry-run day)
- [ ] Sign in with your authenticator; sign out.
- [ ] Follow one order from placed to delivered on **Live orders**.
- [ ] Let one order hit the 3-minute deadline and watch it cancel.
- [ ] Assign a rider by hand.
- [ ] Add a note, cancel an order with a reason, and (with an admin) refund one.
- [ ] Record a cash hand-in.
- [ ] Review a rider application's documents.
- [ ] Walk through every runbook once (docs/LAUNCH.md §6).

Questions or ideas: write them down and bring them to the weekly review; the KPIs on `/admin/kpis`
show whether the zone is meeting its targets.

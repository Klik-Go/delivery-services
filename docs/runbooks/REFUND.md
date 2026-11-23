# Runbook: refund

**When:** an order was wrong, missing items, very late, damaged, or cancelled after payment.
**Who:** the zone coordinator or an admin (both can refund orders in their zones; every refund is audited). Policy: BUSINESS §5.2; refunds are Klik Go's
cost, not the store's, until Q35 decides otherwise.

1. Decide the amount: full (nothing usable delivered) or partial (the missing items, or the
   delivery fee for a very late order). Note the reason on the order.
2. **Online payments:** **Console → the order → Refund**, amount and reason. It goes back through
   PayMongo to how they paid (GCash/Maya usually within minutes, cards 5–10 banking days). The
   ledger records it (`customer_refunds`).
3. **Cash on delivery:** the app cannot refund cash. Send the amount from Klik Go's GCash to the
   customer, then add a **note** on the order: "Cash refund ₱X by GCash, ref …". Tell the owner so
   the bookkeeper records it (see OPEN_QUESTIONS Q37).
4. Orders cancelled before delivery are refunded automatically; you don't need to do anything
   unless the refund shows as failed (it is retried by the background job; see
   `/admin/system`).
5. Store at fault twice in a week: talk to the store; repeated problems → **Stores → Suspend**.
6. Tell the customer the amount and when to expect it.

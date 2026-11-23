# Runbook: order stuck

**When:** an order has not moved for longer than its step should take: the store hasn't accepted
(the board turns amber at 80% of 3 minutes), food is "ready" with no rider, or "picked up" for
much longer than the trip.
**Who:** the zone coordinator (admins can do everything below too).

1. Open **Console → Live orders** and the order. The step timer and the history say where it is.
2. **Not accepted (status placed):**
   - The store was texted at 1 minute and you were alerted at 2; the order cancels itself at
     3 minutes (`merchant_sla`) and the customer is refunded automatically if they paid online.
   - Call the store (number on the order). If they will cook it: ask them to tap **Accept** now.
   - If they can't: let it cancel, or **Cancel** with reason "Store unavailable". Then follow
     [Store offline](MERCHANT_OFFLINE.md).
3. **Accepted/preparing too long:** call the store, add a **note** with the new time, and message
   the customer (call them) if it will be more than 10 minutes late.
4. **Ready, no rider:** see [Rider no-show](RIDER_NO_SHOW.md) — **Assign rider** to a free rider
   nearby; dispatch keeps offering it every 30 seconds in the meantime.
5. **Picked up for too long:** call the rider; check their pin on the live map. If the rider is
   unreachable for 10 minutes, call the customer, and escalate to the owner.
6. Every action you take: add a **note** on the order (what, who you spoke to, when).

**Do not** change an order's status in the database. All changes go through the console so the
history, ledger and notifications stay right.

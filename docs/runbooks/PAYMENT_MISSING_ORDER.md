# Runbook: payment taken but order missing

**When:** a customer says they paid (GCash, Maya, card, QR Ph) but the order still shows
"waiting for payment", disappeared, or they were charged twice.
**Who:** an admin (money).

1. Ask for the order code (on their screen) or the time and amount, and the PayMongo receipt.
2. **Console → Live orders** → search the code. Check payment status:
   - **paid** → nothing is missing; reassure the customer and follow the order normally.
   - **awaiting payment** → the payment webhook hasn't arrived or failed. Go to step 3.
   - **cancelled (unpaid timeout)** with a payment in PayMongo → the money arrived after the
     15-minute timeout; Klik Go refunds it automatically ("late payment refunded" on
     `/admin/system`). Check the refund in PayMongo.
3. **/admin/system → Payment webhooks with problems.** An error there tells you why (e.g.
   signature mismatch = wrong `PAYMONGO_WEBHOOK_SECRET` in Vercel).
4. Fix the cause, then **resend the event** from the PayMongo dashboard (Developers → Webhooks →
   the event → Resend). Handlers are idempotent: resending is always safe; the order moves to
   placed and the store is alerted.
5. Charged twice: the second checkout of the same order is refunded automatically when its
   webhook arrives; if it doesn't, refund it in PayMongo and add a note on the order.
6. Never mark an order paid by hand. If PayMongo shows the payment but the webhook can't be
   delivered, escalate to the developer with the order code and PayMongo event id.

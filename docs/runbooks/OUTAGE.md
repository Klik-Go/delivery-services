# Runbook: outage (Supabase, Vercel, PayMongo, SMS, maps)

**When:** the uptime monitor alerts, `/api/health/ready` is not `ready`, many errors in Sentry,
or a partner is down.
**Who:** the owner (or the admin on duty) decides; the coordinator tells stores and riders.

1. Look first: `/api/health/ready` (database, storage), `/admin/system` (jobs, webhooks), and
   the partners' status pages: status.supabase.com, vercel-status.com, PayMongo status, Semaphore.
2. **PayMongo down / payments failing:** **Settings → `online_payments` off.** Checkout offers
   cash on delivery only and says why. Turn it on again when PayMongo recovers; then check
   `/admin/system` for webhooks to resend ([Payment missing](PAYMENT_MISSING_ORDER.md)).
3. **Maps / address search down:** customers are told to drop the pin; nothing to do. If pins
   look wrong (fees off), turn **`flat_delivery_fee` on** until it recovers.
4. **SMS (Semaphore) down:** sign-in codes and store texts fail. Customers already signed in keep
   working; tell stores to keep the dashboard open with sound on. New sign-ins wait.
5. **Supabase or Vercel down:** nothing can be ordered. Post in the stores' and riders' group
   chats; coordinators call stores about orders in progress (riders finish deliveries; cash is
   reconciled later). Don't change data by hand.
6. **Background jobs late** (`/admin/system` says "Late"): dispatch and SLA texts stop. Check
   the scheduler (Q25: Vault secrets, `CRON_SECRET`); call stores and assign riders by hand
   meanwhile.
7. After any outage longer than 15 minutes: write what happened, when, impact (orders, money)
   and the fix in docs/LAUNCH.md §9; refund affected online orders ([Refund](REFUND.md)).

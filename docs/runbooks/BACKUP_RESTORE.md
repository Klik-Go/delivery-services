# Backups and restore drill

## What is backed up
- **Database (Supabase Postgres):** daily backups on the Pro plan (7 days); turn on Point-in-Time
  Recovery before launch for restores to any second. Orders, payments, payouts and the ledger
  live here.
- **Storage:** rider ID documents, delivery photos and menu photos (Supabase Storage). Supabase
  backups do not include storage objects: rider IDs are re-uploadable and deleted by retention
  anyway; menu photos are re-uploadable. Delivery photos are evidence in disputes and are lost with the bucket, so turn on Storage backups when Supabase offers them for the plan.
- **Code and migrations:** GitHub. The database schema can be rebuilt from `supabase/migrations`.

## Drill results

### Local drill (2026-11-23, Phase 11)
App data (`public` and `private` schemas) dumped with `pg_dump -Fc` and restored into a fresh
database on the local stack:

| Table | Source rows | Restored rows |
|---|---|---|
| orders | 443 | 443 |
| order_items | 411 | 411 |
| ledger_entries | 495 | 495 |
| payouts | 25 | 25 |
| profiles | 796 | 796 |
| merchants | 19 | 19 |
| menu_items | 84 | 84 |
| riders | 24 | 24 |
| consents | 108 | 108 |
| audit_logs | 361 | 361 |

Ledger balance (debits − credits) was 0 before and after. Dump 2.6 MB, dump and restore took about
2 seconds. The restore reported missing `auth` references, as expected for an app-only dump: a
real restore uses the full Supabase backup, which includes `auth`.

### Staging drill (owner, before launch: SEC-4)
1. Create a separate Supabase project **klikgo-staging** (never restore over production).
2. Production → Database → Backups → pick a backup (or a PITR time) → **Restore to a new project**
   (or download the backup and `pg_restore` it into staging).
3. Point a Vercel preview at staging (`DATABASE_URL`, `DIRECT_URL`, Supabase URL and keys).
4. Check: `/api/health/ready` is `ready`; an admin can sign in; `/admin/finance` shows last week's
   payouts; one order's ledger rows add up; row counts match the table above's queries:
   ```sql
   select (select count(*) from public.orders) as orders,
          (select count(*) from public.ledger_entries) as ledger,
          (select sum(debit_centavos) - sum(credit_centavos) from public.ledger_entries) as balance;
   ```
5. Write the date, backup used, time taken and any problem here, then delete the staging data.

Run the drill again every quarter and after any big migration.

## Restoring production for real
1. Pause: **Settings → online_payments → off**, ask stores to stop accepting.
2. Restore with PITR to just before the incident (Supabase dashboard).
3. Run **Deploy database migrations** if the restore is older than the latest migration.
4. Check `/api/health/ready`, `/admin/system`, and reconcile PayMongo payments after the restore
   point against `payments` (replay missed webhooks from the PayMongo dashboard: handlers are
   idempotent).

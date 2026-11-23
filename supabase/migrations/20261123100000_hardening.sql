-- Phase 11 — Hardening: consent records, account erasure, KYC retention, background job runs and
-- the resilience switches (docs/BUILD_PLAN.md Phase 11; docs/BUSINESS.md §7.2 RA 10173, §12).

-- ---------------------------------------------------------------------------
-- Consents: which version of the terms and the privacy notice a person agreed to, and when.
-- Written by the server only; a new version of a document asks everyone to agree again.
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);
alter table public.consents enable row level security;
create policy consents_select on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
grant select on public.consents to authenticated;
comment on table public.consents is 'Agreement to a dated version of the terms or privacy notice (server writes only).';

-- ---------------------------------------------------------------------------
-- Background job runs (/api/internal/jobs): when each run started and finished and what it did, so
-- /admin/system shows job lag. Kept 30 days (pruned by the job itself).
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job ~ '^[a-z][a-z0-9_]{1,62}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error text check (char_length(error) <= 500),
  constraint job_runs_finished check ((finished_at is null) = (ok is null))
);
create index job_runs_job_started_idx on public.job_runs (job, started_at desc);
alter table public.job_runs enable row level security;
create policy job_runs_select_admin on public.job_runs for select to authenticated
  using (private.is_admin());
grant select on public.job_runs to authenticated;
comment on table public.job_runs is 'One row per background job run, for job-lag monitoring (admins read; server writes).';

-- ---------------------------------------------------------------------------
-- KYC retention: files are deleted from storage by the background job; the row stays as a record
-- that the check happened, marked purged.
-- ---------------------------------------------------------------------------
alter table public.rider_kyc_documents add column purged_at timestamptz;
comment on column public.rider_kyc_documents.purged_at is 'When the file was deleted from storage (retention or account erasure).';
create index rider_kyc_documents_unpurged_idx on public.rider_kyc_documents (rider_id) where purged_at is null;

-- ---------------------------------------------------------------------------
-- Settings and switches (admin settings page):
--  online_payments    off = cash on delivery only (gateway down, doc §12).
--  flat_delivery_fee  on  = every delivery costs the zone base fee (pins or distances unreliable).
--  kyc_retention      days to keep ID files after a rejection or after the rider stops riding.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, description, enabled, rollout)
values
  ('online_payments', 'Online payments (GCash, Maya, card, QR Ph). Turn off to accept cash on delivery only while the gateway is down.', true, '{}'),
  ('flat_delivery_fee', 'Charge every delivery the zone base fee instead of by distance (use when maps or pins are unreliable).', false, '{}'),
  ('kyc_retention', 'Delete rider ID files this many days after an application is rejected or a rider is suspended or deletes their account.', true,
   '{"rejected_days": 90, "inactive_days": 365}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Account erasure (the person's right to erasure). Orders, payouts and ledger rows are financial
-- records the law makes us keep, so the person is anonymised instead of deleted: their contact
-- details, saved addresses, devices and location history go (a rider's plate stays: the vehicle record), orders keep their amounts but lose
-- the address, and the rider's ID files are queued for deletion. The service checks first that
-- nothing is in progress (orders, cash held, money owed); this function only erases.
-- ---------------------------------------------------------------------------
create function private.erase_account(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text;
  v_rider uuid;
  v_orders integer := 0;
  v_addresses integer := 0;
begin
  select phone into v_phone from public.profiles where id = p_user for update;
  if not found then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;
  select id into v_rider from public.riders where user_id = p_user;

  delete from public.addresses where user_id = p_user;
  get diagnostics v_addresses = row_count;
  delete from public.device_push_subscriptions where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  if v_phone is not null then
    delete from public.waitlist_signups where phone = v_phone;
  end if;
  update public.ratings set comment = null where from_user_id = p_user and comment is not null;

  -- Orders keep amounts, items and the barangay (for zone reports), never the address or contact.
  update public.orders o
     set address_snapshot = jsonb_strip_nulls(jsonb_build_object(
           'barangay', o.address_snapshot ->> 'barangay',
           'city', o.address_snapshot ->> 'city',
           'erased', true)),
         dropoff = extensions.st_setsrid(extensions.st_makepoint(
           round(extensions.st_x(o.dropoff::extensions.geometry)::numeric, 2)::double precision,
           round(extensions.st_y(o.dropoff::extensions.geometry)::numeric, 2)::double precision), 4326)::extensions.geography
   where o.customer_id = p_user
     and not coalesce((o.address_snapshot ->> 'erased')::boolean, false);
  get diagnostics v_orders = row_count;

  if v_rider is not null then
    delete from public.rider_locations where rider_id = v_rider;
    delete from public.rider_location_breadcrumbs where rider_id = v_rider;
    delete from public.payout_accounts where party_type = 'rider' and party_id = v_rider;
    update public.riders
       set is_online = false, status = 'suspended', status_reason = 'Account deleted',
           payout_account_name = null
     where id = v_rider;
  end if;

  delete from public.user_roles where user_id = p_user;
  update public.profiles set full_name = null, phone = null, email = null, status = 'deleted'
   where id = p_user;

  return jsonb_build_object('orders', v_orders, 'addresses', v_addresses, 'rider', v_rider is not null);
end;
$$;
revoke all on function private.erase_account(uuid) from public, anon, authenticated;
grant execute on function private.erase_account(uuid) to service_role;
comment on function private.erase_account(uuid) is 'Anonymises an account (right to erasure); financial records stay. Server only.';

-- ID files due for deletion: rejected more than rejected_days ago, or the rider stopped riding
-- (suspended, or deleted their account) more than inactive_days ago. Approved files of active
-- riders are kept while they ride. Erased accounts are due at once.
create function private.kyc_documents_due_for_purge(p_now timestamptz default now(), p_limit integer default 100)
returns table (id uuid, rider_id uuid, storage_path text)
language sql stable security definer set search_path = '' as $$
  with policy as (
    select coalesce((rollout ->> 'rejected_days')::integer, 90) as rejected_days,
           coalesce((rollout ->> 'inactive_days')::integer, 365) as inactive_days,
           enabled
      from public.feature_flags where key = 'kyc_retention'
  )
  select d.id, d.rider_id, d.storage_path
    from public.rider_kyc_documents d
    join public.riders r on r.id = d.rider_id
    join public.profiles p on p.id = r.user_id
    cross join policy
   where d.purged_at is null
     and policy.enabled
     and (
       p.status = 'deleted'
       or (d.status = 'rejected' and coalesce(d.reviewed_at, d.created_at) < p_now - make_interval(days => policy.rejected_days))
       or (r.status = 'suspended' and r.updated_at < p_now - make_interval(days => policy.inactive_days))
     )
   order by d.created_at
   limit p_limit;
$$;
revoke all on function private.kyc_documents_due_for_purge(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.kyc_documents_due_for_purge(timestamptz, integer) to service_role;

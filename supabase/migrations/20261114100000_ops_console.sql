-- Phase 8 — Coordinator and admin console (docs/BUSINESS.md §5.5, §9.2.4, Appendix B;
-- docs/BUILD_PLAN.md Phase 8; docs/ARCHITECTURE.md §4i).

-- ---------------------------------------------------------------------------
-- Support notes on orders: written by the server for coordinators and admins, read by the order's
-- zone coordinators and admins (the BFF also requires TOTP). Customers, riders and stores never see them.
-- ---------------------------------------------------------------------------
create table public.order_support_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_role public.app_role not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index order_support_notes_order_idx on public.order_support_notes (order_id, created_at);
alter table public.order_support_notes enable row level security;
create policy order_support_notes_select_ops on public.order_support_notes for select to authenticated
  using (exists (
    select 1 from public.orders o
     where o.id = order_id and (private.is_admin() or private.coordinates_zone(o.zone_id))
  ));
grant select on public.order_support_notes to authenticated;
comment on table public.order_support_notes is 'Coordinator/admin notes on an order (server writes only).';

-- ---------------------------------------------------------------------------
-- Rider onboarding (Appendix B): the payout account (GCash/Maya screenshot) is a KYC document,
-- and its account name is checked against the ID. Decisions keep their reason.
-- ---------------------------------------------------------------------------
alter type public.kyc_document_type add value if not exists 'payout_account';
alter table public.riders
  add column status_reason text check (char_length(status_reason) <= 300),
  add column payout_account_name text check (char_length(payout_account_name) between 2 and 120);

-- ---------------------------------------------------------------------------
-- Stores: why a store is suspended, and a commission change that starts on a later date.
-- Settlement uses the scheduled rate once its date has come (private.commission_bps).
-- ---------------------------------------------------------------------------
alter table public.merchants
  add column status_reason text check (char_length(status_reason) <= 300),
  add column next_commission_bps integer check (next_commission_bps between 0 and 5000),
  add column next_commission_from timestamptz,
  add constraint merchants_next_commission_pair
    check ((next_commission_bps is null) = (next_commission_from is null));

create function private.commission_bps(p_merchant_id uuid, p_at timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select case when m.next_commission_from is not null and m.next_commission_from <= p_at
              then m.next_commission_bps else m.commission_bps end
    from public.merchants m where m.id = p_merchant_id;
$$;
comment on function private.commission_bps is 'Commission in basis points that applies at a time (scheduled change included).';

-- ---------------------------------------------------------------------------
-- Live console: zone:<zone id> carries order changes and rider moves for the zone's coordinator and
-- admins (ids only; the console refetches through the BFF).
-- ---------------------------------------------------------------------------
create or replace function private.broadcast_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.rider_id is not distinct from old.rider_id
     and new.dispatch_status is not distinct from old.dispatch_status then
    return null;
  end if;
  v_payload := jsonb_build_object('orderId', new.id, 'status', new.status, 'at', now());
  perform realtime.send(v_payload, 'status', 'order:' || new.id::text, true);
  if new.status <> 'awaiting_payment' then
    perform realtime.send(v_payload, 'status', 'merchant:' || new.merchant_id::text, true);
    perform realtime.send(v_payload, 'status', 'zone:' || new.zone_id::text, true);
  end if;
  if new.rider_id is not null then
    perform realtime.send(v_payload, 'status', 'rider:' || new.rider_id::text, true);
  end if;
  if tg_op = 'UPDATE' and old.rider_id is not null and old.rider_id is distinct from new.rider_id then
    -- The rider who lost the job hears about it too.
    perform realtime.send(v_payload, 'status', 'rider:' || old.rider_id::text, true);
  end if;
  return null;
exception when others then
  raise warning 'order broadcast failed: %', sqlerrm;
  return null;
end;
$$;

create or replace function private.broadcast_rider_location() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_order uuid;
  v_zone uuid;
begin
  for v_order in
    select o.id from public.orders o
     where o.rider_id = new.rider_id and o.status in ('accepted', 'preparing', 'ready', 'picked_up')
  loop
    perform realtime.send(jsonb_build_object('orderId', v_order), 'location', 'order:' || v_order::text, true);
  end loop;
  select r.zone_id into v_zone from public.riders r where r.id = new.rider_id;
  if v_zone is not null then
    perform realtime.send(jsonb_build_object('riderId', new.rider_id), 'location', 'zone:' || v_zone::text, true);
  end if;
  return null;
exception when others then
  raise warning 'location broadcast failed: %', sqlerrm;
  return null;
end;
$$;

create or replace function private.can_follow_topic(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_raw text := split_part(p_topic, ':', 2);
  v_id uuid;
  v_aal2 boolean := coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
begin
  if v_raw !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := v_raw::uuid;
  if v_kind = 'order' then
    return exists (
      select 1 from public.orders o
       where o.id = v_id
         and (
           o.customer_id = (select auth.uid())
           or (o.rider_id is not null and o.rider_id = private.current_rider_id())
           or (v_aal2 and (
             private.is_merchant_member(o.merchant_id) or private.coordinates_zone(o.zone_id)
             or private.is_admin()
           ))
         )
    );
  elsif v_kind = 'merchant' then
    return v_aal2 and (private.is_merchant_member(v_id) or private.is_admin());
  elsif v_kind = 'rider' then
    return v_id = private.current_rider_id();
  elsif v_kind = 'zone' then
    return v_aal2 and (private.coordinates_zone(v_id) or private.is_admin());
  end if;
  return false;
end;
$$;

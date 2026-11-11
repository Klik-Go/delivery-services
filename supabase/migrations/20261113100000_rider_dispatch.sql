-- Phase 7 — Rider app, dispatch and live tracking (docs/BUSINESS.md §5.2 steps 4–6, §5.3;
-- docs/BUILD_PLAN.md Phase 7; docs/ARCHITECTURE.md §4h).

-- ---------------------------------------------------------------------------
-- Orders: the rider's pay (shown on the offer, fixed at assignment), dispatch progress and proof
-- ---------------------------------------------------------------------------
alter table public.orders
  add column rider_earnings_centavos integer check (rider_earnings_centavos >= 0),
  add column dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  add column dispatch_flagged_at timestamptz,
  add column arrived_store_at timestamptz,
  add column delivery_proof_path text check (delivery_proof_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
comment on column public.orders.dispatch_attempts is 'Offers made so far (each rider at most once).';
comment on column public.orders.dispatch_flagged_at is 'When the zone coordinator was told no rider took the job.';

create index orders_awaiting_dispatch_idx on public.orders (zone_id)
  where rider_id is null and status in ('accepted', 'preparing', 'ready');

-- ---------------------------------------------------------------------------
-- Dispatch settings (admin editor in Phase 8): offer window, attempts, search radius, when to
-- start, the PIN threshold, the rider pay rule and the speed used for arrival estimates.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, description, enabled, rollout)
values (
  'dispatch',
  'Rider dispatch and delivery rules (docs/BUILD_PLAN.md Phase 7).',
  true,
  '{"offer_seconds": 30, "max_attempts": 5, "max_distance_m": 5000, "start": "accept", "lead_minutes": 10,
    "pin_threshold_centavos": 50000, "rider_base_centavos": 3500, "rider_per_km_centavos": 1000,
    "rider_free_km": 2, "avg_speed_kph": 20}'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Delivery PINs: orders at or above the threshold get a 4-digit PIN that only the customer sees;
-- the rider asks for it at the door and the server checks it.
-- ---------------------------------------------------------------------------
create table public.order_delivery_pins (
  order_id uuid primary key references public.orders (id) on delete cascade,
  pin text not null check (pin ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now()
);
alter table public.order_delivery_pins enable row level security;
create policy order_delivery_pins_select_customer on public.order_delivery_pins for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = (select auth.uid())));
grant select on public.order_delivery_pins to authenticated;

create function private.issue_delivery_pin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_threshold integer;
begin
  select coalesce((rollout ->> 'pin_threshold_centavos')::integer, 50000) into v_threshold
    from public.feature_flags where key = 'dispatch';
  if new.total_centavos >= coalesce(v_threshold, 50000) then
    insert into public.order_delivery_pins (order_id, pin)
    values (new.id, lpad(((('x' || encode(extensions.gen_random_bytes(2), 'hex'))::bit(16)::integer) % 10000)::text, 4, '0'));
  end if;
  return null;
end;
$$;
create trigger orders_issue_delivery_pin after insert on public.orders
  for each row execute function private.issue_delivery_pin();

-- ---------------------------------------------------------------------------
-- Delivery photos: private bucket, written by the server only, opened through signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Live updates for riders and for tracking. Topics:
--   rider:<rider id>  new offers and changes to the rider's job (the rider only)
--   order:<order id>  also gets "location" when the assigned rider moves (customer, staff)
-- Payloads hold ids only; clients refetch through the BFF.
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
  end if;
  if new.rider_id is not null then
    perform realtime.send(v_payload, 'status', 'rider:' || new.rider_id::text, true);
  end if;
  return null;
exception when others then
  raise warning 'order broadcast failed: %', sqlerrm;
  return null;
end;
$$;
drop trigger orders_broadcast_status on public.orders;
create trigger orders_broadcast_status after insert or update of status, rider_id, dispatch_status on public.orders
  for each row execute function private.broadcast_order_status();

create function private.broadcast_dispatch_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('offerId', new.id, 'orderId', new.order_id, 'status', new.status),
    'offer', 'rider:' || new.rider_id::text, true
  );
  return null;
exception when others then
  raise warning 'offer broadcast failed: %', sqlerrm;
  return null;
end;
$$;
create trigger dispatch_offers_broadcast after insert or update of status on public.dispatch_offers
  for each row execute function private.broadcast_dispatch_offer();

create function private.broadcast_rider_location() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_order uuid;
begin
  for v_order in
    select o.id from public.orders o
     where o.rider_id = new.rider_id and o.status in ('accepted', 'preparing', 'ready', 'picked_up')
  loop
    perform realtime.send(jsonb_build_object('orderId', v_order), 'location', 'order:' || v_order::text, true);
  end loop;
  return null;
exception when others then
  raise warning 'location broadcast failed: %', sqlerrm;
  return null;
end;
$$;
create trigger rider_locations_broadcast after insert or update on public.rider_locations
  for each row execute function private.broadcast_rider_location();

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
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Offers expire after 30 seconds and the job moves on within one background-job run, so the jobs
-- run every 10 seconds instead of 30 (docs/ARCHITECTURE.md §4h).
-- ---------------------------------------------------------------------------
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'app-jobs'), schedule := '10 seconds');

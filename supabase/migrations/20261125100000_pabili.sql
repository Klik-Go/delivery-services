-- Phase 13 — Pabili ("buy for me"): a customer sends a shopping list for any store, palengke or
-- sari-sari store, a rider buys it with their own cash (their float), photographs the receipt and
-- delivers; the customer pays the receipt total plus the fees in cash (docs/BUILD_PLAN.md §4,
-- Phase 13; docs/OPEN_QUESTIONS.md Q38).
--
-- A Pabili order is an ordinary order with kind = 'pabili' and no store, so dispatch, tracking,
-- order_events, ratings of the rider and the ledger all work unchanged. Its lifecycle reuses the
-- statuses: placed → accepted (Klik Go takes it at once and looks for a rider) → preparing (the
-- rider is shopping) → ready (bought, receipt recorded) → picked_up → delivered.

create type public.order_kind as enum ('store', 'pabili');
create type public.pabili_item_status as enum ('pending', 'bought', 'unavailable');

alter table public.orders
  add column kind public.order_kind not null default 'store',
  alter column merchant_id drop not null,
  add constraint orders_kind_merchant check ((kind = 'store') = (merchant_id is not null)),
  -- The item cost is only known at the store, so Pabili is cash on delivery only.
  add constraint orders_pabili_cod check (kind <> 'pabili' or payment_method = 'cod');
create index orders_kind_idx on public.orders (kind, status) where kind = 'pabili';

-- ---------------------------------------------------------------------------
-- The request: where to buy, the customer's budget (the most the rider may spend on items) and,
-- once bought, what the items cost with the receipt photo. One row per Pabili order.
-- ---------------------------------------------------------------------------
create table public.pabili_requests (
  order_id uuid primary key references public.orders (id) on delete cascade,
  store_name text not null check (char_length(store_name) between 1 and 120),
  store_notes text check (char_length(store_notes) <= 300),
  pickup extensions.geography(Point, 4326) not null,
  budget_centavos integer not null check (budget_centavos > 0),
  item_cost_centavos integer check (item_cost_centavos >= 0),
  receipt_path text check (char_length(receipt_path) <= 300),
  bought_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pabili_requests_within_budget check (item_cost_centavos is null or item_cost_centavos <= budget_centavos),
  constraint pabili_requests_bought_together check (
    (item_cost_centavos is null) = (bought_at is null) and (receipt_path is null) = (bought_at is null)
  )
);
create index pabili_requests_pickup_gix on public.pabili_requests using gist (pickup);
alter table public.pabili_requests enable row level security;
-- Whoever may see the order sees the request (customer, the rider and riders offered it, the
-- zone's coordinator, admins).
create policy pabili_requests_select on public.pabili_requests for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
grant select on public.pabili_requests to authenticated;
comment on table public.pabili_requests is 'Pabili order details: where to buy, budget, item cost and receipt (server writes only).';

create table public.pabili_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pabili_requests (order_id) on delete cascade,
  position smallint not null check (position between 1 and 50),
  description text not null check (char_length(description) between 1 and 120),
  quantity integer not null check (quantity between 1 and 99),
  note text check (char_length(note) <= 200),
  status public.pabili_item_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (order_id, position)
);
alter table public.pabili_items enable row level security;
create policy pabili_items_select on public.pabili_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
grant select on public.pabili_items to authenticated;
comment on table public.pabili_items is 'The Pabili shopping list, one row per line; the rider marks each bought or unavailable.';

-- ---------------------------------------------------------------------------
-- Rider float: the most cash a rider can spend up front on Pabili items. 0 = no Pabili jobs.
-- Set by the rider in the app (through the server).
-- ---------------------------------------------------------------------------
alter table public.riders
  add column pabili_float_centavos integer not null default 0
    check (pabili_float_centavos between 0 and 1000000);

-- ---------------------------------------------------------------------------
-- Where a rider picks an order up: the store, or the Pabili shop. Server-side reads (dispatch,
-- the rider app, tracking, the console) join this instead of merchants. Not exposed to clients.
-- ---------------------------------------------------------------------------
create view private.order_pickups as
  select o.id as order_id,
         coalesce(m.name, p.store_name) as name,
         case when o.kind = 'store' then m.address_line else p.store_notes end as address_line,
         coalesce(m.location, p.pickup) as location
    from public.orders o
    left join public.merchants m on m.id = o.merchant_id
    left join public.pabili_requests p on p.order_id = o.id;
revoke all on private.order_pickups from public, anon, authenticated;
grant select on private.order_pickups to service_role;
comment on view private.order_pickups is 'Pickup name, address and point of every order (store or Pabili shop); server only.';

-- ---------------------------------------------------------------------------
-- Live updates: a Pabili order has no store board to tell.
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
    if new.merchant_id is not null then
      perform realtime.send(v_payload, 'status', 'merchant:' || new.merchant_id::text, true);
    end if;
    perform realtime.send(v_payload, 'status', 'zone:' || new.zone_id::text, true);
  end if;
  if new.rider_id is not null then
    perform realtime.send(v_payload, 'status', 'rider:' || new.rider_id::text, true);
  end if;
  if tg_op = 'UPDATE' and old.rider_id is not null and old.rider_id is distinct from new.rider_id then
    perform realtime.send(v_payload, 'status', 'rider:' || old.rider_id::text, true);
  end if;
  return null;
exception when others then
  raise warning 'order broadcast failed: %', sqlerrm;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- The store deadline (text at 1 min, alert at 2, cancel at 3) is for stores only. Klik Go takes a
-- Pabili order in the same transaction that places it, but the deadline never applies even if one
-- were left waiting.
-- ---------------------------------------------------------------------------
create or replace function private.escalate_merchant_sla(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_flag public.feature_flags;
  v_sms interval;
  v_alert interval;
  v_cancel interval;
  v_texted integer;
  v_flagged integer;
  v_cancelled integer;
begin
  select * into v_flag from public.feature_flags where key = 'merchant_sla';
  if not found or not v_flag.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  v_sms := make_interval(secs => coalesce((v_flag.rollout ->> 'sms_after_s')::integer, 60));
  v_alert := make_interval(secs => coalesce((v_flag.rollout ->> 'flag_after_s')::integer, 120));
  v_cancel := make_interval(secs => coalesce((v_flag.rollout ->> 'cancel_after_s')::integer, 180));

  with due as (
    update public.orders o set sla_sms_at = p_now
     where o.kind = 'store' and o.status = 'placed' and o.sla_sms_at is null
       and o.placed_at <= p_now - v_sms and o.placed_at > p_now - v_cancel
    returning o.id, o.code, o.merchant_id
  ), queued as (
    insert into public.notifications (user_id, channel, template, payload, order_id)
    select m.owner_id, 'sms', 'merchant_order_waiting',
           jsonb_build_object('orderId', d.id, 'code', d.code, 'store', m.name), d.id
      from due d join public.merchants m on m.id = d.merchant_id
    returning 1
  )
  select count(*) into v_texted from due;

  with due as (
    update public.orders o set sla_flagged_at = p_now
     where o.kind = 'store' and o.status = 'placed' and o.sla_flagged_at is null
       and o.placed_at <= p_now - v_alert and o.placed_at > p_now - v_cancel
    returning o.id, o.code, o.merchant_id, o.zone_id
  ), queued as (
    insert into public.notifications (user_id, channel, template, payload, order_id)
    select ur.user_id, ch.channel, 'order_unacknowledged',
           jsonb_build_object('orderId', d.id, 'code', d.code, 'store', m.name), d.id
      from due d
      join public.merchants m on m.id = d.merchant_id
      join public.user_roles ur on ur.role = 'coordinator' and ur.zone_id = d.zone_id
      cross join (values ('push'::public.notification_channel), ('in_app'::public.notification_channel)) ch (channel)
    returning 1
  )
  select count(*) into v_flagged from due;

  perform set_config('klikgo.actor_id', '', true);
  perform set_config('klikgo.actor_role', '', true);
  perform set_config('klikgo.event_meta', '{"reason":"merchant_timeout","by":"system"}', true);
  with expired as (
    update public.orders o set status = 'cancelled', cancel_reason = 'merchant_timeout'
     where o.kind = 'store' and o.status = 'placed' and o.placed_at <= p_now - v_cancel
    returning o.id, o.code, o.customer_id, o.merchant_id
  ), released as (
    delete from public.promo_redemptions r using expired e where r.order_id = e.id returning 1
  ), told as (
    insert into public.notifications (user_id, channel, template, payload, order_id)
    select e.customer_id, ch.channel, 'order_store_timeout',
           jsonb_build_object('orderId', e.id, 'code', e.code, 'store', m.name), e.id
      from expired e
      join public.merchants m on m.id = e.merchant_id
      cross join (values ('push'::public.notification_channel), ('in_app'::public.notification_channel)) ch (channel)
    returning 1
  )
  select count(*) into v_cancelled from expired;
  perform set_config('klikgo.event_meta', '', true);

  return jsonb_build_object(
    'enabled', true, 'texted', v_texted, 'flagged', v_flagged, 'cancelled', v_cancelled
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Erasure: shopping-list notes may hold personal details; descriptions and amounts stay.
-- ---------------------------------------------------------------------------
create function private.erase_pabili_notes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'deleted' and old.status is distinct from 'deleted' then
    update public.pabili_items i set note = null
      from public.orders o
     where o.id = i.order_id and o.customer_id = new.id and i.note is not null;
    update public.pabili_requests r set store_notes = null
      from public.orders o
     where o.id = r.order_id and o.customer_id = new.id and r.store_notes is not null;
  end if;
  return null;
end;
$$;
revoke all on function private.erase_pabili_notes() from public, anon, authenticated;
create trigger profiles_erase_pabili_notes after update of status on public.profiles
  for each row execute function private.erase_pabili_notes();

-- ---------------------------------------------------------------------------
-- Receipt photos: private bucket, written by the server only, opened through signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pabili-receipts', 'pabili-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- The switch (admin settings). Off until the owner turns Pabili on.
--   max_item_centavos     the most a customer may budget for items (₱1,500)
--   service_fee_centavos  the Pabili fee on top of the delivery fee (₱49)
--   max_items             lines on one shopping list
--   max_trip_m            the longest shop → drop-off trip (5 km)
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, description, enabled, rollout)
values ('pabili', 'Pabili: customers send a shopping list and a rider buys it with cash.', false,
        '{"max_item_centavos": 150000, "service_fee_centavos": 4900, "max_items": 20, "max_trip_m": 5000}')
on conflict (key) do nothing;

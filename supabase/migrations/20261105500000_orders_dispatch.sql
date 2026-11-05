-- Phase 1 · 5/9 — Orders, items, status history, dispatch offers (docs/BUSINESS.md §5.2,
-- docs/ARCHITECTURE.md §4).
--
-- The database is the last line of defence for the order lifecycle: it refuses illegal status
-- jumps and writes an order_events row for every change, whoever makes it. The Phase 6
-- OrderStateMachine (packages/core) applies the same transition table in code and sets the actor
-- with `set_config('klikgo.actor_id' | 'klikgo.actor_role' | 'klikgo.event_meta', …, true)`.

create table public.order_status_transitions (
  from_status public.order_status not null,
  to_status public.order_status not null,
  primary key (from_status, to_status)
);
comment on table public.order_status_transitions is
  'Allowed order status changes. Mirrors ORDER_STATUS_TRANSITIONS in packages/types (parity test).';
insert into public.order_status_transitions (from_status, to_status) values
  ('awaiting_payment', 'placed'), ('awaiting_payment', 'cancelled'),
  ('placed', 'accepted'), ('placed', 'rejected'), ('placed', 'cancelled'),
  ('accepted', 'preparing'), ('accepted', 'cancelled'),
  ('preparing', 'ready'), ('preparing', 'cancelled'),
  ('ready', 'picked_up'), ('ready', 'cancelled'),
  ('picked_up', 'delivered'), ('picked_up', 'failed_delivery');
alter table public.order_status_transitions enable row level security;
create policy order_status_transitions_read on public.order_status_transitions for select to anon, authenticated
  using (true);

create function public.is_valid_order_transition(p_from public.order_status, p_to public.order_status)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.order_status_transitions t where t.from_status = p_from and t.to_status = p_to
  );
$$;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^KG-[A-Z0-9]{6}$'),
  customer_id uuid not null references public.profiles (id) on delete restrict,
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  rider_id uuid references public.riders (id) on delete set null,
  zone_id uuid not null references public.zones (id) on delete restrict,
  status public.order_status not null default 'awaiting_payment',
  dispatch_status public.dispatch_status not null default 'unassigned',
  subtotal_centavos integer not null check (subtotal_centavos >= 0),
  delivery_fee_centavos integer not null default 0 check (delivery_fee_centavos >= 0),
  service_fee_centavos integer not null default 0 check (service_fee_centavos >= 0),
  small_order_fee_centavos integer not null default 0 check (small_order_fee_centavos >= 0),
  discount_centavos integer not null default 0 check (discount_centavos >= 0),
  tip_centavos integer not null default 0 check (tip_centavos >= 0),
  total_centavos integer not null check (total_centavos >= 0),
  payment_method public.payment_method not null,
  payment_status public.payment_status not null default 'pending',
  -- Snapshot of the delivery address at checkout (label, landmark, notes, contact) so later edits
  -- to the saved address never change a past order.
  address_snapshot jsonb not null check (jsonb_typeof(address_snapshot) = 'object'),
  dropoff extensions.geography(Point, 4326) not null,
  scheduled_for timestamptz,
  prep_minutes integer check (prep_minutes between 1 and 120),
  delivery_pin_hash text,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_by_role public.app_role,
  placed_at timestamptz,
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_adds_up check (
    total_centavos = subtotal_centavos + delivery_fee_centavos + service_fee_centavos
      + small_order_fee_centavos + tip_centavos - discount_centavos
  ),
  constraint orders_cancel_has_reason check (
    status <> 'cancelled' or (cancel_reason is not null and cancelled_by_role is not null)
  )
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_merchant_status_idx on public.orders (merchant_id, status, created_at desc);
create index orders_rider_status_idx on public.orders (rider_id, status) where rider_id is not null;
create index orders_zone_status_idx on public.orders (zone_id, status, created_at desc);
create index orders_dropoff_gix on public.orders using gist (dropoff);
create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();
alter table public.orders enable row level security;

alter table public.rider_location_breadcrumbs
  add constraint rider_location_breadcrumbs_order_fk foreign key (order_id) references public.orders (id) on delete set null;

-- ---------------------------------------------------------------------------
-- order_events: append-only history of every status change
-- ---------------------------------------------------------------------------
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete restrict,
  from_status public.order_status,
  to_status public.order_status not null,
  -- No FK: the audit trail must outlive account deletion.
  actor_id uuid,
  actor_role public.app_role,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create index order_events_order_idx on public.order_events (order_id, created_at);
create trigger order_events_append_only before update or delete on public.order_events
  for each row execute function private.forbid_change();
alter table public.order_events enable row level security;

-- Who is acting: the server sets klikgo.actor_* for the transaction; fall back to the JWT user.
create function private.current_actor_id() returns uuid
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('klikgo.actor_id', true), '')::uuid, (select auth.uid()));
$$;

create function private.current_actor_role() returns public.app_role
language sql stable set search_path = '' as $$
  select nullif(current_setting('klikgo.actor_role', true), '')::public.app_role;
$$;

-- Validates the transition and stamps the time of the new status.
create function private.order_status_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('awaiting_payment', 'placed') then
      raise exception 'orders_initial_status: a new order must be awaiting_payment or placed, not %', new.status
        using errcode = 'check_violation';
    end if;
  elsif new.status is not distinct from old.status then
    return new;
  elsif not public.is_valid_order_transition(old.status, new.status) then
    raise exception 'invalid order status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  case new.status
    when 'placed' then new.placed_at := coalesce(new.placed_at, now());
    when 'accepted' then new.accepted_at := now();
    when 'preparing' then new.preparing_at := now();
    when 'ready' then new.ready_at := now();
    when 'picked_up' then new.picked_up_at := now();
    when 'delivered' then new.delivered_at := now();
    when 'rejected' then new.rejected_at := now();
    when 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(new.cancelled_by, private.current_actor_id());
    when 'failed_delivery' then new.failed_at := now();
    else null;
  end case;
  return new;
end;
$$;
create trigger orders_status_guard before insert or update of status on public.orders
  for each row execute function private.order_status_guard();

create function private.log_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.order_events (order_id, from_status, to_status, actor_id, actor_role, meta)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    private.current_actor_id(),
    private.current_actor_role(),
    coalesce(nullif(current_setting('klikgo.event_meta', true), '')::jsonb, '{}'::jsonb)
  );
  return null;
end;
$$;
create trigger orders_log_status after insert or update of status on public.orders
  for each row execute function private.log_order_status();

-- ---------------------------------------------------------------------------
-- order_items: snapshot rows (not items_json) so items can be reported on
-- ---------------------------------------------------------------------------
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  name_snapshot text not null check (char_length(name_snapshot) between 1 and 120),
  unit_price_centavos integer not null check (unit_price_centavos >= 0),
  -- Sum of chosen modifier price deltas for one unit; the chosen options are in modifiers_snapshot.
  modifiers_unit_centavos integer not null default 0 check (modifiers_unit_centavos >= 0),
  quantity integer not null check (quantity between 1 and 99),
  modifiers_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(modifiers_snapshot) = 'array'),
  note text check (char_length(note) <= 200),
  line_total_centavos integer not null check (line_total_centavos >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_line_total check (
    line_total_centavos = (unit_price_centavos + modifiers_unit_centavos) * quantity
  )
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_menu_item_idx on public.order_items (menu_item_id) where menu_item_id is not null;
alter table public.order_items enable row level security;

-- ---------------------------------------------------------------------------
-- dispatch_offers: one row per offer to a rider (30 s to accept, earnings shown up front)
-- ---------------------------------------------------------------------------
create table public.dispatch_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  rider_id uuid not null references public.riders (id) on delete cascade,
  status public.dispatch_offer_status not null default 'offered',
  rider_earnings_centavos integer not null check (rider_earnings_centavos >= 0),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  constraint dispatch_offers_expiry_after_offer check (expires_at > offered_at),
  unique (order_id, rider_id)
);
create unique index dispatch_offers_one_accepted_per_order on public.dispatch_offers (order_id) where status = 'accepted';
create index dispatch_offers_rider_open_idx on public.dispatch_offers (rider_id, expires_at) where status = 'offered';
alter table public.dispatch_offers enable row level security;

-- SECURITY DEFINER so the orders policy can check offers without recursing through
-- dispatch_offers' own policy (which looks at orders).
create function private.is_offered_to_current_rider(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.dispatch_offers d
    where d.order_id = p_order_id and d.status = 'offered' and d.rider_id = private.current_rider_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies. Orders change only through the server (OrderStateMachine), so clients get read access.
-- ---------------------------------------------------------------------------
create policy orders_select on public.orders for select to authenticated
  using (
    customer_id = (select auth.uid())
    or private.is_merchant_member(merchant_id)
    or rider_id = private.current_rider_id()
    or private.is_offered_to_current_rider(id)
    or private.coordinates_zone(zone_id)
    or private.is_admin()
  );

-- Children are visible exactly when the parent order is (the orders policy decides).
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy order_events_select on public.order_events for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy dispatch_offers_select on public.dispatch_offers for select to authenticated
  using (
    rider_id = private.current_rider_id()
    or private.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and private.coordinates_zone(o.zone_id))
  );

-- A customer can see (and track) the rider currently delivering their order, and nobody else.
create function private.is_delivering_to_current_user(p_rider_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orders o
    where o.rider_id = p_rider_id
      and o.customer_id = (select auth.uid())
      and o.status in ('accepted', 'preparing', 'ready', 'picked_up')
  );
$$;
create policy riders_select_customer_delivery on public.riders for select to authenticated
  using (private.is_delivering_to_current_user(id));
create policy rider_locations_select_customer_delivery on public.rider_locations for select to authenticated
  using (private.is_delivering_to_current_user(rider_id));

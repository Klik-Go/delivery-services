-- Phase 1 · 7/9 — Ratings, promos, referrals, loyalty, push, notifications, audit, flags, fees.

-- ---------------------------------------------------------------------------
-- ratings (separate store and rider ratings per order, docs/BUILD_PLAN.md §3)
-- ---------------------------------------------------------------------------
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.rating_target not null,
  target_id uuid not null,
  score smallint not null check (score between 1 and 5),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  comment text check (char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  unique (order_id, from_user_id, target_type)
);
create index ratings_target_idx on public.ratings (target_type, target_id, created_at desc);
alter table public.ratings enable row level security;

-- Keeps merchants.rating_avg / riders.rating_avg current (riders under 3.5 enter coaching, §5.3).
create function private.refresh_rating_average() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.target_type = 'merchant' then
    update public.merchants m set
      rating_avg = s.avg, rating_count = s.count
    from (select round(avg(score)::numeric, 2) as avg, count(*)::int as count
          from public.ratings where target_type = 'merchant' and target_id = new.target_id) s
    where m.id = new.target_id;
  elsif new.target_type = 'rider' then
    update public.riders r set
      rating_avg = s.avg, rating_count = s.count
    from (select round(avg(score)::numeric, 2) as avg, count(*)::int as count
          from public.ratings where target_type = 'rider' and target_id = new.target_id) s
    where r.id = new.target_id;
  end if;
  return null;
end;
$$;
create trigger ratings_refresh_average after insert on public.ratings
  for each row execute function private.refresh_rating_average();

create policy ratings_select on public.ratings for select to authenticated
  using (
    from_user_id = (select auth.uid())
    or private.is_admin()
    or (target_type = 'merchant' and private.is_merchant_member(target_id))
    or (target_type = 'rider' and target_id = private.current_rider_id())
  );
-- A customer rates the store or rider of their own delivered order.
create policy ratings_insert_customer on public.ratings for insert to authenticated
  with check (
    from_user_id = (select auth.uid())
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.customer_id = (select auth.uid())
        and o.status = 'delivered'
        and (
          (target_type = 'merchant' and target_id = o.merchant_id)
          or (target_type = 'rider' and target_id = o.rider_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Promos and redemptions (codes are validated by the server; customers never list them)
-- ---------------------------------------------------------------------------
create table public.promos (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,20}$'),
  type public.promo_type not null,
  discount_bps integer check (discount_bps between 1 and 10000),
  discount_centavos integer check (discount_centavos > 0),
  max_discount_centavos integer check (max_discount_centavos > 0),
  min_subtotal_centavos integer not null default 0 check (min_subtotal_centavos >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_redemptions integer check (max_redemptions > 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  zone_id uuid references public.zones (id) on delete cascade,
  merchant_id uuid references public.merchants (id) on delete cascade,
  funded_by text not null default 'platform' check (funded_by in ('platform', 'merchant')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promos_value_matches_type check (
    (type = 'percent_off' and discount_bps is not null and discount_centavos is null)
    or (type = 'fixed_off' and discount_centavos is not null and discount_bps is null)
    or (type = 'free_delivery' and discount_bps is null and discount_centavos is null)
  ),
  constraint promos_window check (ends_at > starts_at)
);
create trigger promos_updated_at before update on public.promos
  for each row execute function private.set_updated_at();
alter table public.promos enable row level security;
create policy promos_select_admin on public.promos for select to authenticated using (private.is_admin());

create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid not null references public.promos (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  discount_centavos integer not null check (discount_centavos >= 0),
  created_at timestamptz not null default now()
);
create index promo_redemptions_promo_user_idx on public.promo_redemptions (promo_id, user_id);
alter table public.promo_redemptions enable row level security;
create policy promo_redemptions_select on public.promo_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- ---------------------------------------------------------------------------
-- Referrals (credit only after the friend's first completed paid order, docs/BUILD_PLAN.md §4D)
-- ---------------------------------------------------------------------------
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  referee_id uuid not null unique references public.profiles (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{4,20}$'),
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded', 'void')),
  qualifying_order_id uuid references public.orders (id) on delete set null,
  reward_centavos integer not null default 0 check (reward_centavos >= 0),
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  constraint referrals_not_self check (referrer_id <> referee_id)
);
create index referrals_referrer_idx on public.referrals (referrer_id);
alter table public.referrals enable row level security;
create policy referrals_select on public.referrals for select to authenticated
  using (referrer_id = (select auth.uid()) or referee_id = (select auth.uid()) or private.is_admin());

-- Loyalty: one stamp per delivered order; 10 stamps = free delivery (docs/BUILD_PLAN.md §3).
create table public.loyalty_stamps (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_order_id uuid references public.orders (id) on delete set null
);
create index loyalty_stamps_unredeemed_idx on public.loyalty_stamps (customer_id) where redeemed_at is null;
alter table public.loyalty_stamps enable row level security;
create policy loyalty_stamps_select on public.loyalty_stamps for select to authenticated
  using (customer_id = (select auth.uid()) or private.is_admin());

-- ---------------------------------------------------------------------------
-- Web Push subscriptions and notifications
-- ---------------------------------------------------------------------------
create table public.device_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index device_push_subscriptions_user_idx on public.device_push_subscriptions (user_id);
alter table public.device_push_subscriptions enable row level security;
create policy device_push_subscriptions_own on public.device_push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel public.notification_channel not null,
  template text not null check (template ~ '^[a-z][a-z0-9_]{1,60}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  order_id uuid references public.orders (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_queued_idx on public.notifications (created_at) where status = 'queued';
alter table public.notifications enable row level security;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Audit log (KYC views, refunds, role changes…): append-only, admins read
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_role public.app_role,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{1,80}$'),
  entity_type text not null,
  entity_id uuid,
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  ip inet,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.forbid_change();
alter table public.audit_logs enable row level security;
create policy audit_logs_select_admin on public.audit_logs for select to authenticated using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Feature flags and fee rules
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  description text check (char_length(description) <= 300),
  enabled boolean not null default false,
  rollout jsonb not null default '{}'::jsonb check (jsonb_typeof(rollout) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger feature_flags_updated_at before update on public.feature_flags
  for each row execute function private.set_updated_at();
alter table public.feature_flags enable row level security;
create policy feature_flags_select on public.feature_flags for select to authenticated using (true);

create table public.fee_rules (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind public.fee_rule_kind not null,
  min_distance_m integer check (min_distance_m >= 0),
  max_distance_m integer,
  min_subtotal_centavos integer check (min_subtotal_centavos >= 0),
  fee_centavos integer not null check (fee_centavos >= 0),
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_rules_band check (
    kind <> 'delivery_distance_band'
    or (min_distance_m is not null and (max_distance_m is null or max_distance_m > min_distance_m))
  ),
  constraint fee_rules_small_order check (kind <> 'small_order_fee' or min_subtotal_centavos is not null)
);
create index fee_rules_zone_idx on public.fee_rules (zone_id, kind) where is_active;
create trigger fee_rules_updated_at before update on public.fee_rules
  for each row execute function private.set_updated_at();
alter table public.fee_rules enable row level security;
-- Fees are shown to customers before checkout, for zones they can see (active ones).
create policy fee_rules_select on public.fee_rules for select to anon, authenticated
  using ((is_active and exists (select 1 from public.zones z where z.id = zone_id)) or private.is_admin());

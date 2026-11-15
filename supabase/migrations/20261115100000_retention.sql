-- Phase 9 — Retention (docs/BUILD_PLAN.md Phase 9, docs/BUSINESS.md §4.2, §5.3, §9.2.1):
-- two-sided ratings with a 24-hour edit window, low-rating tickets for the coordinator, promo
-- eligibility and abuse guards, personal vouchers (referral and loyalty rewards), referral codes
-- and loyalty stamps that turn into a free-delivery voucher.

-- ---------------------------------------------------------------------------
-- Ratings: customers rate the store and the rider, riders rate the customer. One rating per
-- order, rater and target; the service allows edits for 24 hours, within 7 days of delivery.
-- Ratings are written by the server only (the BFF opens tickets in the same transaction).
-- ---------------------------------------------------------------------------
alter table public.ratings add column updated_at timestamptz not null default now();
create trigger ratings_updated_at before update on public.ratings
  for each row execute function private.set_updated_at();

revoke insert (order_id, from_user_id, target_type, target_id, score, tags, comment) on public.ratings from authenticated;
drop policy ratings_insert_customer on public.ratings;
-- Riders see what customers said about them; customers see what they wrote, never riders' notes
-- about them (admins do).
comment on table public.ratings is 'Order ratings (server writes only): customer → merchant/rider, rider → customer.';

alter table public.profiles
  add column rating_avg numeric(3, 2) not null default 0 check (rating_avg between 0 and 5),
  add column rating_count integer not null default 0 check (rating_count >= 0);
comment on column public.profiles.rating_avg is 'Average score riders gave this customer (admins and the customer read it).';

-- Keeps the averages right after a new rating, an edit or a deletion, for every kind of target.
create or replace function private.refresh_rating_average() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.rating_target := coalesce(new.target_type, old.target_type);
  v_target uuid := coalesce(new.target_id, old.target_id);
  v_avg numeric(3, 2);
  v_count integer;
begin
  select coalesce(round(avg(score)::numeric, 2), 0), count(*)::int into v_avg, v_count
    from public.ratings where target_type = v_type and target_id = v_target;
  if v_type = 'merchant' then
    update public.merchants set rating_avg = v_avg, rating_count = v_count where id = v_target;
  elsif v_type = 'rider' then
    update public.riders set rating_avg = v_avg, rating_count = v_count where id = v_target;
  else
    update public.profiles set rating_avg = v_avg, rating_count = v_count where id = v_target;
  end if;
  return null;
end;
$$;
drop trigger ratings_refresh_average on public.ratings;
create trigger ratings_refresh_average after insert or update of score or delete on public.ratings
  for each row execute function private.refresh_rating_average();

-- ---------------------------------------------------------------------------
-- Support tickets: a rating of 2 or less opens one for the zone's coordinator (§5.3).
-- ---------------------------------------------------------------------------
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('low_rating')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  order_id uuid not null references public.orders (id) on delete cascade,
  zone_id uuid not null references public.zones (id) on delete restrict,
  rating_id uuid unique references public.ratings (id) on delete set null,
  summary text not null check (char_length(summary) between 1 and 300),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolution text check (char_length(resolution) <= 300),
  constraint support_tickets_resolved check ((status = 'resolved') = (resolved_at is not null))
);
create index support_tickets_open_idx on public.support_tickets (zone_id, created_at) where status = 'open';
alter table public.support_tickets enable row level security;
create policy support_tickets_select_ops on public.support_tickets for select to authenticated
  using (private.is_admin() or private.coordinates_zone(zone_id));
grant select on public.support_tickets to authenticated;
comment on table public.support_tickets is 'Follow-ups for coordinators (low ratings); server writes only.';

-- ---------------------------------------------------------------------------
-- Promos: eligibility rules, a budget cap, personal vouchers, and abuse guards per phone and
-- device. Redemptions are checked again in the database under a lock, so two orders placed at
-- the same moment cannot both take the last use.
-- ---------------------------------------------------------------------------
alter table public.promos
  -- Total discount the promo may give away (₱ budget), on top of the redemption count cap.
  add column budget_centavos integer check (budget_centavos > 0),
  -- Usable only on the customer's first N delivered orders (1 = new customers only).
  add column first_orders integer check (first_orders between 1 and 20),
  -- A personal voucher (referral or loyalty reward): only this customer can use it.
  add column owner_id uuid references public.profiles (id) on delete cascade,
  add column source text not null default 'campaign' check (source in ('campaign', 'referral', 'loyalty')),
  add column description text check (char_length(description) between 1 and 120),
  add constraint promos_personal_source check ((owner_id is null) = (source = 'campaign'));
create index promos_owner_idx on public.promos (owner_id) where owner_id is not null;
-- Customers list their own vouchers (campaign codes stay hidden).
create policy promos_select_owner on public.promos for select to authenticated
  using (owner_id = (select auth.uid()));
grant select on public.promos to authenticated;

alter table public.promo_redemptions
  add column phone_hash text check (phone_hash ~ '^[0-9a-f]{64}$'),
  add column device_hash text check (device_hash ~ '^[0-9a-f]{64}$');
create index promo_redemptions_phone_idx on public.promo_redemptions (promo_id, phone_hash) where phone_hash is not null;
create index promo_redemptions_device_idx on public.promo_redemptions (promo_id, device_hash) where device_hash is not null;

create function private.guard_promo_redemption() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_promo public.promos;
  v_count integer;
  v_spent bigint;
  v_mine integer;
begin
  select * into v_promo from public.promos where id = new.promo_id for update;
  if v_promo.owner_id is not null and v_promo.owner_id <> new.user_id then
    raise exception 'promo_not_yours' using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum(discount_centavos), 0) into v_count, v_spent
    from public.promo_redemptions where promo_id = new.promo_id;
  if v_promo.max_redemptions is not null and v_count >= v_promo.max_redemptions then
    raise exception 'promo_used_up' using errcode = 'P0001';
  end if;
  if v_promo.budget_centavos is not null and v_spent + new.discount_centavos > v_promo.budget_centavos then
    raise exception 'promo_used_up' using errcode = 'P0001';
  end if;
  -- The per-customer limit counts the account, its phone number and the device together.
  select count(*) into v_mine from public.promo_redemptions r
   where r.promo_id = new.promo_id
     and (r.user_id = new.user_id
          or (new.phone_hash is not null and r.phone_hash = new.phone_hash)
          or (new.device_hash is not null and r.device_hash = new.device_hash));
  if v_mine >= v_promo.per_user_limit then
    raise exception 'promo_already_used' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger promo_redemptions_guard before insert on public.promo_redemptions
  for each row execute function private.guard_promo_redemption();

-- ---------------------------------------------------------------------------
-- Referrals: every customer gets a code; a friend enters it before their first order. Both get a
-- ₱50 voucher once the friend's first order is delivered, unless a fraud guard voids it.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column referral_code text unique check (referral_code ~ '^[A-Z0-9]{6,12}$');

alter table public.referrals
  add column device_hash text check (device_hash ~ '^[0-9a-f]{64}$'),
  add column void_reason text check (char_length(void_reason) <= 200),
  add column referrer_promo_id uuid references public.promos (id) on delete set null,
  add column referee_promo_id uuid references public.promos (id) on delete set null;
-- One referral per device: a second account on the same phone handset cannot claim again.
create unique index referrals_device_once on public.referrals (device_hash) where device_hash is not null and status <> 'void';

-- ---------------------------------------------------------------------------
-- Loyalty: a stamp per delivered order over the minimum; every 10 stamps become a voucher.
-- Delivered orders are processed once by the background job (rewards_processed_at).
-- ---------------------------------------------------------------------------
alter table public.loyalty_stamps
  add column voucher_promo_id uuid references public.promos (id) on delete set null;
alter table public.orders add column rewards_processed_at timestamptz;
create index orders_rewards_due_idx on public.orders (delivered_at)
  where status = 'delivered' and rewards_processed_at is null;

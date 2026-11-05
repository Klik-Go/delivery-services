-- Phase 1 · 1/9 — Foundation: private helper schema, enums, shared triggers, profiles, zones.
--
-- Conventions for every Klik Go table (CLAUDE.md, docs/ARCHITECTURE.md):
--   * uuid primary keys (gen_random_uuid), timestamptz in UTC, updated_at maintained by trigger
--   * money is integer centavos (*_centavos) with non-negative checks
--   * locations are PostGIS geography(…, 4326) in the `extensions` schema
--   * RLS is enabled on every table; policies are added in 20261105200000_merchants_roles.sql
--     and later files once the helper functions exist
--   * SECURITY DEFINER functions live in the `private` schema, which PostgREST does not expose

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums (mirrored in packages/types/src/domain.ts; parity enforced by test)
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('customer', 'rider', 'merchant_owner', 'merchant_staff', 'coordinator', 'admin');
create type public.profile_status as enum ('active', 'suspended', 'deleted');
create type public.order_status as enum (
  'awaiting_payment', 'placed', 'accepted', 'preparing', 'ready', 'picked_up',
  'delivered', 'rejected', 'cancelled', 'failed_delivery'
);
create type public.dispatch_status as enum ('unassigned', 'offered', 'assigned', 'at_store', 'picked_up');
create type public.payment_method as enum ('gcash', 'maya', 'card', 'qrph', 'cod');
create type public.payment_status as enum ('pending', 'processing', 'paid', 'failed', 'refunded', 'partially_refunded');
create type public.merchant_category as enum ('food', 'grocery', 'pharmacy');
create type public.merchant_status as enum ('pending', 'active', 'suspended');
create type public.vehicle_type as enum ('motorcycle', 'bicycle', 'tricycle');
create type public.rider_status as enum ('pending_kyc', 'active', 'suspended');
create type public.zone_type as enum ('barangay', 'city', 'provincial');
create type public.dispatch_offer_status as enum ('offered', 'accepted', 'declined', 'expired');
create type public.kyc_document_type as enum ('government_id', 'drivers_license', 'vehicle_registration', 'selfie_with_id');
create type public.kyc_status as enum ('pending', 'approved', 'rejected');
create type public.ledger_account as enum (
  'gateway_clearing', 'rider_cash_on_hand', 'merchant_payable', 'rider_payable',
  'platform_revenue', 'gateway_fees', 'promo_expense', 'customer_refunds'
);
create type public.ledger_party as enum ('platform', 'merchant', 'rider', 'customer');
create type public.payout_status as enum ('draft', 'approved', 'paid', 'failed');
create type public.rating_target as enum ('merchant', 'rider', 'customer');
create type public.promo_type as enum ('percent_off', 'fixed_off', 'free_delivery');
create type public.notification_channel as enum ('push', 'sms', 'in_app', 'email');
create type public.fee_rule_kind as enum ('delivery_distance_band', 'small_order_fee', 'service_fee');

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Audit trails (order history, ledger, audit log) are corrected by new rows, never edited.
create function private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'append-only: rows in %.% cannot be updated or deleted', tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one per auth user (created by the sign-up trigger in the next file)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (char_length(full_name) between 1 and 120),
  phone text unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email ~* '^[^@[:space:]]+@[^@[:space:]]+$'),
  locale text not null default 'en' check (locale in ('en', 'fil')),
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Person behind an auth user. Roles live in user_roles (many per person).';

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- zones: mini-franchise service areas (docs/BUSINESS.md §5.5)
-- ---------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  zone_type public.zone_type not null default 'barangay',
  area extensions.geography(Polygon, 4326) not null check (extensions.st_isvalid(area::extensions.geometry)),
  base_fee_centavos integer not null check (base_fee_centavos >= 0),
  per_km_centavos integer not null default 0 check (per_km_centavos >= 0),
  -- 10000 = 1.00×. Surge is deferred (docs/BUILD_PLAN.md §4D); the column keeps the doc's field.
  surge_multiplier_bps integer not null default 10000 check (surge_multiplier_bps between 10000 and 30000),
  max_radius_km numeric(4, 1) not null,
  is_active boolean not null default false,
  service_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(service_hours) = 'object'),
  coordinator_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zones_radius_matches_type check (
    (zone_type = 'barangay' and max_radius_km between 3 and 5)
    or (zone_type = 'city' and max_radius_km between 8 and 15)
    or (zone_type = 'provincial' and max_radius_km between 20 and 40)
  )
);
comment on table public.zones is 'Delivery zone. Radius bands per type follow docs/BUSINESS.md §5.5.';

create index zones_area_gix on public.zones using gist (area);
create index zones_coordinator_idx on public.zones (coordinator_id);
create trigger zones_updated_at before update on public.zones
  for each row execute function private.set_updated_at();
alter table public.zones enable row level security;

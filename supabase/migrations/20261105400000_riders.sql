-- Phase 1 · 4/9 — Riders, KYC documents, live locations and breadcrumbs (docs/BUSINESS.md §5.3).

create table public.riders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete restrict,
  zone_id uuid not null references public.zones (id) on delete restrict,
  vehicle_type public.vehicle_type not null,
  plate_no text check (plate_no ~ '^[A-Z0-9 -]{2,10}$'),
  status public.rider_status not null default 'pending_kyc',
  is_online boolean not null default false,
  -- COD cash a rider may carry before remitting (docs/BUILD_PLAN.md §2 "Payments"). ₱3,000 default.
  cash_limit_centavos integer not null default 300000 check (cash_limit_centavos >= 0),
  rating_avg numeric(3, 2) not null default 0 check (rating_avg between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint riders_plate_required check (vehicle_type = 'bicycle' or plate_no is not null),
  constraint riders_online_requires_active check (not is_online or status = 'active')
);
create index riders_zone_available_idx on public.riders (zone_id) where status = 'active' and is_online;
create trigger riders_updated_at before update on public.riders
  for each row execute function private.set_updated_at();
alter table public.riders enable row level security;

create function private.current_rider_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select r.id from public.riders r where r.user_id = (select auth.uid());
$$;
comment on function private.current_rider_id is 'Rider id of the signed-in user, or null if they are not a rider.';

-- Sensitive personal information (government IDs, selfies): admins only, files in a private bucket.
create table public.rider_kyc_documents (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders (id) on delete cascade,
  type public.kyc_document_type not null,
  storage_path text not null unique,
  status public.kyc_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text check (char_length(rejection_reason) <= 300),
  created_at timestamptz not null default now(),
  constraint rider_kyc_path_in_rider_folder check (storage_path like rider_id::text || '/%')
);
create index rider_kyc_documents_rider_idx on public.rider_kyc_documents (rider_id);
create index rider_kyc_documents_pending_idx on public.rider_kyc_documents (created_at) where status = 'pending';
alter table public.rider_kyc_documents enable row level security;

-- Latest position only (one row per rider); history goes to breadcrumbs.
create table public.rider_locations (
  rider_id uuid primary key references public.riders (id) on delete cascade,
  location extensions.geography(Point, 4326) not null,
  heading smallint check (heading between 0 and 359),
  speed_kph numeric(5, 1) check (speed_kph >= 0),
  accuracy_m numeric(7, 1) check (accuracy_m >= 0),
  updated_at timestamptz not null default now()
);
create index rider_locations_location_gix on public.rider_locations using gist (location);
alter table public.rider_locations enable row level security;

-- Sampled trail during an active job (dispute evidence). Retention job arrives in Phase 11.
create table public.rider_location_breadcrumbs (
  id bigint generated always as identity primary key,
  rider_id uuid not null references public.riders (id) on delete cascade,
  order_id uuid,
  location extensions.geography(Point, 4326) not null,
  recorded_at timestamptz not null default now()
);
create index rider_location_breadcrumbs_rider_time_idx on public.rider_location_breadcrumbs (rider_id, recorded_at desc);
create index rider_location_breadcrumbs_order_idx on public.rider_location_breadcrumbs (order_id) where order_id is not null;
alter table public.rider_location_breadcrumbs enable row level security;

-- Coordinators see the profiles of riders in their zone (names for dispatch); added here because
-- it needs the riders table.
create policy profiles_select_zone_riders on public.profiles for select to authenticated
  using (exists (select 1 from public.riders r where r.user_id = profiles.id and private.coordinates_zone(r.zone_id)));

create policy riders_select on public.riders for select to authenticated
  using (user_id = (select auth.uid()) or private.coordinates_zone(zone_id) or private.is_admin());
create policy riders_update_self on public.riders for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy rider_kyc_select_admin on public.rider_kyc_documents for select to authenticated
  using (private.is_admin());
create policy rider_kyc_insert_self on public.rider_kyc_documents for insert to authenticated
  with check (rider_id = private.current_rider_id() and status = 'pending');

create policy rider_locations_select on public.rider_locations for select to authenticated
  using (
    rider_id = private.current_rider_id()
    or private.is_admin()
    or exists (select 1 from public.riders r where r.id = rider_id and private.coordinates_zone(r.zone_id))
  );
create policy rider_locations_insert_self on public.rider_locations for insert to authenticated
  with check (rider_id = private.current_rider_id());
create policy rider_locations_update_self on public.rider_locations for update to authenticated
  using (rider_id = private.current_rider_id()) with check (rider_id = private.current_rider_id());

create policy breadcrumbs_select on public.rider_location_breadcrumbs for select to authenticated
  using (
    rider_id = private.current_rider_id()
    or private.is_admin()
    or exists (select 1 from public.riders r where r.id = rider_id and private.coordinates_zone(r.zone_id))
  );
create policy breadcrumbs_insert_self on public.rider_location_breadcrumbs for insert to authenticated
  with check (rider_id = private.current_rider_id());

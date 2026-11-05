-- Phase 3 — Merchant onboarding, store settings and menu photos (docs/BUILD_PLAN.md §6 Phase 3,
-- docs/BUSINESS.md §5.4, §9.2.2, Appendix A).

-- ---------------------------------------------------------------------------
-- merchant_applications: the public "Become a partner" form. A separate table because an applicant
-- has no account yet (merchants.owner_id is required); approval creates the merchant, the owner's
-- staff account and the invite in one server transaction.
-- ---------------------------------------------------------------------------
create type public.merchant_application_status as enum ('pending', 'approved', 'rejected');

create table public.merchant_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (char_length(business_name) between 2 and 80),
  owner_name text not null check (char_length(owner_name) between 2 and 80),
  phone text not null check (phone ~ '^\+639[0-9]{9}$'),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email) <= 254),
  category public.merchant_category not null default 'food',
  barangay text not null check (char_length(barangay) between 1 and 100),
  city text not null check (char_length(city) between 1 and 100),
  address_line text check (char_length(address_line) <= 200),
  location extensions.geography(Point, 4326) not null,
  -- The zone covering the pin when the application arrived; null means "not in our area yet"
  -- (kept as expansion demand, but it cannot be approved until a zone covers it).
  zone_id uuid references public.zones (id) on delete set null,
  status public.merchant_application_status not null default 'pending',
  merchant_id uuid references public.merchants (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text check (char_length(rejection_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_applications_review check (
    (status = 'pending') = (reviewed_at is null)
    and (status = 'approved') = (merchant_id is not null)
  )
);
comment on table public.merchant_applications is
  'Partner applications from /partners. Written only by the server; admins see all, coordinators their zone.';
create index merchant_applications_status_idx on public.merchant_applications (status, created_at);
create index merchant_applications_zone_idx on public.merchant_applications (zone_id) where zone_id is not null;
create trigger merchant_applications_updated_at before update on public.merchant_applications
  for each row execute function private.set_updated_at();
alter table public.merchant_applications enable row level security;

-- Reads are filtered by the policies below; there is no client write grant at all.
grant select on public.merchant_applications to authenticated;

create policy merchant_applications_admin_select on public.merchant_applications for select to authenticated
  using (private.is_admin());
create policy merchant_applications_coordinator_select on public.merchant_applications for select to authenticated
  using (zone_id is not null and private.coordinates_zone(zone_id));

-- ---------------------------------------------------------------------------
-- merchants: service radius (≤ the zone's maximum) and the founding-partner commission holiday.
-- ---------------------------------------------------------------------------
alter table public.merchants
  add column service_radius_km numeric(4, 1) check (service_radius_km > 0),
  -- Founding partners pay 0% until this moment, then commission_bps applies (Appendix A, §4.2).
  add column founding_commission_until timestamptz;
comment on column public.merchants.service_radius_km is 'Delivery radius; null means the zone maximum.';

create function private.merchant_radius_within_zone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max numeric;
begin
  if new.service_radius_km is null then
    return new;
  end if;
  select z.max_radius_km into v_max from public.zones z where z.id = new.zone_id;
  if new.service_radius_km > v_max then
    raise exception 'service radius % km is above the zone maximum of % km', new.service_radius_km, v_max
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger merchants_radius_within_zone before insert or update of service_radius_km, zone_id on public.merchants
  for each row execute function private.merchant_radius_within_zone();

grant update (service_radius_km) on public.merchants to authenticated;

-- ---------------------------------------------------------------------------
-- merchant_closures: holiday closures on top of the weekly hours (§9.2.2 "holiday closures").
-- ---------------------------------------------------------------------------
create table public.merchant_closures (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  closed_on date not null,
  reason text check (char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  unique (merchant_id, closed_on)
);
create index merchant_closures_merchant_idx on public.merchant_closures (merchant_id, closed_on);
alter table public.merchant_closures enable row level security;

-- Visible exactly when the merchant is (customers need to know a store is closed that day).
create policy merchant_closures_select on public.merchant_closures for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy merchant_closures_member_write on public.merchant_closures for all to authenticated
  using (private.is_merchant_member(merchant_id)) with check (private.is_merchant_member(merchant_id));

grant select on public.merchant_closures to anon, authenticated;
grant insert, update, delete on public.merchant_closures to authenticated;

-- ---------------------------------------------------------------------------
-- Menu photos: WebP only, at most 200 KB (Phase 3 acceptance). The browser compresses before
-- upload; the bucket limit makes the rule hold even for a client that skips that step.
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 204800, allowed_mime_types = array['image/webp']
where id = 'menu-photos';

-- Phase 1 · 8/9 — PostGIS helpers and table/column privileges.

-- ---------------------------------------------------------------------------
-- zone_for_point: which active zone serves this pin? The smallest one wins where zones overlap
-- (a barangay zone inside a city zone).
-- ---------------------------------------------------------------------------
create function public.zone_for_point(p_point extensions.geography)
returns table (id uuid, name text, slug text)
language sql stable set search_path = '' as $$
  select z.id, z.name, z.slug
  from public.zones z
  where z.is_active and extensions.st_covers(z.area, p_point)
  order by extensions.st_area(z.area) asc
  limit 1;
$$;
comment on function public.zone_for_point is 'Active zone covering a point (smallest first), or no row.';

-- ---------------------------------------------------------------------------
-- nearest_available_riders: approved, online riders seen in the last 2 minutes who are not on an
-- unfinished order, nearest first (KNN `<->` on the GiST index), within p_max_distance_m.
-- SECURITY INVOKER: callers only see riders their RLS allows; dispatch runs as the server.
-- ---------------------------------------------------------------------------
create function public.nearest_available_riders(
  p_point extensions.geography,
  p_limit integer default 5,
  p_max_distance_m integer default 5000
)
returns table (rider_id uuid, user_id uuid, zone_id uuid, distance_m double precision, location_updated_at timestamptz)
language sql stable set search_path = '' as $$
  select r.id, r.user_id, r.zone_id, extensions.st_distance(l.location, p_point), l.updated_at
  from public.rider_locations l
  join public.riders r on r.id = l.rider_id
  where r.status = 'active'
    and r.is_online
    and l.updated_at > now() - interval '2 minutes'
    and extensions.st_dwithin(l.location, p_point, p_max_distance_m)
    and not exists (
      select 1 from public.orders o
      where o.rider_id = r.id and o.status not in ('delivered', 'rejected', 'cancelled', 'failed_delivery')
    )
  order by l.location operator(extensions.<->) p_point
  limit least(greatest(p_limit, 1), 50);
$$;
comment on function public.nearest_available_riders is 'Dispatch candidates nearest first (docs/BUSINESS.md §5.2 step 4).';

revoke all on function public.nearest_available_riders(extensions.geography, integer, integer) from public, anon;
grant execute on function public.nearest_available_riders(extensions.geography, integer, integer) to authenticated, service_role;
grant execute on function public.zone_for_point(extensions.geography) to anon, authenticated, service_role;
grant execute on function public.is_valid_order_transition(public.order_status, public.order_status) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private helpers: callable by the roles whose policies use them, nobody else.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Least privilege for API roles. RLS decides *which rows*; grants decide *which actions and
-- columns*. Clients read through RLS and write only what they own; everything else (orders,
-- payments, ledger, roles, approvals) changes through the server (service role / postgres).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;

-- Future tables start closed to API roles too; each migration grants what it needs.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- People: rename themselves and pick a language; status and phone are server-managed.
grant update (full_name, locale) on public.profiles to authenticated;

-- Saved addresses: full control of their own (RLS: owner only).
grant insert, update, delete on public.addresses to authenticated;

-- Merchant team: store settings they may change themselves; never commission or approval.
grant update (name, description, is_open, accepts_cod, default_prep_minutes, hours, phone, address_line, cover_photo_path)
  on public.merchants to authenticated;
grant insert, update, delete on public.menu_categories, public.menu_items, public.modifier_groups, public.modifier_options
  to authenticated;

-- Riders: go online/offline, report position, upload KYC; approval stays with admins.
grant update (is_online) on public.riders to authenticated;
grant insert, update on public.rider_locations to authenticated;
grant insert (rider_id, order_id, location, recorded_at) on public.rider_location_breadcrumbs to authenticated;
grant insert (rider_id, type, storage_path) on public.rider_kyc_documents to authenticated;

-- Customers: rate delivered orders, manage push subscriptions, mark notifications read.
grant insert (order_id, from_user_id, target_type, target_id, score, tags, comment) on public.ratings to authenticated;
grant insert, update, delete on public.device_push_subscriptions to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Anonymous visitors never write.
revoke insert, update, delete, truncate on all tables in schema public from anon;

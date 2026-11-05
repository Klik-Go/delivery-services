-- Phase 1 · 2/9 — Merchants, roles (many per person), invites, role helpers, sign-up trigger.

-- ---------------------------------------------------------------------------
-- merchants (docs/BUSINESS.md §5.4)
-- ---------------------------------------------------------------------------
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id) on delete restrict,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text check (char_length(description) <= 500),
  category public.merchant_category not null default 'food',
  location extensions.geography(Point, 4326) not null,
  address_line text check (char_length(address_line) <= 200),
  phone text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Basis points: 2000 = 20%. Founding merchants get 0 for 3 months (docs/BUSINESS.md §4.2).
  commission_bps integer not null default 2000 check (commission_bps between 0 and 10000),
  accepts_cod boolean not null default true,
  is_open boolean not null default false,
  default_prep_minutes integer not null default 15 check (default_prep_minutes between 1 and 120),
  hours jsonb not null default '{}'::jsonb check (jsonb_typeof(hours) = 'object'),
  status public.merchant_status not null default 'pending',
  rating_avg numeric(3, 2) not null default 0 check (rating_avg between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  cover_photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index merchants_zone_status_idx on public.merchants (zone_id, status);
create index merchants_owner_idx on public.merchants (owner_id);
create index merchants_location_gix on public.merchants using gist (location);
create trigger merchants_updated_at before update on public.merchants
  for each row execute function private.set_updated_at();
alter table public.merchants enable row level security;

-- A merchant must sit inside its zone, or riders and fees would be computed for the wrong area.
create function private.merchant_inside_zone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.zones z
    where z.id = new.zone_id and extensions.st_covers(z.area, new.location)
  ) then
    raise exception 'merchant "%" is outside its zone', new.name using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger merchants_inside_zone before insert or update of location, zone_id on public.merchants
  for each row execute function private.merchant_inside_zone();

-- ---------------------------------------------------------------------------
-- user_roles: many roles per person, scoped to a merchant or zone where needed
-- ---------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  merchant_id uuid references public.merchants (id) on delete cascade,
  zone_id uuid references public.zones (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_roles_scope check (
    (role in ('merchant_owner', 'merchant_staff')) = (merchant_id is not null)
    and (role = 'coordinator') = (zone_id is not null)
  ),
  constraint user_roles_unique unique nulls not distinct (user_id, role, merchant_id, zone_id)
);
comment on table public.user_roles is 'Role grants. Never trust a role claimed by the client; the server re-reads this table.';

create index user_roles_merchant_idx on public.user_roles (merchant_id) where merchant_id is not null;
create index user_roles_zone_idx on public.user_roles (zone_id) where zone_id is not null;
alter table public.user_roles enable row level security;

-- ---------------------------------------------------------------------------
-- invites: staff (merchant, coordinator, admin) join by invitation only
-- ---------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+$'),
  role public.app_role not null check (role in ('merchant_owner', 'merchant_staff', 'coordinator', 'admin')),
  merchant_id uuid references public.merchants (id) on delete cascade,
  zone_id uuid references public.zones (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  -- Only a hash of the one-time token is stored; the token itself is emailed (Phase 2).
  token_hash text unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invites_scope check (
    (role in ('merchant_owner', 'merchant_staff')) = (merchant_id is not null)
    and (role = 'coordinator') = (zone_id is not null)
  )
);
create index invites_merchant_idx on public.invites (merchant_id) where merchant_id is not null;
alter table public.invites enable row level security;

-- ---------------------------------------------------------------------------
-- Role helpers for RLS policies. SECURITY DEFINER so policies can read user_roles without
-- recursing into its own RLS; `(select auth.uid())` is evaluated once per statement.
-- ---------------------------------------------------------------------------
create function private.has_role(p_role public.app_role, p_merchant_id uuid default null, p_zone_id uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = p_role
      and (p_merchant_id is null or ur.merchant_id = p_merchant_id)
      and (p_zone_id is null or ur.zone_id = p_zone_id)
  );
$$;
comment on function private.has_role is 'True when the signed-in user holds the role (optionally for a merchant or zone).';

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('admin');
$$;

create function private.is_merchant_member(p_merchant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.merchant_id = p_merchant_id
      and ur.role in ('merchant_owner', 'merchant_staff')
  );
$$;

create function private.is_merchant_owner(p_merchant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('merchant_owner', p_merchant_id);
$$;

create function private.coordinates_zone(p_zone_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role('coordinator', null, p_zone_id);
$$;

-- ---------------------------------------------------------------------------
-- Sign-up: every new auth user gets a profile and the customer role
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    case
      when coalesce(new.phone, '') = '' then null
      when left(new.phone, 1) = '+' then new.phone
      else '+' || new.phone -- Supabase Auth stores phones without the leading plus
    end,
    nullif(new.email, '')
  )
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer') on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Policies (profiles' coordinator clause is added with the riders table)
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy zones_select on public.zones for select to anon, authenticated
  using (is_active or private.is_admin() or private.coordinates_zone(id));

create policy user_roles_select on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_admin()
    or (merchant_id is not null and private.is_merchant_owner(merchant_id))
  );

create policy invites_select on public.invites for select to authenticated
  using (private.is_admin() or (merchant_id is not null and private.is_merchant_owner(merchant_id)));

create policy merchants_select on public.merchants for select to anon, authenticated
  using (
    status = 'active'
    or private.is_merchant_member(id)
    or private.coordinates_zone(zone_id)
    or private.is_admin()
  );
create policy merchants_update_member on public.merchants for update to authenticated
  using (private.is_merchant_member(id)) with check (private.is_merchant_member(id));

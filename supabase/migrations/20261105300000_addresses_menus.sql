-- Phase 1 · 3/9 — Saved addresses and merchant menus.

-- ---------------------------------------------------------------------------
-- addresses: a pin drop is required; PH addresses rely on landmarks (docs/BUILD_PLAN.md §2)
-- ---------------------------------------------------------------------------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 40),
  location extensions.geography(Point, 4326) not null,
  street text check (char_length(street) <= 200),
  landmark text check (char_length(landmark) <= 200),
  barangay text not null check (char_length(barangay) between 1 and 100),
  city text not null check (char_length(city) between 1 and 100),
  notes text check (char_length(notes) <= 300),
  contact_phone text check (contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);
create unique index addresses_one_default_per_user on public.addresses (user_id) where is_default;
create index addresses_location_gix on public.addresses using gist (location);
create trigger addresses_updated_at before update on public.addresses
  for each row execute function private.set_updated_at();
alter table public.addresses enable row level security;

create policy addresses_owner_all on public.addresses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy addresses_admin_select on public.addresses for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Menus: categories → items → modifier groups → options. Prices in centavos.
-- ---------------------------------------------------------------------------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lets menu_items reference (category, merchant) so an item can never sit in another store's category.
  unique (id, merchant_id)
);
create index menu_categories_merchant_idx on public.menu_categories (merchant_id, sort);
create trigger menu_categories_updated_at before update on public.menu_categories
  for each row execute function private.set_updated_at();
alter table public.menu_categories enable row level security;

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 500),
  price_centavos integer not null check (price_centavos > 0),
  is_available boolean not null default true,
  photo_path text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, merchant_id) references public.menu_categories (id, merchant_id) on delete cascade
);
create index menu_items_merchant_idx on public.menu_items (merchant_id, category_id, sort);
create index menu_items_category_idx on public.menu_items (category_id, merchant_id);
create trigger menu_items_updated_at before update on public.menu_items
  for each row execute function private.set_updated_at();
alter table public.menu_items enable row level security;

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  is_required boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifier_groups_range check (max_select >= min_select and (not is_required or min_select >= 1))
);
create index modifier_groups_item_idx on public.modifier_groups (menu_item_id, sort);
create trigger modifier_groups_updated_at before update on public.modifier_groups
  for each row execute function private.set_updated_at();
alter table public.modifier_groups enable row level security;

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  modifier_group_id uuid not null references public.modifier_groups (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  price_delta_centavos integer not null default 0 check (price_delta_centavos >= 0),
  is_available boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index modifier_options_group_idx on public.modifier_options (modifier_group_id, sort);
create trigger modifier_options_updated_at before update on public.modifier_options
  for each row execute function private.set_updated_at();
alter table public.modifier_options enable row level security;

-- Menus are visible exactly when their merchant is (the merchants policy decides: live stores are
-- public, pending stores only to their team, coordinators and admins). Members edit their own menu.
create policy menu_categories_select on public.menu_categories for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy menu_categories_member_write on public.menu_categories for all to authenticated
  using (private.is_merchant_member(merchant_id)) with check (private.is_merchant_member(merchant_id));

create policy menu_items_select on public.menu_items for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy menu_items_member_write on public.menu_items for all to authenticated
  using (private.is_merchant_member(merchant_id)) with check (private.is_merchant_member(merchant_id));

create policy modifier_groups_select on public.modifier_groups for select to anon, authenticated
  using (exists (select 1 from public.menu_items i where i.id = menu_item_id));
create policy modifier_groups_member_write on public.modifier_groups for all to authenticated
  using (exists (select 1 from public.menu_items i where i.id = menu_item_id and private.is_merchant_member(i.merchant_id)))
  with check (exists (select 1 from public.menu_items i where i.id = menu_item_id and private.is_merchant_member(i.merchant_id)));

create policy modifier_options_select on public.modifier_options for select to anon, authenticated
  using (exists (select 1 from public.modifier_groups g where g.id = modifier_group_id));
create policy modifier_options_member_write on public.modifier_options for all to authenticated
  using (exists (
    select 1 from public.modifier_groups g join public.menu_items i on i.id = g.menu_item_id
    where g.id = modifier_group_id and private.is_merchant_member(i.merchant_id)
  ))
  with check (exists (
    select 1 from public.modifier_groups g join public.menu_items i on i.id = g.menu_item_id
    where g.id = modifier_group_id and private.is_merchant_member(i.merchant_id)
  ));

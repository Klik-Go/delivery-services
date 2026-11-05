-- Phase 4 — Customer discovery: search indexes and the out-of-zone waitlist
-- (docs/BUILD_PLAN.md §6 Phase 4, docs/BUSINESS.md §9.2.1).

-- ---------------------------------------------------------------------------
-- Search: Postgres full-text (simple dictionary: Filipino and English dish names stem poorly)
-- plus trigram similarity for typos ("adbo" → "adobo").
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create index merchants_search_fts on public.merchants
  using gin (to_tsvector('simple', name || ' ' || coalesce(description, '')));
create index merchants_name_trgm on public.merchants using gin (name extensions.gin_trgm_ops);
create index menu_items_search_fts on public.menu_items
  using gin (to_tsvector('simple', name || ' ' || coalesce(description, '')));
create index menu_items_name_trgm on public.menu_items using gin (name extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- waitlist_signups: people outside every zone who want Klik Go to come to them. Kept as expansion
-- demand (which barangays to open next). Written by the server only; admins read.
-- ---------------------------------------------------------------------------
create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (phone ~ '^\+639[0-9]{9}$'),
  email text check (email ~* '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email) <= 254),
  barangay text not null check (char_length(barangay) between 1 and 100),
  city text check (char_length(city) <= 100),
  location extensions.geography(Point, 4326) not null,
  created_at timestamptz not null default now()
);
comment on table public.waitlist_signups is
  'Out-of-zone customers asking Klik Go to open in their area. Server-written; admins read.';
create index waitlist_signups_location_gix on public.waitlist_signups using gist (location);
create index waitlist_signups_created_idx on public.waitlist_signups (created_at);
alter table public.waitlist_signups enable row level security;

grant select on public.waitlist_signups to authenticated;
create policy waitlist_signups_admin_select on public.waitlist_signups for select to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Featured promos: codes stay private by default (the server validates them); only promos an admin
-- marks as featured appear in the customer home carousel.
-- ---------------------------------------------------------------------------
alter table public.promos add column is_featured boolean not null default false;
comment on column public.promos.is_featured is 'Shown in the home promo carousel (with its code).';

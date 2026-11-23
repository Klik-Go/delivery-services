-- Phase 12 — Pilot launch: invite-only customers (first 100), rider online time (for the KPI
-- dashboard's utilisation and earnings per hour) and the pilot-scope switches
-- (docs/BUILD_PLAN.md Phase 12; docs/BUSINESS.md §3.3 Tier 1, §4.2, §13).

-- ---------------------------------------------------------------------------
-- Invite codes. One code lets one customer order; redeeming is the only way past the gate while
-- invite_only is on. Codes come in named batches (flyers, a partner store, the waitlist).
-- ---------------------------------------------------------------------------
create table public.pilot_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  batch text not null check (char_length(batch) between 1 and 80),
  waitlist_id uuid references public.waitlist_signups (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  sent_at timestamptz,
  redeemed_by uuid unique references public.profiles (id) on delete set null,
  redeemed_at timestamptz,
  constraint pilot_invites_redeemed_together check ((redeemed_by is null) = (redeemed_at is null))
);
create index pilot_invites_batch_idx on public.pilot_invites (batch, created_at);
create unique index pilot_invites_waitlist_idx on public.pilot_invites (waitlist_id) where waitlist_id is not null;
alter table public.pilot_invites enable row level security;
create policy pilot_invites_select on public.pilot_invites for select to authenticated
  using (redeemed_by = (select auth.uid()) or private.is_admin());
grant select on public.pilot_invites to authenticated;
comment on table public.pilot_invites is 'Invite codes for the invite-only pilot; one redemption per code and per person (server writes only).';

-- Redeems a code for a person, at most `p_max` people in total. Serialised with an advisory lock
-- so two last-minute redemptions cannot both take the 100th place.
-- Returns: ok | already (this person already has access) | invalid | used | expired | full.
create function private.redeem_invite(p_code text, p_user uuid, p_max integer, p_now timestamptz default now())
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.pilot_invites;
  v_redeemed integer;
begin
  perform pg_advisory_xact_lock(hashtext('klikgo.pilot_invites'));
  if exists (select 1 from public.pilot_invites where redeemed_by = p_user) then
    return 'already';
  end if;
  select * into v_invite from public.pilot_invites where code = upper(trim(p_code)) for update;
  if not found then return 'invalid'; end if;
  if v_invite.redeemed_by is not null then return 'used'; end if;
  if v_invite.expires_at is not null and v_invite.expires_at < p_now then return 'expired'; end if;
  select count(*) into v_redeemed from public.pilot_invites where redeemed_by is not null;
  if v_redeemed >= p_max then return 'full'; end if;
  update public.pilot_invites set redeemed_by = p_user, redeemed_at = p_now where id = v_invite.id;
  return 'ok';
end;
$$;
revoke all on function private.redeem_invite(text, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function private.redeem_invite(text, uuid, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Rider online time: one row per stretch a rider is online, opened and closed by a trigger on
-- riders.is_online (the rider's switch, an admin suspending them, or account erasure).
-- ---------------------------------------------------------------------------
create table public.rider_shifts (
  id bigint generated always as identity primary key,
  rider_id uuid not null references public.riders (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint rider_shifts_order check (ended_at is null or ended_at >= started_at)
);
create unique index rider_shifts_open_idx on public.rider_shifts (rider_id) where ended_at is null;
create index rider_shifts_started_idx on public.rider_shifts (started_at);
alter table public.rider_shifts enable row level security;
create policy rider_shifts_select on public.rider_shifts for select to authenticated
  using (rider_id = private.current_rider_id() or private.is_admin());
grant select on public.rider_shifts to authenticated;
comment on table public.rider_shifts is 'When each rider was online (trigger on riders.is_online); for utilisation and pay per hour.';

create function private.track_rider_shift()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_online and (tg_op = 'INSERT' or not old.is_online) then
    insert into public.rider_shifts (rider_id) values (new.id) on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.is_online and not new.is_online then
    update public.rider_shifts set ended_at = now() where rider_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;
revoke all on function private.track_rider_shift() from public, anon, authenticated;
create trigger riders_track_shift after insert or update of is_online on public.riders
  for each row execute function private.track_rider_shift();

-- Riders online right now start their first shift with this migration.
insert into public.rider_shifts (rider_id) select id from public.riders where is_online;

-- ---------------------------------------------------------------------------
-- Pilot switches (admin settings):
--  invite_only       on = only customers who redeemed an invite may order (max_customers cap).
--                    Off by default: the owner turns it on for the soft launch (docs/LAUNCH.md).
--  pilot_scope       on = customers see only these store categories (food in the pilot).
--                    Off by default too, so demo grocery stores keep showing until launch.
--  scheduled_orders  off = "Now" only at checkout.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, description, enabled, rollout)
values
  ('invite_only', 'Only customers with an invite code may order (soft launch: the first 100 customers).', false,
   '{"max_customers": 100}'),
  ('pilot_scope', 'Only these store categories are shown to customers (the pilot is food only).', false,
   '{"categories": ["food"]}'),
  ('scheduled_orders', 'Let customers schedule an order for later today. Off = "Now" only.', true, '{}')
on conflict (key) do nothing;

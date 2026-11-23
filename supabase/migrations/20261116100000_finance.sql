-- Phase 10 — Finance (docs/BUILD_PLAN.md Phase 10; docs/BUSINESS.md §5.2 step 7, §5.3–5.4, §6.5,
-- Appendix A payout clause): where each store and rider is paid, weekly payouts with their lines,
-- cash riders hand in, the settlement runs, and two ledger accounts for money leaving Klik Go.
--
-- Ledger flow (every row balanced, append-only):
--   settlement   debit merchant_payable / rider_payable      credit payouts_due  (per payout)
--   COD netting  debit rider_payable                         credit rider_cash_on_hand
--   paid         debit payouts_due                           credit platform_cash
--   failed       debit payouts_due                           credit merchant_payable / rider_payable
--   remittance   debit platform_cash                         credit rider_cash_on_hand

alter type public.ledger_account add value if not exists 'payouts_due';
alter type public.ledger_account add value if not exists 'platform_cash';

-- ---------------------------------------------------------------------------
-- Where a store or rider is paid. Kept apart from merchants/riders so account numbers never travel
-- with public store data; the owner (not staff), the rider and admins can read their own.
-- ---------------------------------------------------------------------------
create table public.payout_accounts (
  party_type public.ledger_party not null check (party_type in ('merchant', 'rider')),
  party_id uuid not null,
  method text not null check (method in ('gcash', 'maya', 'bank')),
  account_name text not null check (char_length(account_name) between 2 and 120),
  account_number text not null check (account_number ~ '^[0-9][0-9 -]{5,33}$'),
  bank_name text check (char_length(bank_name) between 2 and 80),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (party_type, party_id),
  constraint payout_accounts_bank_named check ((method = 'bank') = (bank_name is not null))
);
create trigger payout_accounts_updated_at before update on public.payout_accounts
  for each row execute function private.set_updated_at();
alter table public.payout_accounts enable row level security;
create policy payout_accounts_select on public.payout_accounts for select to authenticated
  using (
    private.is_admin()
    or (party_type = 'merchant' and private.is_merchant_owner(party_id))
    or (party_type = 'rider' and party_id = private.current_rider_id())
  );
grant select on public.payout_accounts to authenticated;
comment on table public.payout_accounts is 'GCash/Maya/bank account for payouts (server writes only).';

-- ---------------------------------------------------------------------------
-- Payouts: a snapshot of where the money goes, how it was worked out, and how it ended.
-- Once paid, a payout never changes.
-- ---------------------------------------------------------------------------
alter table public.payouts
  add column earnings_centavos integer not null default 0 check (earnings_centavos >= 0),
  add column cash_netted_centavos integer not null default 0 check (cash_netted_centavos >= 0),
  add column method text check (method in ('gcash', 'maya', 'bank')),
  add column account_name text check (char_length(account_name) between 2 and 120),
  add column account_number text check (account_number ~ '^[0-9][0-9 -]{5,33}$'),
  add column bank_name text check (char_length(bank_name) between 2 and 80),
  add column paid_by uuid references public.profiles (id) on delete set null,
  add column failure_reason text check (char_length(failure_reason) between 3 and 300),
  add constraint payouts_amount_is_net check (amount_centavos = earnings_centavos - cash_netted_centavos),
  add constraint payouts_paid_reference check (status <> 'paid' or reference is not null),
  add constraint payouts_failed_reason check (status <> 'failed' or failure_reason is not null);

create function private.payouts_freeze_paid() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'paid' then
    raise exception 'payout_already_paid' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger payouts_freeze_paid before update or delete on public.payouts
  for each row execute function private.payouts_freeze_paid();

-- How each payout adds up: one line per delivered order, plus carried-over and cash lines.
create table public.payout_lines (
  id bigint generated always as identity primary key,
  payout_id uuid not null references public.payouts (id) on delete cascade,
  kind text not null check (kind in ('order', 'carried_over', 'cash_netted')),
  order_id uuid references public.orders (id) on delete set null,
  description text not null check (char_length(description) between 1 and 200),
  amount_centavos integer not null,
  occurred_at timestamptz not null
);
create index payout_lines_payout_idx on public.payout_lines (payout_id, occurred_at);
alter table public.payout_lines enable row level security;
create policy payout_lines_select on public.payout_lines for select to authenticated
  using (exists (
    select 1 from public.payouts p where p.id = payout_id and (
      private.is_admin()
      or (p.party_type = 'merchant' and private.is_merchant_owner(p.party_id))
      or (p.party_type = 'rider' and p.party_id = private.current_rider_id())
    )
  ));
grant select on public.payout_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Cash riders hand in (cash on delivery). Recorded by the zone's coordinator or an admin.
-- ---------------------------------------------------------------------------
create table public.cod_remittances (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.riders (id) on delete restrict,
  zone_id uuid not null references public.zones (id) on delete restrict,
  amount_centavos integer not null check (amount_centavos > 0),
  reference text not null check (char_length(reference) between 2 and 100),
  received_by uuid references public.profiles (id) on delete set null,
  ledger_txn_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index cod_remittances_rider_idx on public.cod_remittances (rider_id, created_at desc);
create trigger cod_remittances_append_only before update or delete on public.cod_remittances
  for each row execute function private.forbid_change();
alter table public.cod_remittances enable row level security;
create policy cod_remittances_select on public.cod_remittances for select to authenticated
  using (
    private.is_admin()
    or private.coordinates_zone(zone_id)
    or rider_id = private.current_rider_id()
  );
grant select on public.cod_remittances to authenticated;

-- ---------------------------------------------------------------------------
-- One settlement per week (Monday to Sunday, Asia/Manila); the job runs it once.
-- ---------------------------------------------------------------------------
create table public.settlement_runs (
  period_start date primary key,
  period_end date not null,
  payouts integer not null default 0 check (payouts >= 0),
  total_centavos bigint not null default 0 check (total_centavos >= 0),
  started_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint settlement_runs_week check (period_end = period_start + 6 and extract(isodow from period_start) = 1)
);
alter table public.settlement_runs enable row level security;
create policy settlement_runs_select_admin on public.settlement_runs for select to authenticated
  using (private.is_admin());
grant select on public.settlement_runs to authenticated;

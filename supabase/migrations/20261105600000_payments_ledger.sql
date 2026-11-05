-- Phase 1 · 6/9 — Payments, webhook idempotency, double-entry ledger, payouts.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  gateway text not null check (gateway in ('paymongo', 'cod')),
  intent_id text not null,
  gateway_ref text,
  amount_centavos integer not null check (amount_centavos > 0),
  status public.payment_status not null default 'pending',
  method public.payment_method not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway, intent_id)
);
create index payments_order_idx on public.payments (order_id);
create trigger payments_updated_at before update on public.payments
  for each row execute function private.set_updated_at();
alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Every gateway webhook is stored once (unique event id) before it is processed, so retries are
-- idempotent. Server-only: no client policy at all.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  gateway text not null check (gateway in ('paymongo')),
  event_id text not null,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (gateway, event_id)
);
create index webhook_events_unprocessed_idx on public.webhook_events (received_at) where processed_at is null;
alter table public.webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- Double-entry ledger. Each transaction (txn_id) must balance: sum(debits) = sum(credits),
-- checked when the database transaction commits. Entries are never edited; corrections are
-- new reversing entries.
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  txn_id uuid not null,
  account public.ledger_account not null,
  party_type public.ledger_party not null,
  party_id uuid,
  debit_centavos integer not null default 0 check (debit_centavos >= 0),
  credit_centavos integer not null default 0 check (credit_centavos >= 0),
  order_id uuid references public.orders (id) on delete restrict,
  memo text check (char_length(memo) <= 300),
  created_at timestamptz not null default now(),
  constraint ledger_entries_one_side check ((debit_centavos > 0) <> (credit_centavos > 0)),
  constraint ledger_entries_party check (party_type = 'platform' or party_id is not null)
);
create index ledger_entries_txn_idx on public.ledger_entries (txn_id);
create index ledger_entries_party_idx on public.ledger_entries (party_type, party_id, created_at);
create index ledger_entries_order_idx on public.ledger_entries (order_id) where order_id is not null;
create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function private.forbid_change();
alter table public.ledger_entries enable row level security;

create function private.check_ledger_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_debits bigint;
  v_credits bigint;
begin
  select coalesce(sum(debit_centavos), 0), coalesce(sum(credit_centavos), 0)
    into v_debits, v_credits
  from public.ledger_entries where txn_id = new.txn_id;
  if v_debits <> v_credits then
    raise exception 'ledger transaction % is unbalanced: debits % <> credits % (centavos)', new.txn_id, v_debits, v_credits
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
create constraint trigger ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function private.check_ledger_balanced();

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  party_type public.ledger_party not null check (party_type in ('merchant', 'rider')),
  party_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount_centavos integer not null check (amount_centavos >= 0),
  status public.payout_status not null default 'draft',
  reference text check (char_length(reference) <= 100),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_period_order check (period_end >= period_start),
  constraint payouts_paid_has_time check (status <> 'paid' or paid_at is not null),
  unique (party_type, party_id, period_start, period_end)
);
create index payouts_party_idx on public.payouts (party_type, party_id, period_start desc);
create trigger payouts_updated_at before update on public.payouts
  for each row execute function private.set_updated_at();
alter table public.payouts enable row level security;

-- Each party sees its own money: merchant owners (not staff) their store's, riders their own.
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (
    private.is_admin()
    or (party_type = 'merchant' and private.is_merchant_owner(party_id))
    or (party_type = 'rider' and party_id = private.current_rider_id())
  );
create policy payouts_select on public.payouts for select to authenticated
  using (
    private.is_admin()
    or (party_type = 'merchant' and private.is_merchant_owner(party_id))
    or (party_type = 'rider' and party_id = private.current_rider_id())
  );

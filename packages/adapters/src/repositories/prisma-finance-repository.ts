import { randomUUID } from "node:crypto";
import type {
  CashHolder,
  FinanceTxn,
  IPayoutRepository,
  IRemittanceRepository,
  IReportRepository,
  ISettlementRepository,
  LedgerExportRow,
  PartyBalance,
  PayoutAccount,
  PayoutLine,
  PayoutParty,
  PayoutRecord,
  SettlementPlan,
  Week,
  ZoneScope,
  ZoneWeekFigures,
} from "@klikgo/core";
import { Prisma, type PrismaClient } from "@klikgo/db";
import type { LedgerAccount, PayoutStatus } from "@klikgo/types";

type Tx = Prisma.TransactionClient;

const num = (value: number | bigint | Prisma.Decimal | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

/** Books one balanced transaction (the deferred trigger checks debits = credits at commit). */
async function post(tx: Tx, txn: FinanceTxn): Promise<string> {
  const txnId = randomUUID();
  await tx.ledger_entries.createMany({
    data: txn.lines.map((line) => ({
      txn_id: txnId,
      account: line.account,
      party_type: line.partyType,
      party_id: line.partyId,
      debit_centavos: line.debitCentavos,
      credit_centavos: line.creditCentavos,
      memo: line.memo,
    })),
  });
  return txnId;
}

interface AccountColumns {
  method: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_name: string | null;
}

function toAccount(row: AccountColumns): PayoutAccount | null {
  if (!row.method || !row.account_name || !row.account_number) return null;
  return {
    method: row.method === "maya" || row.method === "bank" ? row.method : "gcash",
    accountName: row.account_name,
    accountNumber: row.account_number,
    bankName: row.bank_name,
  };
}

/** The display name of a store or rider. */
const partyName = Prisma.sql`
  case when p.party_type = 'merchant'
       then (select m.name from public.merchants m where m.id = p.party_id)
       else (select coalesce(pr.full_name, pr.phone, 'Rider') from public.riders r
               join public.profiles pr on pr.id = r.user_id where r.id = p.party_id) end`;

interface PayoutRow extends AccountColumns {
  id: string;
  party_type: PayoutParty;
  party_id: string;
  party_name: string | null;
  period_start: Date;
  period_end: Date;
  earnings_centavos: number;
  cash_netted_centavos: number;
  amount_centavos: number;
  status: PayoutStatus;
  reference: string | null;
  paid_at: Date | null;
  failure_reason: string | null;
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

function toPayout(row: PayoutRow): PayoutRecord {
  return {
    id: row.id,
    partyType: row.party_type,
    partyId: row.party_id,
    partyName: row.party_name ?? row.party_id,
    periodStart: isoDate(row.period_start),
    periodEnd: isoDate(row.period_end),
    earningsCentavos: row.earnings_centavos,
    cashNettedCentavos: row.cash_netted_centavos,
    amountCentavos: row.amount_centavos,
    status: row.status,
    account: toAccount(row),
    reference: row.reference,
    paidAt: row.paid_at,
    failureReason: row.failure_reason,
  };
}

/**
 * Settlement, payouts, cash hand-ins and reports from the double-entry ledger (ledger_entries,
 * payouts, payout_lines, payout_accounts, cod_remittances, settlement_runs). Every change that
 * moves money posts balanced ledger rows in the same transaction.
 */
export class PrismaFinanceRepository
  implements ISettlementRepository, IPayoutRepository, IRemittanceRepository, IReportRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  async hasRun(weekStart: string): Promise<boolean> {
    const run = await this.prisma.settlement_runs.findUnique({
      where: { period_start: new Date(`${weekStart}T00:00:00Z`) },
    });
    return run !== null;
  }

  async balances(week: Week): Promise<PartyBalance[]> {
    const rows = await this.prisma.$queryRaw<
      (AccountColumns & {
        party_type: PayoutParty;
        party_id: string;
        party_name: string | null;
        owed: bigint;
        held: bigint | null;
      })[]
    >`
      with p as (
        select le.party_type::text as party_type, le.party_id,
               sum(le.credit_centavos - le.debit_centavos) as owed
          from public.ledger_entries le
         where le.account in ('merchant_payable', 'rider_payable') and le.party_id is not null
           and le.created_at < ${week.endsAt}
         group by 1, 2
      )
      select p.party_type, p.party_id, p.owed, ${partyName} as party_name,
             case when p.party_type = 'rider' then (
               select sum(c.debit_centavos - c.credit_centavos) from public.ledger_entries c
                where c.account = 'rider_cash_on_hand' and c.party_id = p.party_id
                  and c.created_at < ${week.endsAt}) end as held,
             a.method, a.account_name, a.account_number, a.bank_name
        from p
        left join public.payout_accounts a
          on a.party_type::text = p.party_type and a.party_id = p.party_id
       where p.owed > 0
       order by p.party_type, party_name`;
    const entries = await this.prisma.$queryRaw<
      {
        party_id: string;
        order_id: string | null;
        code: string | null;
        amount: number;
        created_at: Date;
      }[]
    >`
      select le.party_id, le.order_id, o.code, (le.credit_centavos - le.debit_centavos) as amount, le.created_at
        from public.ledger_entries le
        left join public.orders o on o.id = le.order_id
       where le.account in ('merchant_payable', 'rider_payable')
         and le.created_at >= ${week.startsAt} and le.created_at < ${week.endsAt}
       order by le.created_at, le.id`;
    return rows.map((row) => ({
      partyType: row.party_type,
      partyId: row.party_id,
      name: row.party_name ?? row.party_id,
      payableCentavos: num(row.owed),
      cashHeldCentavos: num(row.held),
      entries: entries
        .filter((e) => e.party_id === row.party_id)
        .map((e) => ({
          orderId: e.order_id,
          orderCode: e.code,
          amountCentavos: e.amount,
          occurredAt: e.created_at,
        })),
      account: toAccount(row),
    }));
  }

  async record(plan: SettlementPlan): Promise<{ payouts: number; totalCentavos: number } | null> {
    return this.prisma.$transaction(async (tx) => {
      // The run row is the lock: a second run for the same week inserts nothing and stops.
      const claimed = await tx.$executeRaw`
        insert into public.settlement_runs (period_start, period_end, started_by)
        values (${plan.week.start}::date, ${plan.week.end}::date, ${plan.startedBy}::uuid)
        on conflict (period_start) do nothing`;
      if (claimed === 0) return null;
      let total = 0;
      for (const draft of plan.payouts) {
        for (const txn of draft.ledger) await post(tx, txn);
        const [payout] = await tx.$queryRaw<{ id: string }[]>`
          insert into public.payouts (party_type, party_id, period_start, period_end, amount_centavos,
                                      earnings_centavos, cash_netted_centavos, status, reference, paid_at,
                                      method, account_name, account_number, bank_name)
          values (${draft.partyType}::public.ledger_party, ${draft.partyId}::uuid, ${plan.week.start}::date,
                  ${plan.week.end}::date, ${draft.amountCentavos}, ${draft.earningsCentavos},
                  ${draft.cashNettedCentavos},
                  ${draft.settledInFull ? "paid" : "draft"}::public.payout_status,
                  ${draft.settledInFull ? "NETTED" : null}, ${draft.settledInFull ? new Date() : null},
                  ${draft.account?.method ?? null}, ${draft.account?.accountName ?? null},
                  ${draft.account?.accountNumber ?? null}, ${draft.account?.bankName ?? null})
          returning id`;
        if (!payout) throw new Error("payout insert returned no row");
        await tx.payout_lines.createMany({
          data: draft.lines.map((l) => ({
            payout_id: payout.id,
            kind: l.kind,
            order_id: l.orderId,
            description: l.description,
            amount_centavos: l.amountCentavos,
            occurred_at: l.occurredAt,
          })),
        });
        total += draft.amountCentavos;
      }
      await tx.$executeRaw`
        update public.settlement_runs set payouts = ${plan.payouts.length}, total_centavos = ${total}
         where period_start = ${plan.week.start}::date`;
      return { payouts: plan.payouts.length, totalCentavos: total };
    });
  }

  // -------------------------------------------------------------------------
  // Payouts
  // -------------------------------------------------------------------------

  async payouts(filter: {
    weekStart?: string;
    partyType?: PayoutParty;
    partyId?: string;
  }): Promise<PayoutRecord[]> {
    const rows = await this.prisma.$queryRaw<PayoutRow[]>`
      select p.id, p.party_type::text as party_type, p.party_id, ${partyName} as party_name,
             p.period_start, p.period_end, p.earnings_centavos, p.cash_netted_centavos, p.amount_centavos,
             p.status::text as status, p.reference, p.paid_at, p.failure_reason,
             p.method, p.account_name, p.account_number, p.bank_name
        from public.payouts p
       where (${filter.weekStart ?? null}::date is null or p.period_start = ${filter.weekStart ?? null}::date)
         and (${filter.partyType ?? null}::text is null or p.party_type::text = ${filter.partyType ?? null})
         and (${filter.partyId ?? null}::uuid is null or p.party_id = ${filter.partyId ?? null}::uuid)
       order by p.period_start desc, p.party_type, party_name
       limit 500`;
    return rows.map(toPayout);
  }

  async payout(id: string): Promise<PayoutRecord | null> {
    const rows = await this.prisma.$queryRaw<PayoutRow[]>`
      select p.id, p.party_type::text as party_type, p.party_id, ${partyName} as party_name,
             p.period_start, p.period_end, p.earnings_centavos, p.cash_netted_centavos, p.amount_centavos,
             p.status::text as status, p.reference, p.paid_at, p.failure_reason,
             coalesce(p.method, a.method) as method, coalesce(p.account_name, a.account_name) as account_name,
             coalesce(p.account_number, a.account_number) as account_number,
             coalesce(p.bank_name, a.bank_name) as bank_name
        from public.payouts p
        left join public.payout_accounts a on a.party_type = p.party_type and a.party_id = p.party_id
       where p.id = ${id}::uuid`;
    return rows[0] ? toPayout(rows[0]) : null;
  }

  async lines(payoutId: string): Promise<PayoutLine[]> {
    const rows = await this.prisma.$queryRaw<
      {
        kind: PayoutLine["kind"];
        code: string | null;
        description: string;
        amount_centavos: number;
        occurred_at: Date;
      }[]
    >`
      select l.kind, o.code, l.description, l.amount_centavos, l.occurred_at
        from public.payout_lines l left join public.orders o on o.id = l.order_id
       where l.payout_id = ${payoutId}::uuid
       order by l.occurred_at, l.id`;
    return rows.map((r) => ({
      kind: r.kind,
      orderCode: r.code,
      description: r.description,
      amountCentavos: r.amount_centavos,
      occurredAt: r.occurred_at,
    }));
  }

  async markPaid(input: {
    id: string;
    reference: string;
    by: string;
    ledger: FinanceTxn;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Snapshot where the money went, in case the account changes later.
      const account = (column: string) =>
        Prisma.sql`coalesce(p.${Prisma.raw(column)}, (select a.${Prisma.raw(column)} from public.payout_accounts a
                    where a.party_type = p.party_type and a.party_id = p.party_id))`;
      const changed = await tx.$executeRaw`
        update public.payouts p
           set status = 'paid', reference = ${input.reference}, paid_at = now(), paid_by = ${input.by}::uuid,
               method = ${account("method")}, account_name = ${account("account_name")},
               account_number = ${account("account_number")}, bank_name = ${account("bank_name")}
         where p.id = ${input.id}::uuid and p.status = 'draft'`;
      if (changed === 0) return false;
      await post(tx, input.ledger);
      return true;
    });
  }

  async markFailed(input: { id: string; reason: string; ledger: FinanceTxn }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.$executeRaw`
        update public.payouts set status = 'failed', failure_reason = ${input.reason}
         where id = ${input.id}::uuid and status = 'draft'`;
      if (changed === 0) return false;
      await post(tx, input.ledger);
      return true;
    });
  }

  async account(partyType: PayoutParty, partyId: string): Promise<PayoutAccount | null> {
    const row = await this.prisma.payout_accounts.findUnique({
      where: { party_type_party_id: { party_type: partyType, party_id: partyId } },
    });
    return row ? toAccount(row) : null;
  }

  async saveAccount(
    partyType: PayoutParty,
    partyId: string,
    account: PayoutAccount,
    by: string,
  ): Promise<void> {
    const data = {
      method: account.method,
      account_name: account.accountName,
      account_number: account.accountNumber,
      bank_name: account.bankName,
      updated_by: by,
    };
    await this.prisma.payout_accounts.upsert({
      where: { party_type_party_id: { party_type: partyType, party_id: partyId } },
      create: { party_type: partyType, party_id: partyId, ...data },
      update: data,
    });
  }

  async openBalance(
    partyType: PayoutParty,
    partyId: string,
  ): Promise<{ payableCentavos: number; cashHeldCentavos: number }> {
    const account: LedgerAccount = partyType === "merchant" ? "merchant_payable" : "rider_payable";
    const [row] = await this.prisma.$queryRaw<{ owed: bigint | null; held: bigint | null }[]>`
      select (select sum(credit_centavos - debit_centavos) from public.ledger_entries
               where account = ${account}::public.ledger_account and party_id = ${partyId}::uuid) as owed,
             (select sum(debit_centavos - credit_centavos) from public.ledger_entries
               where account = 'rider_cash_on_hand' and party_id = ${partyId}::uuid) as held`;
    return {
      payableCentavos: num(row?.owed),
      cashHeldCentavos: partyType === "rider" ? num(row?.held) : 0,
    };
  }

  async riderOf(userId: string): Promise<{ id: string; zoneId: string } | null> {
    const rider = await this.prisma.riders.findUnique({ where: { user_id: userId } });
    return rider ? { id: rider.id, zoneId: rider.zone_id } : null;
  }

  // -------------------------------------------------------------------------
  // Cash hand-ins
  // -------------------------------------------------------------------------

  private async holdersWhere(where: Prisma.Sql): Promise<CashHolder[]> {
    const rows = await this.prisma.$queryRaw<
      {
        rider_id: string;
        name: string | null;
        zone_id: string;
        held: bigint | null;
        cash_limit_centavos: number;
        last_at: Date | null;
      }[]
    >`
      select r.id as rider_id, coalesce(pr.full_name, pr.phone) as name, r.zone_id, r.cash_limit_centavos,
             (select sum(debit_centavos - credit_centavos) from public.ledger_entries
               where account = 'rider_cash_on_hand' and party_id = r.id) as held,
             (select max(created_at) from public.cod_remittances c where c.rider_id = r.id) as last_at
        from public.riders r join public.profiles pr on pr.id = r.user_id
       where ${where}`;
    return rows.map((r) => ({
      riderId: r.rider_id,
      name: r.name ?? "Rider",
      zoneId: r.zone_id,
      cashHeldCentavos: num(r.held),
      cashLimitCentavos: r.cash_limit_centavos,
      lastHandInAt: r.last_at,
    }));
  }

  async holders(scope: ZoneScope): Promise<CashHolder[]> {
    const zones = scope === "all" ? null : [...scope];
    const all = await this.holdersWhere(
      Prisma.sql`(${zones}::uuid[] is null or r.zone_id = any(${zones}::uuid[]))`,
    );
    return all.filter((h) => h.cashHeldCentavos > 0);
  }

  async holder(riderId: string): Promise<CashHolder | null> {
    const [found] = await this.holdersWhere(Prisma.sql`r.id = ${riderId}::uuid`);
    return found ?? null;
  }

  async recordHandIn(input: {
    riderId: string;
    zoneId: string;
    amountCentavos: number;
    reference: string;
    receivedBy: string;
    ledger: FinanceTxn;
  }): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const txnId = await post(tx, input.ledger);
      const saved = await tx.cod_remittances.create({
        data: {
          rider_id: input.riderId,
          zone_id: input.zoneId,
          amount_centavos: input.amountCentavos,
          reference: input.reference,
          received_by: input.receivedBy,
          ledger_txn_id: txnId,
        },
      });
      return { id: saved.id };
    });
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  async zoneWeeks(week: Week): Promise<ZoneWeekFigures[]> {
    const rows = await this.prisma.$queryRaw<
      {
        zone_id: string;
        zone_name: string;
        delivered: number;
        cod: number;
        gmv: bigint | null;
        tips: bigint | null;
        revenue: bigint | null;
        promo: bigint | null;
        fees: bigint | null;
        refunds: bigint | null;
      }[]
    >`
      with d as (
        select o.* from public.orders o
         where o.status = 'delivered' and o.delivered_at >= ${week.startsAt} and o.delivered_at < ${week.endsAt}
      ), l as (
        select d.zone_id, le.account, sum(le.debit_centavos - le.credit_centavos) as net
          from d join public.ledger_entries le on le.order_id = d.id
         where le.account in ('platform_revenue', 'promo_expense', 'gateway_fees')
         group by 1, 2
      )
      select z.id as zone_id, z.name as zone_name,
             (select count(*)::int from d where d.zone_id = z.id) as delivered,
             (select count(*)::int from d where d.zone_id = z.id and d.payment_method = 'cod') as cod,
             (select sum(d.subtotal_centavos + d.delivery_fee_centavos + d.service_fee_centavos
                         + d.small_order_fee_centavos) from d where d.zone_id = z.id) as gmv,
             (select sum(d.tip_centavos) from d where d.zone_id = z.id) as tips,
             (select -net from l where l.zone_id = z.id and l.account = 'platform_revenue') as revenue,
             (select net from l where l.zone_id = z.id and l.account = 'promo_expense') as promo,
             (select net from l where l.zone_id = z.id and l.account = 'gateway_fees') as fees,
             (select sum(f.amount_centavos) from public.refunds f join public.orders o on o.id = f.order_id
               where o.zone_id = z.id and f.status = 'succeeded'
                 and f.created_at >= ${week.startsAt} and f.created_at < ${week.endsAt}) as refunds
        from public.zones z
       where z.is_active
       order by z.name`;
    return rows.map((r) => ({
      zoneId: r.zone_id,
      zoneName: r.zone_name,
      deliveredOrders: r.delivered,
      codOrders: r.cod,
      gmvCentavos: num(r.gmv),
      tipsCentavos: num(r.tips),
      platformRevenueCentavos: num(r.revenue),
      promoCostCentavos: num(r.promo),
      gatewayFeesCentavos: num(r.fees),
      refundsCentavos: num(r.refunds),
    }));
  }

  async ledger(week: Week): Promise<LedgerExportRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        created_at: Date;
        txn_id: string;
        account: LedgerAccount;
        party_type: string;
        code: string | null;
        debit_centavos: number;
        credit_centavos: number;
        memo: string | null;
      }[]
    >`
      select le.created_at, le.txn_id, le.account::text as account, le.party_type::text as party_type, o.code,
             le.debit_centavos, le.credit_centavos, le.memo
        from public.ledger_entries le left join public.orders o on o.id = le.order_id
       where le.created_at >= ${week.startsAt} and le.created_at < ${week.endsAt}
       order by le.created_at, le.id`;
    return rows.map((r) => ({
      createdAt: r.created_at,
      txnId: r.txn_id,
      account: r.account,
      partyType: r.party_type,
      orderCode: r.code,
      debitCentavos: r.debit_centavos,
      creditCentavos: r.credit_centavos,
      memo: r.memo,
    }));
  }
}

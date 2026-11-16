import type { LedgerAccount, PayoutStatus } from "@klikgo/types";
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
  ZoneWeekFigures,
} from "../finance/ports";
import type { Week } from "../finance/week";
import type { ZoneScope } from "../ops/ports";

interface Entry {
  readonly txnId: string;
  readonly account: LedgerAccount;
  readonly partyType: string;
  readonly partyId: string | null;
  readonly debit: number;
  readonly credit: number;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly createdAt: Date;
}

interface StoredPayout extends PayoutRecord {
  lines: PayoutLine[];
}

/**
 * The money side of the database in memory: a double-entry ledger (balanced transactions only),
 * payouts with lines, payout accounts, cash hand-ins and settlement runs. Balances are worked out
 * from the ledger rows the same way the SQL does, so tests can check payouts against the ledger.
 */
export class InMemoryFinance
  implements ISettlementRepository, IPayoutRepository, IRemittanceRepository, IReportRepository
{
  readonly entries: Entry[] = [];
  readonly payoutsStore: StoredPayout[] = [];
  readonly accounts = new Map<string, PayoutAccount>();
  readonly names = new Map<string, string>();
  readonly riders = new Map<
    string,
    { zoneId: string; userId: string; cashLimitCentavos: number }
  >();
  readonly runs = new Set<string>();
  readonly handIns: { riderId: string; amountCentavos: number; reference: string; at: Date }[] = [];
  readonly figures: ZoneWeekFigures[] = [];
  private sequence = 0;

  constructor(private readonly now: () => Date) {}

  // --- test setup ------------------------------------------------------------

  /** Books one balanced transaction (throws like the database if it is not). */
  post(
    lines: readonly {
      account: LedgerAccount;
      partyType: string;
      partyId: string | null;
      debit?: number;
      credit?: number;
    }[],
    options: { orderId?: string; orderCode?: string; at?: Date } = {},
  ): void {
    const net = lines.reduce((sum, l) => sum + (l.debit ?? 0) - (l.credit ?? 0), 0);
    if (net !== 0) throw new Error(`ledger transaction is unbalanced (${String(net)})`);
    this.sequence += 1;
    const txnId = `txn-${String(this.sequence)}`;
    for (const l of lines) {
      this.entries.push({
        txnId,
        account: l.account,
        partyType: l.partyType,
        partyId: l.partyId,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        orderId: options.orderId ?? null,
        orderCode: options.orderCode ?? null,
        createdAt: options.at ?? this.now(),
      });
    }
  }

  /** A delivered order's settlement rows, as delivery books them (see LedgerService.settlement). */
  delivered(input: {
    orderCode: string;
    merchantId: string;
    riderId: string;
    merchantCentavos: number;
    riderCentavos: number;
    platformCentavos: number;
    cash: boolean;
    at: Date;
  }): void {
    const total = input.merchantCentavos + input.riderCentavos + input.platformCentavos;
    this.post(
      [
        input.cash
          ? {
              account: "rider_cash_on_hand",
              partyType: "rider",
              partyId: input.riderId,
              debit: total,
            }
          : {
              account: "customer_deposits",
              partyType: "customer",
              partyId: "customer-1",
              debit: total,
            },
        {
          account: "merchant_payable",
          partyType: "merchant",
          partyId: input.merchantId,
          credit: input.merchantCentavos,
        },
        {
          account: "rider_payable",
          partyType: "rider",
          partyId: input.riderId,
          credit: input.riderCentavos,
        },
        {
          account: "platform_revenue",
          partyType: "platform",
          partyId: null,
          credit: input.platformCentavos,
        },
      ],
      { orderId: `order-${input.orderCode}`, orderCode: input.orderCode, at: input.at },
    );
  }

  /** Balance of an account for a party up to (not including) `before`: debits less credits. */
  balance(account: LedgerAccount, partyId: string | null, before?: Date): number {
    return this.entries
      .filter(
        (e) => e.account === account && e.partyId === partyId && (!before || e.createdAt < before),
      )
      .reduce((sum, e) => sum + e.debit - e.credit, 0);
  }

  private book(txn: FinanceTxn): void {
    this.post(
      txn.lines.map((l) => ({
        account: l.account,
        partyType: l.partyType,
        partyId: l.partyId,
        debit: l.debitCentavos,
        credit: l.creditCentavos,
      })),
    );
  }

  private key(partyType: PayoutParty, partyId: string): string {
    return `${partyType}:${partyId}`;
  }

  // --- settlement ------------------------------------------------------------

  hasRun(weekStart: string): Promise<boolean> {
    return Promise.resolve(this.runs.has(weekStart));
  }

  balances(week: Week): Promise<PartyBalance[]> {
    const parties = new Map<string, { partyType: PayoutParty; partyId: string }>();
    for (const e of this.entries) {
      if ((e.account === "merchant_payable" || e.account === "rider_payable") && e.partyId) {
        const partyType = e.account === "merchant_payable" ? "merchant" : "rider";
        parties.set(this.key(partyType, e.partyId), { partyType, partyId: e.partyId });
      }
    }
    return Promise.resolve(
      [...parties.values()].map(({ partyType, partyId }) => {
        const account = partyType === "merchant" ? "merchant_payable" : "rider_payable";
        return {
          partyType,
          partyId,
          name: this.names.get(partyId) ?? partyId,
          payableCentavos: 0 - this.balance(account, partyId, week.endsAt),
          cashHeldCentavos:
            partyType === "rider" ? this.balance("rider_cash_on_hand", partyId, week.endsAt) : 0,
          entries: this.entries
            .filter(
              (e) =>
                e.account === account &&
                e.partyId === partyId &&
                e.createdAt >= week.startsAt &&
                e.createdAt < week.endsAt,
            )
            .map((e) => ({
              orderId: e.orderId,
              orderCode: e.orderCode,
              amountCentavos: e.credit - e.debit,
              occurredAt: e.createdAt,
            })),
          account: this.accounts.get(this.key(partyType, partyId)) ?? null,
        };
      }),
    );
  }

  record(plan: SettlementPlan): Promise<{ payouts: number; totalCentavos: number } | null> {
    if (this.runs.has(plan.week.start)) return Promise.resolve(null);
    this.runs.add(plan.week.start);
    let total = 0;
    for (const draft of plan.payouts) {
      for (const t of draft.ledger) this.book(t);
      this.sequence += 1;
      const status: PayoutStatus = draft.settledInFull ? "paid" : "draft";
      this.payoutsStore.push({
        id: `payout-${String(this.sequence)}`,
        partyType: draft.partyType,
        partyId: draft.partyId,
        partyName: this.names.get(draft.partyId) ?? draft.partyId,
        periodStart: plan.week.start,
        periodEnd: plan.week.end,
        earningsCentavos: draft.earningsCentavos,
        cashNettedCentavos: draft.cashNettedCentavos,
        amountCentavos: draft.amountCentavos,
        status,
        account: draft.account,
        reference: draft.settledInFull ? "NETTED" : null,
        paidAt: draft.settledInFull ? this.now() : null,
        failureReason: null,
        lines: draft.lines.map((l) => ({
          kind: l.kind,
          orderCode: l.orderId
            ? (this.entries.find((e) => e.orderId === l.orderId)?.orderCode ?? null)
            : null,
          description: l.description,
          amountCentavos: l.amountCentavos,
          occurredAt: l.occurredAt,
        })),
      });
      total += draft.amountCentavos;
    }
    return Promise.resolve({ payouts: plan.payouts.length, totalCentavos: total });
  }

  // --- payouts ---------------------------------------------------------------

  payouts(filter: {
    weekStart?: string;
    partyType?: PayoutParty;
    partyId?: string;
  }): Promise<PayoutRecord[]> {
    return Promise.resolve(
      this.payoutsStore
        .filter(
          (p) =>
            (!filter.weekStart || p.periodStart === filter.weekStart) &&
            (!filter.partyType || p.partyType === filter.partyType) &&
            (!filter.partyId || p.partyId === filter.partyId),
        )
        .map(({ lines: _lines, ...p }) => p),
    );
  }

  payout(id: string): Promise<PayoutRecord | null> {
    const found = this.payoutsStore.find((p) => p.id === id);
    if (!found) return Promise.resolve(null);
    const { lines: _lines, ...payout } = found;
    return Promise.resolve(payout);
  }

  lines(payoutId: string): Promise<PayoutLine[]> {
    return Promise.resolve(this.payoutsStore.find((p) => p.id === payoutId)?.lines ?? []);
  }

  markPaid(input: {
    id: string;
    reference: string;
    by: string;
    ledger: FinanceTxn;
  }): Promise<boolean> {
    const p = this.payoutsStore.find((x) => x.id === input.id);
    if (!p || p.status !== "draft") return Promise.resolve(false);
    this.book(input.ledger);
    Object.assign(p, { status: "paid", reference: input.reference, paidAt: this.now() });
    return Promise.resolve(true);
  }

  markFailed(input: { id: string; reason: string; ledger: FinanceTxn }): Promise<boolean> {
    const p = this.payoutsStore.find((x) => x.id === input.id);
    if (!p || p.status !== "draft") return Promise.resolve(false);
    this.book(input.ledger);
    Object.assign(p, { status: "failed", failureReason: input.reason });
    return Promise.resolve(true);
  }

  account(partyType: PayoutParty, partyId: string): Promise<PayoutAccount | null> {
    return Promise.resolve(this.accounts.get(this.key(partyType, partyId)) ?? null);
  }

  saveAccount(partyType: PayoutParty, partyId: string, account: PayoutAccount): Promise<void> {
    this.accounts.set(this.key(partyType, partyId), account);
    return Promise.resolve();
  }

  openBalance(
    partyType: PayoutParty,
    partyId: string,
  ): Promise<{ payableCentavos: number; cashHeldCentavos: number }> {
    return Promise.resolve({
      payableCentavos:
        0 - this.balance(partyType === "merchant" ? "merchant_payable" : "rider_payable", partyId),
      cashHeldCentavos: partyType === "rider" ? this.balance("rider_cash_on_hand", partyId) : 0,
    });
  }

  riderOf(userId: string): Promise<{ id: string; zoneId: string } | null> {
    const entry = [...this.riders.entries()].find(([, r]) => r.userId === userId);
    return Promise.resolve(entry ? { id: entry[0], zoneId: entry[1].zoneId } : null);
  }

  // --- cash hand-ins ---------------------------------------------------------

  private holderOf(riderId: string): CashHolder | null {
    const rider = this.riders.get(riderId);
    if (!rider) return null;
    const last = this.handIns.filter((h) => h.riderId === riderId).at(-1);
    return {
      riderId,
      name: this.names.get(riderId) ?? riderId,
      zoneId: rider.zoneId,
      cashHeldCentavos: this.balance("rider_cash_on_hand", riderId),
      cashLimitCentavos: rider.cashLimitCentavos,
      lastHandInAt: last?.at ?? null,
    };
  }

  holders(scope: ZoneScope): Promise<CashHolder[]> {
    return Promise.resolve(
      [...this.riders.keys()]
        .map((id) => this.holderOf(id))
        .filter((h): h is CashHolder => h !== null && h.cashHeldCentavos > 0)
        .filter((h) => scope === "all" || scope.includes(h.zoneId)),
    );
  }

  holder(riderId: string): Promise<CashHolder | null> {
    return Promise.resolve(this.holderOf(riderId));
  }

  recordHandIn(input: {
    riderId: string;
    zoneId: string;
    amountCentavos: number;
    reference: string;
    receivedBy: string;
    ledger: FinanceTxn;
  }): Promise<{ id: string }> {
    this.book(input.ledger);
    this.handIns.push({
      riderId: input.riderId,
      amountCentavos: input.amountCentavos,
      reference: input.reference,
      at: this.now(),
    });
    return Promise.resolve({ id: `handin-${String(this.handIns.length)}` });
  }

  // --- reports ---------------------------------------------------------------

  zoneWeeks(): Promise<ZoneWeekFigures[]> {
    return Promise.resolve([...this.figures]);
  }

  ledger(week: Week): Promise<LedgerExportRow[]> {
    return Promise.resolve(
      this.entries
        .filter((e) => e.createdAt >= week.startsAt && e.createdAt < week.endsAt)
        .map((e) => ({
          createdAt: e.createdAt,
          txnId: e.txnId,
          account: e.account,
          partyType: e.partyType,
          orderCode: e.orderCode,
          debitCentavos: e.debit,
          creditCentavos: e.credit,
          memo: null,
        })),
    );
  }
}

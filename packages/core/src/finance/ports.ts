import type { LedgerAccount, PayoutStatus } from "@klikgo/types";
import type { LedgerLine } from "../ordering/ports";
import type { Centavos } from "../shared/money";
import type { Result } from "../shared/result";
import type { AppError } from "../shared/errors";
import type { ZoneScope } from "../ops/ports";
import type { Week } from "./week";

export type PayoutParty = "merchant" | "rider";
export type PayoutMethod = "gcash" | "maya" | "bank";

/** Where a store or rider is paid. */
export interface PayoutAccount {
  readonly method: PayoutMethod;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly bankName: string | null;
}

/** A balanced set of ledger lines that belongs to no single order (payouts, hand-ins). */
export interface FinanceTxn {
  readonly lines: readonly LedgerLine[];
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** One ledger row on a payable account inside the week, for the statement's lines. */
export interface PayableEntry {
  readonly orderId: string | null;
  readonly orderCode: string | null;
  /** Credit minus debit (what this row added to what is owed). */
  readonly amountCentavos: Centavos;
  readonly occurredAt: Date;
}

/** What a store or rider is owed at the end of a week, from the ledger. */
export interface PartyBalance {
  readonly partyType: PayoutParty;
  readonly partyId: string;
  readonly name: string;
  /** Payable balance up to the week's end: everything earned and not yet settled. */
  readonly payableCentavos: Centavos;
  /** Riders: cash on delivery still held up to the week's end (0 for stores). */
  readonly cashHeldCentavos: Centavos;
  /** The payable rows inside the week (older unsettled money shows as one carried line). */
  readonly entries: readonly PayableEntry[];
  readonly account: PayoutAccount | null;
}

export interface PayoutLineDraft {
  readonly kind: "order" | "carried_over" | "cash_netted";
  readonly orderId: string | null;
  readonly description: string;
  readonly amountCentavos: Centavos;
  readonly occurredAt: Date;
}

/** One payout the settlement creates, with its ledger postings. */
export interface PayoutDraft {
  readonly partyType: PayoutParty;
  readonly partyId: string;
  readonly earningsCentavos: Centavos;
  readonly cashNettedCentavos: Centavos;
  readonly amountCentavos: Centavos;
  /** Fully netted against cash: nothing to send, so it is closed at once. */
  readonly settledInFull: boolean;
  readonly account: PayoutAccount | null;
  readonly lines: readonly PayoutLineDraft[];
  readonly ledger: readonly FinanceTxn[];
}

export interface SettlementPlan {
  readonly week: Week;
  readonly startedBy: string | null;
  readonly payouts: readonly PayoutDraft[];
}

export interface ISettlementRepository {
  hasRun(weekStart: string): Promise<boolean>;
  balances(week: Week): Promise<PartyBalance[]>;
  /**
   * Records the run, payouts, lines and ledger in one transaction. Null when the week was
   * already settled (the run row is the lock, so two runs never both settle a week).
   */
  record(
    plan: SettlementPlan,
  ): Promise<{ readonly payouts: number; readonly totalCentavos: Centavos } | null>;
}

// ---------------------------------------------------------------------------
// Payouts and statements
// ---------------------------------------------------------------------------

export interface PayoutRecord {
  readonly id: string;
  readonly partyType: PayoutParty;
  readonly partyId: string;
  readonly partyName: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly earningsCentavos: Centavos;
  readonly cashNettedCentavos: Centavos;
  readonly amountCentavos: Centavos;
  readonly status: PayoutStatus;
  readonly account: PayoutAccount | null;
  readonly reference: string | null;
  readonly paidAt: Date | null;
  readonly failureReason: string | null;
}

export interface PayoutLine {
  readonly kind: PayoutLineDraft["kind"];
  readonly orderCode: string | null;
  readonly description: string;
  readonly amountCentavos: Centavos;
  readonly occurredAt: Date;
}

export interface IPayoutRepository {
  payouts(filter: {
    readonly weekStart?: string;
    readonly partyType?: PayoutParty;
    readonly partyId?: string;
  }): Promise<PayoutRecord[]>;
  payout(id: string): Promise<PayoutRecord | null>;
  lines(payoutId: string): Promise<PayoutLine[]>;
  /** Marks a draft paid with its reference and ledger, once; false if it was not a draft. */
  markPaid(input: {
    readonly id: string;
    readonly reference: string;
    readonly by: string;
    readonly ledger: FinanceTxn;
  }): Promise<boolean>;
  /** Marks a draft failed and gives the money back to the payable account; false if not a draft. */
  markFailed(input: {
    readonly id: string;
    readonly reason: string;
    readonly ledger: FinanceTxn;
  }): Promise<boolean>;
  account(partyType: PayoutParty, partyId: string): Promise<PayoutAccount | null>;
  saveAccount(
    partyType: PayoutParty,
    partyId: string,
    account: PayoutAccount,
    by: string,
  ): Promise<void>;
  /** Unsettled money right now: payable balance and (riders) cash held. */
  openBalance(
    partyType: PayoutParty,
    partyId: string,
  ): Promise<{ readonly payableCentavos: Centavos; readonly cashHeldCentavos: Centavos }>;
  /** The rider record of a signed-in user. */
  riderOf(userId: string): Promise<{ readonly id: string; readonly zoneId: string } | null>;
}

/** Sends money out. Manual for the pilot (a person transfers and types the reference). */
export interface IDisbursementGateway {
  readonly name: string;
  /** False: payouts are transferred by hand and marked paid with the transfer reference. */
  readonly automatic: boolean;
  disburse(request: {
    readonly payoutId: string;
    readonly amountCentavos: Centavos;
    readonly account: PayoutAccount;
  }): Promise<Result<{ readonly reference: string }, AppError>>;
}

// ---------------------------------------------------------------------------
// Cash hand-ins
// ---------------------------------------------------------------------------

export interface CashHolder {
  readonly riderId: string;
  readonly name: string;
  readonly zoneId: string;
  readonly cashHeldCentavos: Centavos;
  readonly cashLimitCentavos: Centavos;
  readonly lastHandInAt: Date | null;
}

export interface IRemittanceRepository {
  holders(scope: ZoneScope): Promise<CashHolder[]>;
  holder(riderId: string): Promise<CashHolder | null>;
  /** Records the hand-in and its ledger in one transaction. */
  recordHandIn(input: {
    readonly riderId: string;
    readonly zoneId: string;
    readonly amountCentavos: Centavos;
    readonly reference: string;
    readonly receivedBy: string;
    readonly ledger: FinanceTxn;
  }): Promise<{ readonly id: string }>;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** One zone's week, as raw sums from orders and the ledger. */
export interface ZoneWeekFigures {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly deliveredOrders: number;
  readonly codOrders: number;
  /** Subtotals plus delivery, service and small-order fees of delivered orders (before promos). */
  readonly gmvCentavos: Centavos;
  readonly tipsCentavos: Centavos;
  /** Commission plus fees kept, after rider pay (platform_revenue credits). */
  readonly platformRevenueCentavos: Centavos;
  readonly promoCostCentavos: Centavos;
  readonly gatewayFeesCentavos: Centavos;
  readonly refundsCentavos: Centavos;
}

export interface LedgerExportRow {
  readonly createdAt: Date;
  readonly txnId: string;
  readonly account: LedgerAccount;
  readonly partyType: string;
  readonly orderCode: string | null;
  readonly debitCentavos: Centavos;
  readonly creditCentavos: Centavos;
  readonly memo: string | null;
}

export interface IReportRepository {
  zoneWeeks(week: Week): Promise<ZoneWeekFigures[]>;
  ledger(week: Week): Promise<LedgerExportRow[]>;
}

import type { SessionUser } from "../auth/session-user";
import type { ConsoleAccess } from "../ops/console-access";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { ConflictError, ValidationError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type {
  FinanceTxn,
  ISettlementRepository,
  PartyBalance,
  PayoutDraft,
  PayoutLineDraft,
  SettlementPlan,
} from "./ports";
import { line, txn } from "./postings";
import { previousWeek, weekStarting, type Week } from "./week";

/** Smaller balances wait for the next week (docs/BUSINESS.md Appendix A "minimum payout"). */
export const MIN_PAYOUT_CENTAVOS = 10_000;

/** What one settlement run did. */
export interface SettlementRun {
  readonly week: Pick<Week, "start" | "end">;
  readonly payouts: number;
  readonly totalCentavos: Centavos;
}

/**
 * Weekly settlement (docs/BUSINESS.md §5.2 step 7, §5.3–5.4; docs/BUILD_PLAN.md Phase 10). For the
 * week Monday to Sunday (Asia/Manila), every store and rider is paid what the ledger says they are
 * owed: stores their subtotal less commission (and less promos they funded), riders their trip pay
 * and tips. Cash on delivery a rider still holds is netted against their earnings first. Each payout
 * moves its amount from the payable account to `payouts_due`, so payouts equal the ledger and the
 * next week starts from what is left. Balances under ₱100 wait for the next week. One run per week.
 */
export class SettlementService {
  constructor(
    private readonly deps: {
      settlements: ISettlementRepository;
      access: ConsoleAccess;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  /** The background job: settles last week once, any time after it ends. */
  async settleDueWeek(): Promise<SettlementRun | null> {
    const week = previousWeek(this.deps.clock.now());
    if (await this.deps.settlements.hasRun(week.start)) return null;
    const run = await this.run(week, null);
    return run.ok ? run.value : null;
  }

  /** An admin settles a finished week by hand (e.g. the first week, or after fixing an account). */
  async settleWeek(
    user: SessionUser | null,
    weekStart: string,
  ): Promise<Result<SettlementRun, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const week = weekStarting(weekStart);
    if (!week) {
      return err(
        new ValidationError("Pick a Monday.", [{ path: "weekStart", message: "Not a Monday" }]),
      );
    }
    if (week.endsAt > this.deps.clock.now()) {
      return err(new ConflictError("This week isn't over yet."));
    }
    const run = await this.run(week, admin.value.id);
    if (run.ok) {
      await this.deps.access.record(
        admin.value,
        "settlement.run",
        { type: "settlement_runs", id: null },
        {
          weekStart: week.start,
          payouts: run.value.payouts,
          totalCentavos: run.value.totalCentavos,
        },
      );
    }
    return run;
  }

  private async run(
    week: Week,
    startedBy: string | null,
  ): Promise<Result<SettlementRun, AppError>> {
    const balances = await this.deps.settlements.balances(week);
    const plan = this.plan(week, balances, startedBy);
    const recorded = await this.deps.settlements.record(plan);
    if (!recorded) return err(new ConflictError("This week was already settled."));
    this.deps.logger.info("settlement.run", {
      weekStart: week.start,
      payouts: recorded.payouts,
      totalCentavos: recorded.totalCentavos,
    });
    return ok({ week: { start: week.start, end: week.end }, ...recorded });
  }

  /** The payouts for a week's balances (pure, so every rule is easy to test). */
  plan(week: Week, balances: readonly PartyBalance[], startedBy: string | null): SettlementPlan {
    const payouts: PayoutDraft[] = [];
    for (const balance of balances) {
      const draft =
        balance.partyType === "merchant"
          ? this.merchantPayout(balance, week)
          : this.riderPayout(balance, week);
      if (draft) payouts.push(draft);
    }
    return { week, startedBy, payouts };
  }

  private merchantPayout(balance: PartyBalance, week: Week): PayoutDraft | null {
    const owed = balance.payableCentavos;
    if (owed < MIN_PAYOUT_CENTAVOS) return null;
    return {
      partyType: "merchant",
      partyId: balance.partyId,
      earningsCentavos: owed,
      cashNettedCentavos: 0,
      amountCentavos: owed,
      settledInFull: false,
      account: balance.account,
      lines: earningLines(balance, owed, "Order (subtotal less commission)", week),
      ledger: [
        txn([
          line("merchant_payable", "merchant", balance.partyId, owed, "Weekly payout approved"),
          line("payouts_due", "merchant", balance.partyId, -owed, "Weekly payout approved"),
        ]),
      ],
    };
  }

  private riderPayout(balance: PartyBalance, week: Week): PayoutDraft | null {
    const earned = balance.payableCentavos;
    if (earned <= 0) return null;
    const netted = Math.min(earned, Math.max(balance.cashHeldCentavos, 0));
    const amount = earned - netted;
    // Nothing to send and no cash to net: wait for more earnings.
    if (amount < MIN_PAYOUT_CENTAVOS && netted === 0) return null;
    const ledger: FinanceTxn[] = [];
    if (netted > 0) {
      ledger.push(
        txn([
          line(
            "rider_payable",
            "rider",
            balance.partyId,
            netted,
            "Cash on delivery netted against earnings",
          ),
          line(
            "rider_cash_on_hand",
            "rider",
            balance.partyId,
            -netted,
            "Cash on delivery netted against earnings",
          ),
        ]),
      );
    }
    if (amount > 0) {
      ledger.push(
        txn([
          line("rider_payable", "rider", balance.partyId, amount, "Weekly payout approved"),
          line("payouts_due", "rider", balance.partyId, -amount, "Weekly payout approved"),
        ]),
      );
    }
    const lines = earningLines(balance, earned, "Delivery (pay and tip)", week);
    if (netted > 0) {
      lines.push({
        kind: "cash_netted",
        orderId: null,
        description: "Cash on delivery you still held",
        amountCentavos: -netted,
        occurredAt: week.endsAt,
      });
    }
    return {
      partyType: "rider",
      partyId: balance.partyId,
      earningsCentavos: earned,
      cashNettedCentavos: netted,
      amountCentavos: amount,
      settledInFull: amount === 0,
      account: balance.account,
      lines,
      ledger,
    };
  }
}

/** The week's order lines plus one line for money carried over from earlier weeks. */
function earningLines(
  balance: PartyBalance,
  owed: Centavos,
  label: string,
  week: Week,
): PayoutLineDraft[] {
  const lines: PayoutLineDraft[] = balance.entries.map((entry) => ({
    kind: "order",
    orderId: entry.orderId,
    description: entry.orderCode ? `${label} ${entry.orderCode}` : label,
    amountCentavos: entry.amountCentavos,
    occurredAt: entry.occurredAt,
  }));
  const inWeek = lines.reduce((sum, l) => sum + l.amountCentavos, 0);
  if (owed !== inWeek) {
    lines.unshift({
      kind: "carried_over",
      orderId: null,
      description: "Carried over from earlier weeks",
      amountCentavos: owed - inWeek,
      occurredAt: week.startsAt,
    });
  }
  return lines;
}

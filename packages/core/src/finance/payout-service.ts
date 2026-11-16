import type { PayoutAccountInput } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import type { ConsoleAccess } from "../ops/console-access";
import type { Logger } from "../ports/logger";
import { toCsv } from "../shared/csv";
import { formatManilaDateTime } from "../shared/time";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type AppError,
} from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import { line, txn } from "./postings";
import type {
  IDisbursementGateway,
  IPayoutRepository,
  PayoutAccount,
  PayoutLine,
  PayoutParty,
  PayoutRecord,
} from "./ports";
import { MIN_PAYOUT_CENTAVOS } from "./settlement-service";

/** A payout with how it adds up. */
export interface PayoutStatement extends PayoutRecord {
  readonly lines: readonly PayoutLine[];
}

/** A store's or rider's money page: where they are paid, what is open, past statements. */
export interface PayoutsPage {
  readonly account: PayoutAccount | null;
  /** Earned and not yet settled (paid in the next weekly settlement). */
  readonly openCentavos: Centavos;
  /** Riders: cash on delivery still held, netted against earnings at settlement. */
  readonly cashHeldCentavos: Centavos;
  readonly minimumCentavos: Centavos;
  readonly payouts: readonly PayoutRecord[];
}

/** A CSV file to download. */
export interface CsvFile {
  readonly filename: string;
  readonly body: string;
}

const METHOD_LABEL: Readonly<Record<PayoutAccount["method"], string>> = {
  gcash: "GCash",
  maya: "Maya",
  bank: "Bank",
};

/**
 * Payouts (docs/BUSINESS.md §5.3 Friday payouts, §5.4; docs/BUILD_PLAN.md Phase 10). Admins review a
 * week's payouts, export the transfer list, and mark each paid with the transfer reference (once:
 * a paid payout never changes) or failed with a reason (the money goes back to the payable account
 * and is paid next week). Stores and riders see their statements and set where they are paid. The
 * pilot sends money by hand; an automatic disbursement adapter can replace the manual one later.
 */
export class PayoutService {
  constructor(
    private readonly deps: {
      payouts: IPayoutRepository;
      access: ConsoleAccess;
      authz: AuthorizationService;
      disbursement: IDisbursementGateway;
      logger: Logger;
    },
  ) {}

  // -------------------------------------------------------------------------
  // Admin: the week's payouts
  // -------------------------------------------------------------------------

  async week(
    user: SessionUser | null,
    weekStart: string,
  ): Promise<Result<{ readonly payouts: PayoutRecord[]; readonly automatic: boolean }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    return ok({
      payouts: await this.deps.payouts.payouts({ weekStart }),
      automatic: this.deps.disbursement.automatic,
    });
  }

  /** The transfer list for the week's unpaid payouts (open in Google Sheets or GCash for Business). */
  async transferCsv(
    user: SessionUser | null,
    weekStart: string,
  ): Promise<Result<CsvFile, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const due = (await this.deps.payouts.payouts({ weekStart })).filter(
      (p) => p.status === "draft",
    );
    await this.deps.access.record(
      admin.value,
      "payout.export",
      { type: "payouts", id: null },
      {
        weekStart,
        payouts: due.length,
      },
    );
    return ok({
      filename: `klikgo-payouts-${weekStart}.csv`,
      body: toCsv(
        [
          "Payout ID",
          "Type",
          "Name",
          "Method",
          "Account name",
          "Account number",
          "Bank",
          "Amount (PHP)",
          "Reference",
        ],
        due.map((p) => [
          p.id,
          p.partyType === "merchant" ? "Store" : "Rider",
          p.partyName,
          p.account ? METHOD_LABEL[p.account.method] : "MISSING",
          p.account?.accountName ?? "",
          p.account?.accountNumber ?? "",
          p.account?.bankName ?? "",
          { centavos: p.amountCentavos },
          "",
        ]),
      ),
    });
  }

  async markPaid(
    user: SessionUser | null,
    payoutId: string,
    reference: string,
  ): Promise<Result<PayoutRecord, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const payout = await this.deps.payouts.payout(payoutId);
    if (!payout) return err(new NotFoundError("Payout", payoutId));
    if (payout.status === "paid")
      return err(new ConflictError("This payout was already marked paid."));
    if (payout.status !== "draft")
      return err(new ConflictError("Only payouts waiting to be sent can be marked paid."));
    if (!payout.account) {
      return err(new ConflictError("Add where this payout goes before marking it paid."));
    }
    const party = payout.partyType;
    const marked = await this.deps.payouts.markPaid({
      id: payoutId,
      reference,
      by: admin.value.id,
      ledger: txn([
        line(
          "payouts_due",
          party,
          payout.partyId,
          payout.amountCentavos,
          `Payout sent (${reference})`,
        ),
        line(
          "platform_cash",
          "platform",
          null,
          -payout.amountCentavos,
          `Payout sent (${reference})`,
        ),
      ]),
    });
    if (!marked) return err(new ConflictError("This payout was already marked paid."));
    await this.deps.access.record(
      admin.value,
      "payout.paid",
      { type: "payouts", id: payoutId },
      {
        amountCentavos: payout.amountCentavos,
        reference,
      },
    );
    this.deps.logger.info("payout.paid", { payoutId, amountCentavos: payout.amountCentavos });
    return this.reload(payoutId);
  }

  async markFailed(
    user: SessionUser | null,
    payoutId: string,
    reason: string,
  ): Promise<Result<PayoutRecord, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const payout = await this.deps.payouts.payout(payoutId);
    if (!payout) return err(new NotFoundError("Payout", payoutId));
    if (payout.status !== "draft") {
      return err(new ConflictError("Only payouts waiting to be sent can be marked failed."));
    }
    const payable = payout.partyType === "merchant" ? "merchant_payable" : "rider_payable";
    const marked = await this.deps.payouts.markFailed({
      id: payoutId,
      reason,
      ledger: txn([
        line(
          "payouts_due",
          payout.partyType,
          payout.partyId,
          payout.amountCentavos,
          "Payout failed; paid next week",
        ),
        line(
          payable,
          payout.partyType,
          payout.partyId,
          -payout.amountCentavos,
          "Payout failed; paid next week",
        ),
      ]),
    });
    if (!marked)
      return err(new ConflictError("This payout was already changed. Refresh to see it."));
    await this.deps.access.record(
      admin.value,
      "payout.failed",
      { type: "payouts", id: payoutId },
      {
        amountCentavos: payout.amountCentavos,
        reason,
      },
    );
    return this.reload(payoutId);
  }

  // -------------------------------------------------------------------------
  // Stores and riders: statements and where they are paid
  // -------------------------------------------------------------------------

  async page(user: SessionUser | null, who: PayoutOwner): Promise<Result<PayoutsPage, AppError>> {
    const party = await this.party(user, who);
    if (!party.ok) return party;
    const { partyType, partyId } = party.value;
    const [account, open, payouts] = await Promise.all([
      this.deps.payouts.account(partyType, partyId),
      this.deps.payouts.openBalance(partyType, partyId),
      this.deps.payouts.payouts({ partyType, partyId }),
    ]);
    return ok({
      account,
      openCentavos: open.payableCentavos,
      cashHeldCentavos: open.cashHeldCentavos,
      minimumCentavos: MIN_PAYOUT_CENTAVOS,
      payouts,
    });
  }

  async statement(
    user: SessionUser | null,
    who: PayoutOwner,
    payoutId: string,
  ): Promise<Result<PayoutStatement, AppError>> {
    const party = await this.party(user, who);
    if (!party.ok) return party;
    const payout = await this.deps.payouts.payout(payoutId);
    // Someone else's payout reads as missing.
    if (
      !payout ||
      payout.partyType !== party.value.partyType ||
      payout.partyId !== party.value.partyId
    ) {
      return err(new NotFoundError("Payout", payoutId));
    }
    return ok({ ...payout, lines: await this.deps.payouts.lines(payoutId) });
  }

  async statementCsv(
    user: SessionUser | null,
    who: PayoutOwner,
    payoutId: string,
  ): Promise<Result<CsvFile, AppError>> {
    const found = await this.statement(user, who, payoutId);
    if (!found.ok) return found;
    const s = found.value;
    const rows = s.lines.map((l) => [
      formatManilaDateTime(l.occurredAt),
      l.orderCode ?? "",
      l.description,
      { centavos: l.amountCentavos },
    ]);
    rows.push(["", "", "Total paid", { centavos: s.amountCentavos }]);
    return ok({
      filename: `klikgo-statement-${s.periodStart}.csv`,
      body: toCsv(["Date (Manila)", "Order", "Description", "Amount (PHP)"], rows),
    });
  }

  async saveAccount(
    user: SessionUser | null,
    who: PayoutOwner,
    input: PayoutAccountInput,
  ): Promise<Result<PayoutAccount, AppError>> {
    const party = await this.party(user, who);
    if (!party.ok || !user) return party.ok ? err(new UnauthorizedError()) : party;
    const account: PayoutAccount = {
      method: input.method,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      bankName: input.method === "bank" ? (input.bankName ?? null) : null,
    };
    await this.deps.payouts.saveAccount(
      party.value.partyType,
      party.value.partyId,
      account,
      user.id,
    );
    this.deps.logger.info("payout.account_saved", {
      partyType: party.value.partyType,
      partyId: party.value.partyId,
      method: account.method,
    });
    return ok(account);
  }

  private async party(
    user: SessionUser | null,
    who: PayoutOwner,
  ): Promise<Result<{ partyType: PayoutParty; partyId: string }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    if (who.kind === "merchant") {
      // Money is the owner's business: staff don't see payouts or account numbers.
      if (!this.deps.authz.can(user, { type: "merchant.settings", merchantId: who.merchantId })) {
        return err(new ForbiddenError("Only the store owner can see payouts."));
      }
      return ok({ partyType: "merchant", partyId: who.merchantId });
    }
    const rider = await this.deps.payouts.riderOf(user.id);
    if (!rider) return err(new ForbiddenError("This is for riders."));
    return ok({ partyType: "rider", partyId: rider.id });
  }

  private async reload(id: string): Promise<Result<PayoutRecord, AppError>> {
    const payout = await this.deps.payouts.payout(id);
    return payout ? ok(payout) : err(new NotFoundError("Payout", id));
  }
}

/** Whose payouts: a store (by id) or the signed-in rider. */
export type PayoutOwner =
  { readonly kind: "merchant"; readonly merchantId: string } | { readonly kind: "rider" };

/** The pilot's disbursement: a person transfers the money and enters the reference. */
export class ManualDisbursement implements IDisbursementGateway {
  readonly name = "manual";
  readonly automatic = false;

  disburse(): Promise<Result<{ readonly reference: string }, AppError>> {
    return Promise.resolve(
      err(
        new ConflictError(
          "Payouts are sent by hand for now: transfer the amount, then mark it paid with the reference.",
        ),
      ),
    );
  }
}

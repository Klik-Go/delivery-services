import type { SessionUser } from "../auth/session-user";
import type { ConsoleAccess } from "../ops/console-access";
import type { Logger } from "../ports/logger";
import { ConflictError, NotFoundError, ValidationError, type AppError } from "../shared/errors";
import { formatPeso, type Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import { line, txn } from "./postings";
import type { CashHolder, IRemittanceRepository } from "./ports";

/**
 * Cash on delivery riders hand in (docs/BUILD_PLAN.md Phase 10, OPEN_QUESTIONS Q31). The zone's
 * coordinator (or an admin) records the amount received and a reference; the ledger moves it from
 * the rider's cash on hand into Klik Go's cash, which also frees the rider's cash limit for new
 * cash orders. Cash still held at the weekly settlement is netted against the rider's earnings.
 */
export class RemittanceService {
  constructor(
    private readonly deps: {
      remittances: IRemittanceRepository;
      access: ConsoleAccess;
      logger: Logger;
    },
  ) {}

  /** Riders in the person's zones who hold cash, most first. */
  async holders(user: SessionUser | null): Promise<Result<CashHolder[], AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const holders = await this.deps.remittances.holders(allowed.value.scope);
    return ok(holders.sort((a, b) => b.cashHeldCentavos - a.cashHeldCentavos));
  }

  async record(
    user: SessionUser | null,
    input: {
      readonly riderId: string;
      readonly amountCentavos: Centavos;
      readonly reference: string;
    },
  ): Promise<Result<CashHolder, AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const holder = await this.deps.remittances.holder(input.riderId);
    if (!holder) return err(new NotFoundError("Rider", input.riderId));
    const inZone = this.deps.access.inZone(user, holder.zoneId, "Rider", input.riderId);
    if (!inZone.ok) return inZone;
    if (holder.cashHeldCentavos <= 0) {
      return err(new ConflictError("This rider holds no cash right now."));
    }
    if (input.amountCentavos > holder.cashHeldCentavos) {
      const message = `The rider holds ${formatPeso(holder.cashHeldCentavos)}. Check the amount.`;
      return err(new ValidationError(message, [{ path: "amountCentavos", message }]));
    }
    const memo = `Cash handed in (${input.reference})`;
    const saved = await this.deps.remittances.recordHandIn({
      riderId: holder.riderId,
      zoneId: holder.zoneId,
      amountCentavos: input.amountCentavos,
      reference: input.reference,
      receivedBy: inZone.value.id,
      ledger: txn([
        line("platform_cash", "platform", null, input.amountCentavos, memo),
        line("rider_cash_on_hand", "rider", holder.riderId, -input.amountCentavos, memo),
      ]),
    });
    await this.deps.access.record(
      inZone.value,
      "cash.received",
      { type: "cod_remittances", id: saved.id },
      {
        riderId: holder.riderId,
        amountCentavos: input.amountCentavos,
        reference: input.reference,
      },
    );
    this.deps.logger.info("cash.received", {
      riderId: holder.riderId,
      amountCentavos: input.amountCentavos,
    });
    const after = await this.deps.remittances.holder(holder.riderId);
    return after ? ok(after) : err(new NotFoundError("Rider", holder.riderId));
  }
}

import { DELETE_CONFIRMATION, type AccountDeleteInput, type AppRole } from "@klikgo/types";
import type { IRateLimiter, RateLimitRule } from "../auth/ports";
import { STAFF_ROLES, type SessionUser } from "../auth/session-user";
import type { IAuditLog } from "../ops/ports";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ErasureFacts, IAccountAuthAdmin, IAccountDataRepository } from "./ports";

/** Exports are heavy and hold everything: three a day is plenty for a person. */
export const EXPORTS_PER_DAY: RateLimitRule = { limit: 3, windowSeconds: 86_400 };

/** A JSON file to download. */
export interface JsonFile {
  readonly filename: string;
  readonly body: string;
}

/**
 * The data subject's rights (RA 10173 §16–18, docs/BUSINESS.md §7.2): a copy of their data and
 * erasure. Erasure anonymises rather than deletes, because orders, payouts and the ledger are
 * records the law makes us keep (BIR: 10 years); it waits until nothing is in progress, so no
 * order, cash or payout is left without an owner.
 */
export class AccountService {
  constructor(
    private readonly deps: {
      accounts: IAccountDataRepository;
      authAdmin: IAccountAuthAdmin;
      audit: IAuditLog;
      rateLimiter: IRateLimiter;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async exportData(user: SessionUser | null): Promise<Result<JsonFile, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const limit = await this.deps.rateLimiter.hit(
      `privacy-export:user:${user.id}`,
      EXPORTS_PER_DAY,
    );
    if (!limit.allowed) {
      return err(
        new RateLimitedError(
          "You have downloaded your data 3 times today. Try again tomorrow.",
          limit.retryAfterSeconds,
        ),
      );
    }
    const data = await this.deps.accounts.exportFor(user.id);
    await this.deps.audit.record({
      actorId: user.id,
      actorRole: personalRole(user),
      action: "privacy.export",
      entityType: "profiles",
      entityId: user.id,
      meta: {},
    });
    const day = this.deps.clock.now().toISOString().slice(0, 10);
    return ok({
      filename: `klikgo-my-data-${day}.json`,
      body: `${JSON.stringify(data, null, 2)}\n`,
    });
  }

  async deleteAccount(
    user: SessionUser | null,
    input: AccountDeleteInput,
  ): Promise<Result<{ readonly erased: true }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    if (input.confirm !== DELETE_CONFIRMATION) {
      const message = `Type ${DELETE_CONFIRMATION} to confirm.`;
      return err(new ValidationError(message, [{ path: "confirm", message }]));
    }
    const facts = await this.deps.accounts.erasureFacts(user.id);
    if (!facts.exists) return err(new UnauthorizedError());
    if (!facts.alreadyErased) {
      const blocked = blocker(facts);
      if (blocked) return err(new ConflictError(blocked));
      const erased = await this.deps.accounts.erase(user.id);
      await this.deps.audit.record({
        actorId: user.id,
        actorRole: personalRole(user),
        action: "privacy.erase",
        entityType: "profiles",
        entityId: user.id,
        meta: { orders: erased.orders, addresses: erased.addresses },
      });
      this.deps.logger.info("privacy.erased", { userId: user.id, orders: erased.orders });
    }
    // A failure here leaves the data erased; trying again finishes the sign-in removal.
    const removed = await this.deps.authAdmin.softDelete(user.id);
    if (!removed.ok) return removed;
    return ok({ erased: true });
  }
}

/** Why erasure has to wait, or null when it can go ahead. */
export function blocker(facts: ErasureFacts): string | null {
  if (facts.roles.some((role) => STAFF_ROLES.includes(role)))
    return "Ask an admin to remove your staff access first.";
  if (facts.activeOrders > 0)
    return "You have an order in progress. Delete your account once it is delivered or cancelled.";
  if (facts.activeDeliveries > 0)
    return "You have a delivery in progress. Finish it before deleting your account.";
  if (facts.cashHeldCentavos > 0)
    return "Hand in the cash on delivery you hold at the hub before deleting your account.";
  if (facts.unpaidCentavos > 0)
    return "You still have earnings to be paid. Delete your account after your next payout.";
  return null;
}

function personalRole(user: SessionUser): AppRole {
  return user.roles.some((grant) => grant.role === "rider") ? "rider" : "customer";
}

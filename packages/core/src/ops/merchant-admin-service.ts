import type { SessionUser } from "../auth/session-user";
import type { Clock } from "../ports/clock";
import { ConflictError, NotFoundError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ConsoleAccess } from "./console-access";
import type { IMerchantAdminRepository, OpsMerchant } from "./ports";

/**
 * Live stores (docs/BUSINESS.md §9.2.4): suspend and reactivate with a reason, and change the
 * commission from a date (settlement uses the rate in force at delivery). Coordinators can see
 * their zone's stores; changes are for admins.
 */
export class MerchantAdminService {
  constructor(
    private readonly deps: {
      access: ConsoleAccess;
      merchants: IMerchantAdminRepository;
      clock: Clock;
    },
  ) {}

  async list(user: SessionUser | null): Promise<Result<OpsMerchant[], AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    return ok(await this.deps.merchants.merchants(allowed.value.scope));
  }

  async setStatus(
    user: SessionUser | null,
    merchantId: string,
    input: { readonly status: "active" | "suspended"; readonly reason?: string | undefined },
  ): Promise<Result<OpsMerchant, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const store = await this.deps.merchants.merchant(merchantId);
    if (!store) return err(new NotFoundError("Store", merchantId));
    if (store.status === input.status) {
      return err(new ConflictError(`This store is already ${input.status}.`));
    }
    if (store.status === "pending") {
      return err(new ConflictError("Approve the store's application first."));
    }
    await this.deps.merchants.setStatus(
      merchantId,
      input.status,
      input.status === "suspended" ? (input.reason ?? null) : null,
    );
    await this.deps.access.record(
      admin.value,
      input.status === "suspended" ? "merchant.suspend" : "merchant.reactivate",
      { type: "merchants", id: merchantId },
      { reason: input.reason ?? null },
    );
    return this.reload(merchantId);
  }

  async setCommission(
    user: SessionUser | null,
    merchantId: string,
    input: {
      readonly commissionBps: number;
      readonly effectiveFrom: Date;
      readonly reason: string;
    },
  ): Promise<Result<OpsMerchant, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const now = this.deps.clock.now();
    const changed = await this.deps.merchants.setCommission(
      merchantId,
      input.commissionBps,
      input.effectiveFrom,
      now,
    );
    if (!changed) return err(new NotFoundError("Store", merchantId));
    await this.deps.access.record(
      admin.value,
      "merchant.commission",
      { type: "merchants", id: merchantId },
      {
        commissionBps: input.commissionBps,
        effectiveFrom: input.effectiveFrom.toISOString(),
        reason: input.reason,
      },
    );
    return this.reload(merchantId);
  }

  private async reload(merchantId: string): Promise<Result<OpsMerchant, AppError>> {
    const store = await this.deps.merchants.merchant(merchantId);
    return store ? ok(store) : err(new NotFoundError("Store", merchantId));
  }
}

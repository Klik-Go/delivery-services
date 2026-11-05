import type { StoreClosureInput, StoreSettingsInput } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import { authorize } from "../auth/authorize";
import type { SessionUser } from "../auth/session-user";
import { ConflictError, NotFoundError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IStoreRepository, StoreSettings } from "./ports";

/**
 * Store settings (docs/BUSINESS.md §9.2.2): owners change hours, prep time, cash on delivery,
 * delivery radius and holiday closures; any team member opens or closes the store.
 */
export class StoreSettingsService {
  constructor(private readonly deps: { stores: IStoreRepository; authz: AuthorizationService }) {}

  /** The settings page for one store. */
  async settings(
    user: SessionUser | null,
    merchantId: string,
  ): Promise<Result<StoreSettings, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.manage", merchantId });
    if (!allowed.ok) return allowed;
    const settings = await this.deps.stores.settings(merchantId);
    return settings ? ok(settings) : err(new NotFoundError("Store", merchantId));
  }

  /** Saves owner-managed settings; the radius may not exceed the zone's maximum. */
  async update(
    user: SessionUser | null,
    merchantId: string,
    input: StoreSettingsInput,
  ): Promise<Result<StoreSettings, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.settings", merchantId });
    if (!allowed.ok) return allowed;
    const current = await this.deps.stores.settings(merchantId);
    if (!current) return err(new NotFoundError("Store", merchantId));
    if (input.serviceRadiusKm !== null && input.serviceRadiusKm > current.zoneMaxRadiusKm) {
      const message = `Your zone delivers up to ${String(current.zoneMaxRadiusKm)} km.`;
      return err(new ValidationError(message, [{ path: "serviceRadiusKm", message }]));
    }
    await this.deps.stores.updateSettings(merchantId, input);
    return this.settings(user, merchantId);
  }

  /** Opens or closes the store for orders right now. */
  async setOpen(
    user: SessionUser | null,
    merchantId: string,
    isOpen: boolean,
  ): Promise<Result<StoreSettings, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.manage", merchantId });
    if (!allowed.ok) return allowed;
    const current = await this.deps.stores.settings(merchantId);
    if (!current) return err(new NotFoundError("Store", merchantId));
    if (isOpen && current.status !== "active")
      return err(new ConflictError("Your store can open once Klik Go has approved it."));
    await this.deps.stores.setOpen(merchantId, isOpen);
    return this.settings(user, merchantId);
  }

  /** Adds a holiday closure (one per date). */
  async addClosure(
    user: SessionUser | null,
    merchantId: string,
    closure: StoreClosureInput,
  ): Promise<Result<{ id: string }, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.settings", merchantId });
    if (!allowed.ok) return allowed;
    const added = await this.deps.stores.addClosure(merchantId, closure);
    return added ? ok(added) : err(new ConflictError("The store is already closed on that date."));
  }

  /** Removes a holiday closure. */
  async removeClosure(
    user: SessionUser | null,
    merchantId: string,
    closureId: string,
  ): Promise<Result<void, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.settings", merchantId });
    if (!allowed.ok) return allowed;
    return (await this.deps.stores.removeClosure(merchantId, closureId))
      ? ok(undefined)
      : err(new NotFoundError("Closure", closureId));
  }
}

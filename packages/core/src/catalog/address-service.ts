import type { AddressInput } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import { authorize } from "../auth/authorize";
import { normalizePhilippineMobile } from "../auth/phone";
import type { SessionUser } from "../auth/session-user";
import type { AppError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import type { IAddressRepository, IServiceArea, SavedAddress, ServiceZone } from "./ports";

/** A customer's saved addresses: pin, landmark and contact number (PH addresses need all three). */
export class AddressService {
  constructor(
    private readonly deps: {
      addresses: IAddressRepository;
      serviceArea: IServiceArea;
      authz: AuthorizationService;
    },
  ) {}

  async list(user: SessionUser | null): Promise<Result<SavedAddress[], AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "surface.open", surface: "customer" });
    if (!allowed.ok) return allowed;
    return ok(await this.deps.addresses.listFor(allowed.value.id));
  }

  /** Saves an address (default by default) and says which zone serves it, if any. */
  async save(
    user: SessionUser | null,
    input: AddressInput,
  ): Promise<Result<{ id: string; zone: ServiceZone | null }, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "surface.open", surface: "customer" });
    if (!allowed.ok) return allowed;
    const phone = normalizePhilippineMobile(input.contactPhone);
    if (!phone.ok) return phone;
    const [{ id }, zone] = await Promise.all([
      this.deps.addresses.create(allowed.value.id, {
        label: input.label,
        location: input.location,
        street: input.street || null,
        landmark: input.landmark,
        barangay: input.barangay,
        city: input.city,
        notes: input.notes || null,
        contactPhone: phone.value,
        isDefault: input.isDefault,
      }),
      this.deps.serviceArea.zoneFor(input.location),
    ]);
    return ok({ id, zone });
  }
}

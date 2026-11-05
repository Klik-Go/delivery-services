import type { WaitlistInput } from "@klikgo/types";
import { normalizePhilippineMobile } from "../auth/phone";
import type { IRateLimiter, RateLimitRule } from "../auth/ports";
import type { Logger } from "../ports/logger";
import type { GeoPoint } from "../merchant/ports";
import { RateLimitedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IServiceArea, IWaitlistRepository, ServiceZone } from "./ports";

/** At most 5 waitlist sign-ups per network per hour. */
export const WAITLIST_PER_IP: RateLimitRule = { limit: 5, windowSeconds: 3600 };

/** "Do you deliver here?" and the waitlist for places we do not serve yet. */
export class ServiceabilityService {
  constructor(
    private readonly deps: {
      serviceArea: IServiceArea;
      waitlist: IWaitlistRepository;
      rateLimiter: IRateLimiter;
      logger: Logger;
    },
  ) {}

  /** The zone serving a pin, or null ("We're not in your area yet"). */
  check(point: GeoPoint): Promise<ServiceZone | null> {
    return this.deps.serviceArea.zoneFor(point);
  }

  /** Records interest from outside every zone (expansion demand). */
  async joinWaitlist(
    input: WaitlistInput,
    context: { readonly clientIp: string },
  ): Promise<Result<{ id: string }, AppError>> {
    const limit = await this.deps.rateLimiter.hit(
      `waitlist:ip:${context.clientIp}`,
      WAITLIST_PER_IP,
    );
    if (!limit.allowed)
      return err(
        new RateLimitedError("Too many requests. Please try again later.", limit.retryAfterSeconds),
      );
    const phone = normalizePhilippineMobile(input.phone);
    if (!phone.ok) return phone;
    const saved = await this.deps.waitlist.add({
      name: input.name,
      phone: phone.value,
      email: input.email ? input.email.trim().toLowerCase() : null,
      barangay: input.barangay,
      city: input.city || null,
      location: input.location,
    });
    this.deps.logger.info("waitlist.joined", { waitlistId: saved.id });
    return ok(saved);
  }
}

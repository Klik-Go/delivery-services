import type { IRateLimiter } from "../auth/ports";
import type { SessionUser } from "../auth/session-user";
import type { GeoPoint } from "../merchant/ports";
import type { IOrderNotifier } from "../notifications/notification-service";
import type { LedgerService } from "../ordering/ledger-service";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import { manilaDate } from "../shared/time";
import type { DispatchService, INotifiableOrders } from "./dispatch-service";
import type {
  IDeliveryProofStorage,
  IRiderRepository,
  RiderJob,
  RiderOffer,
  RiderProfile,
  SettlementFacts,
} from "./ports";

/** The server keeps at most one position every 4 seconds per rider (the app sends every 5–10). */
export const LOCATION_MIN_INTERVAL_MS = 4000;
/** Wrong PINs allowed per order in 10 minutes before the rider has to wait. */
export const PIN_ATTEMPTS = { limit: 5, windowSeconds: 600 } as const;

/** Shows only the last four digits, e.g. "+63 ••• ••• 1234" (calls go through a relay later). */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `+63 ••• ••• ${digits.slice(-4)}`;
}

/** The rider's home screen. */
export interface RiderStatus {
  readonly rider: RiderProfile;
  readonly cashHeldCentavos: Centavos;
  readonly activeOrderId: string | null;
}

/** The job as the rider's app shows it (contact masked, cash to collect for COD). */
export interface RiderJobView extends Omit<RiderJob, "contactPhone"> {
  readonly contactPhone: string | null;
  readonly cashToCollectCentavos: Centavos;
}

export interface RiderEarnings {
  readonly today: {
    readonly jobs: number;
    readonly payCentavos: Centavos;
    readonly tipCentavos: Centavos;
  };
  readonly week: {
    readonly jobs: number;
    readonly payCentavos: Centavos;
    readonly tipCentavos: Centavos;
  };
  readonly cashHeldCentavos: Centavos;
  readonly cashLimitCentavos: Centavos;
}

export interface DeliveryProof {
  readonly pin?: string | undefined;
  readonly photo?: { readonly bytes: Uint8Array; readonly contentType: string } | undefined;
}

const MANILA_OFFSET_MS = 8 * 3_600_000;

/** Midnight in Manila (UTC+8, no daylight saving) on the day of `now`, as a UTC instant. */
function manilaMidnight(now: Date): Date {
  return new Date(`${manilaDate(now)}T00:00:00+08:00`);
}

/** Monday 00:00 in Manila of the week of `now`. */
function manilaWeekStart(now: Date): Date {
  const midnight = manilaMidnight(now);
  const weekday = new Date(midnight.getTime() + MANILA_OFFSET_MS).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(midnight.getTime() - daysSinceMonday * 86_400_000);
}

/**
 * Everything a rider does in the app (docs/BUSINESS.md §5.2 steps 4–6, §5.3): go online, share
 * their position, answer offers, then arrive at the store → pick up → deliver with the customer's
 * PIN (orders above the threshold) or a photo. Delivery settles the order in the ledger. Pickup
 * and delivery go through the state machine's rider transitions, so order_events are written.
 */
export class RiderService {
  constructor(
    private readonly deps: {
      riders: IRiderRepository;
      dispatch: DispatchService;
      orders: INotifiableOrders;
      notifier: IOrderNotifier;
      ledger: LedgerService;
      proofs: IDeliveryProofStorage;
      limiter: IRateLimiter;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async status(user: SessionUser | null): Promise<Result<RiderStatus, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    const [cashHeldCentavos, job] = await Promise.all([
      this.deps.riders.cashHeld(rider.value.id),
      this.deps.riders.activeJob(rider.value.id),
    ]);
    return ok({ rider: rider.value, cashHeldCentavos, activeOrderId: job?.orderId ?? null });
  }

  /** Online riders get offers and share their position; offline they do neither. */
  async setOnline(
    user: SessionUser | null,
    online: boolean,
  ): Promise<Result<{ readonly online: boolean }, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    if (online && rider.value.status !== "active") {
      return err(new ForbiddenError("Your rider account isn't approved yet."));
    }
    if (!online && (await this.deps.riders.activeJob(rider.value.id))) {
      return err(new ConflictError("Finish your current delivery before going offline."));
    }
    await this.deps.riders.setOnline(rider.value.id, online);
    this.deps.logger.info("rider.online_changed", { riderId: rider.value.id, online });
    return ok({ online });
  }

  /** The app's GPS fix. Refused offline, so nobody is tracked after their shift. */
  async updateLocation(
    user: SessionUser | null,
    point: GeoPoint & {
      readonly heading?: number;
      readonly speedKph?: number;
      readonly accuracyM?: number;
    },
  ): Promise<Result<{ readonly saved: boolean }, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    if (!rider.value.isOnline) {
      return err(new ConflictError("Go online to share your location."));
    }
    const now = this.deps.clock.now();
    const saved = await this.deps.riders.saveLocation(
      rider.value.id,
      point,
      now,
      LOCATION_MIN_INTERVAL_MS,
    );
    if (saved) {
      const job = await this.deps.riders.activeJob(rider.value.id);
      if (job) await this.deps.riders.addBreadcrumb(rider.value.id, job.orderId, point, now);
    }
    return ok({ saved });
  }

  async currentOffer(user: SessionUser | null): Promise<Result<RiderOffer | null, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    return ok(await this.deps.riders.currentOffer(rider.value.id, this.deps.clock.now()));
  }

  async answerOffer(
    user: SessionUser | null,
    offerId: string,
    answer: "accepted" | "declined",
  ): Promise<Result<{ readonly orderId: string }, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    if (answer === "accepted" && !rider.value.isOnline) {
      return err(new ConflictError("Go online to take jobs."));
    }
    return this.deps.dispatch.respond(rider.value.id, offerId, answer);
  }

  async activeJob(user: SessionUser | null): Promise<Result<RiderJobView | null, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    const job = await this.deps.riders.activeJob(rider.value.id);
    return ok(job ? this.view(job) : null);
  }

  async arrivedAtStore(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<RiderJobView, AppError>> {
    const job = await this.job(user, orderId);
    if (!job.ok) return job;
    const { rider, current } = job.value;
    if (current.arrivedStoreAt) return ok(this.view(current));
    const marked = await this.deps.riders.markArrivedAtStore(
      orderId,
      rider.id,
      this.deps.clock.now(),
    );
    if (!marked) return err(new ConflictError("This job was just changed. Refresh to see it."));
    return this.reload(rider.id);
  }

  async pickedUp(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<RiderJobView, AppError>> {
    const job = await this.job(user, orderId);
    if (!job.ok) return job;
    const { rider, current } = job.value;
    if (current.status !== "ready") {
      return err(new ConflictError("The store hasn't marked this order ready yet."));
    }
    if (!(await this.deps.riders.pickUp(orderId, rider.id, rider.userId))) {
      return err(new ConflictError("This job was just changed. Refresh to see it."));
    }
    this.deps.logger.info("order.status_changed", {
      orderId,
      from: "ready",
      to: "picked_up",
      role: "rider",
    });
    await this.notify(orderId, "picked_up");
    return this.reload(rider.id);
  }

  /** Hands the order over: PIN for big orders, otherwise a photo; then settles the money. */
  async delivered(
    user: SessionUser | null,
    orderId: string,
    proof: DeliveryProof,
  ): Promise<Result<{ readonly orderId: string; readonly status: "delivered" }, AppError>> {
    const job = await this.job(user, orderId);
    if (!job.ok) return job;
    const { rider, current } = job.value;
    if (current.status !== "picked_up") {
      return err(new ConflictError("Pick up the order before delivering it."));
    }
    const checked = await this.checkProof(current, proof);
    if (!checked.ok) return checked;

    const facts = await this.deps.riders.settlementFacts(orderId);
    if (!facts) return err(new NotFoundError("Order", orderId));
    let proofPath: string | null = null;
    if (proof.photo) {
      const saved = await this.deps.proofs.save(orderId, proof.photo);
      if (!saved.ok) return saved;
      proofPath = saved.value;
    }
    const ledger = this.deps.ledger.settlement({
      orderId,
      customerId: facts.customerId,
      merchantId: facts.merchantId,
      riderId: rider.id,
      paidOnline: facts.paidOnline,
      subtotalCentavos: facts.subtotalCentavos,
      deliveryFeeCentavos: facts.deliveryFeeCentavos,
      serviceFeeCentavos: facts.serviceFeeCentavos,
      smallOrderFeeCentavos: facts.smallOrderFeeCentavos,
      tipCentavos: facts.tipCentavos,
      discountCentavos: facts.discountCentavos,
      discountFundedBy: facts.discountFundedBy,
      commissionCentavos: this.commission(facts),
      riderPayCentavos: facts.riderPayCentavos,
    });
    const delivered = await this.deps.riders.deliver({
      orderId,
      riderId: rider.id,
      riderUserId: rider.userId,
      proofPath,
      ledger,
    });
    if (!delivered) return err(new ConflictError("This job was just changed. Refresh to see it."));
    this.deps.logger.info("order.status_changed", {
      orderId,
      from: "picked_up",
      to: "delivered",
      role: "rider",
    });
    await this.notify(orderId, "delivered");
    return ok({ orderId, status: "delivered" });
  }

  /** Calls go through a number-masking relay; until the provider is chosen, the rider uses chat. */
  callCustomer(): Result<never, AppError> {
    return err(
      new ServiceUnavailableError(
        "Calling through Klik Go is coming soon. Use the delivery notes or ask the store for help.",
      ),
    );
  }

  async earnings(user: SessionUser | null): Promise<Result<RiderEarnings, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    const now = this.deps.clock.now();
    const [today, week, cashHeldCentavos] = await Promise.all([
      this.deps.riders.earningsSince(rider.value.id, manilaMidnight(now)),
      this.deps.riders.earningsSince(rider.value.id, manilaWeekStart(now)),
      this.deps.riders.cashHeld(rider.value.id),
    ]);
    return ok({ today, week, cashHeldCentavos, cashLimitCentavos: rider.value.cashLimitCentavos });
  }

  private async checkProof(job: RiderJob, proof: DeliveryProof): Promise<Result<true, AppError>> {
    if (job.pinRequired) {
      if (!proof.pin) {
        return err(new ValidationError("Ask the customer for their 4-digit delivery PIN."));
      }
      const decision = await this.deps.limiter.hit(`delivery-pin:${job.orderId}`, PIN_ATTEMPTS);
      if (!decision.allowed) {
        return err(
          new RateLimitedError(
            "Too many wrong PINs. Wait a few minutes or ask support for help.",
            decision.retryAfterSeconds,
          ),
        );
      }
      const pin = await this.deps.riders.deliveryPin(job.orderId);
      if (pin !== proof.pin) {
        return err(new ValidationError("That PIN doesn't match. Ask the customer to check it."));
      }
      return ok(true);
    }
    if (!proof.photo) {
      return err(new ValidationError("Take a photo of the order at the door."));
    }
    return ok(true);
  }

  /** Founding stores pay no commission until their date; otherwise basis points of the subtotal. */
  private commission(facts: SettlementFacts): Centavos {
    const now = this.deps.clock.now();
    if (facts.commissionFreeUntil && facts.commissionFreeUntil > now) return 0;
    return Math.round((facts.subtotalCentavos * facts.commissionBps) / 10_000);
  }

  private async notify(orderId: string, to: "picked_up" | "delivered"): Promise<void> {
    const order = await this.deps.orders.findById(orderId);
    if (order) await this.deps.notifier.statusChanged(order, to);
  }

  private view(job: RiderJob): RiderJobView {
    return {
      ...job,
      contactPhone: maskPhone(job.contactPhone),
      cashToCollectCentavos: job.paymentMethod === "cod" ? job.totalCentavos : 0,
    };
  }

  private async reload(riderId: string): Promise<Result<RiderJobView, AppError>> {
    const job = await this.deps.riders.activeJob(riderId);
    if (!job) return err(new ConflictError("This job was just changed. Refresh to see it."));
    return ok(this.view(job));
  }

  private async job(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<{ readonly rider: RiderProfile; readonly current: RiderJob }, AppError>> {
    const rider = await this.rider(user);
    if (!rider.ok) return rider;
    const current = await this.deps.riders.activeJob(rider.value.id);
    // Someone else's job reads as missing, so order ids cannot be probed.
    if (current?.orderId !== orderId) return err(new NotFoundError("Job", orderId));
    return ok({ rider: rider.value, current });
  }

  private async rider(user: SessionUser | null): Promise<Result<RiderProfile, AppError>> {
    if (!user) return err(new UnauthorizedError());
    if (!user.roles.some((grant) => grant.role === "rider")) return err(new ForbiddenError());
    const rider = await this.deps.riders.riderForUser(user.id);
    if (!rider) return err(new ForbiddenError("Finish your rider sign-up first."));
    if (rider.status === "suspended") {
      return err(new ForbiddenError("Your rider account is on hold. Please contact support."));
    }
    return ok(rider);
  }
}

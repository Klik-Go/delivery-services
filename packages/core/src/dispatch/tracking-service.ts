import type { OrderStatus, VehicleType } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import { roadMeters } from "../catalog/geo";
import type { GeoPoint } from "../merchant/ports";
import type { Clock } from "../ports/clock";
import { NotFoundError, UnauthorizedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IDispatchSettingsSource, ITrackingRepository } from "./ports";

/** Statuses during which the customer may see their rider (privacy: assigned → delivered). */
const RIDER_VISIBLE: readonly OrderStatus[] = ["accepted", "preparing", "ready", "picked_up"];

export interface TrackingView {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly store: GeoPoint;
  readonly dropoff: GeoPoint;
  readonly rider: {
    readonly firstName: string | null;
    readonly vehicleType: VehicleType;
    readonly plateNo: string | null;
    readonly location: GeoPoint | null;
    readonly locationAt: Date | null;
  } | null;
  /** Minutes until the rider reaches the customer; null without a rider position. */
  readonly etaMinutes: number | null;
}

/**
 * The customer's live map (BUILD_PLAN Phase 7). The rider appears only while they hold the job,
 * and disappears once it is delivered or ends. The estimate is road distance at the configured
 * average speed: rider → store → customer before pickup, rider → customer after; never earlier
 * than the store said the food would be ready.
 */
export class TrackingService {
  constructor(
    private readonly deps: {
      tracking: ITrackingRepository;
      settings: IDispatchSettingsSource;
      authz: AuthorizationService;
      clock: Clock;
    },
  ) {}

  async view(orderId: string, user: SessionUser | null): Promise<Result<TrackingView, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const facts = await this.deps.tracking.facts(orderId);
    if (
      !facts ||
      !this.deps.authz.can(user, {
        type: "order.view",
        customerId: facts.customerId,
        merchantId: facts.merchantId,
        zoneId: facts.zoneId,
      })
    ) {
      return err(new NotFoundError("Order", orderId));
    }
    const rider = RIDER_VISIBLE.includes(facts.status) ? facts.rider : null;
    let etaMinutes: number | null = null;
    if (rider?.location) {
      const { avgSpeedKph } = await this.deps.settings.load();
      const minutes = (from: GeoPoint, to: GeoPoint): number =>
        Math.ceil((roadMeters(from, to) / 1000 / avgSpeedKph) * 60);
      if (facts.status === "picked_up") {
        etaMinutes = Math.max(1, minutes(rider.location, facts.dropoff));
      } else {
        // The rider cannot leave the store before the food is ready.
        const untilReady = facts.readyBy
          ? Math.ceil((facts.readyBy.getTime() - this.deps.clock.now().getTime()) / 60_000)
          : 0;
        const leaveStore = Math.max(minutes(rider.location, facts.store), untilReady);
        etaMinutes = Math.max(1, leaveStore + minutes(facts.store, facts.dropoff));
      }
    }
    return ok({
      orderId: facts.orderId,
      status: facts.status,
      store: facts.store,
      dropoff: facts.dropoff,
      rider,
      etaMinutes,
    });
  }
}

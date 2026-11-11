import { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import { DispatchService } from "../dispatch/dispatch-service";
import { DistancePayRule } from "../dispatch/distance-pay-rule";
import { NearestAvailableStrategy } from "../dispatch/nearest-available-strategy";
import { RiderService } from "../dispatch/rider-service";
import { TrackingService } from "../dispatch/tracking-service";
import { LedgerService } from "../ordering/ledger-service";
import { InMemoryRateLimiter } from "./auth-fakes";
import { InMemoryDispatch, RecordingMessages } from "./dispatch-fakes";
import { FakeClock } from "./fake-clock";
import { MemoryLogger } from "./memory-logger";
import { RecordingNotifier } from "./ordering-fakes";
import { sessionUser } from "./session-users";

/** Near Kape't Tinapay (14.5583, 121.0187): Rosa is closest, Rico a little further. */
export const ROSA_AT = { lat: 14.559, lng: 121.022 };
export const RICO_AT = { lat: 14.564, lng: 121.028 };

export interface DispatchWorld {
  readonly clock: FakeClock;
  readonly logger: MemoryLogger;
  readonly db: InMemoryDispatch;
  readonly messages: RecordingMessages;
  readonly notifier: RecordingNotifier;
  readonly limiter: InMemoryRateLimiter;
  readonly dispatch: DispatchService;
  readonly riders: RiderService;
  readonly tracking: TrackingService;
  /** Signs in as the rider with this id (their user is `user-<id>`). */
  riderUser(riderId: string): SessionUser;
  readonly customer: SessionUser;
}

/** Dispatch, rider and tracking services wired with in-memory fakes (unit tests). */
export function dispatchWorld(now = new Date("2026-11-13T04:00:00Z")): DispatchWorld {
  const clock = new FakeClock(now);
  const logger = new MemoryLogger();
  const db = new InMemoryDispatch(() => clock.now());
  const messages = new RecordingMessages();
  const notifier = new RecordingNotifier();
  const limiter = new InMemoryRateLimiter();
  const dispatch = new DispatchService({
    repo: db,
    settings: db,
    strategy: new NearestAvailableStrategy(),
    payRule: new DistancePayRule(),
    orders: db,
    messages,
    clock,
    logger,
  });
  const riders = new RiderService({
    riders: db,
    dispatch,
    orders: db,
    notifier,
    ledger: new LedgerService(),
    proofs: db,
    limiter,
    clock,
    logger,
  });
  const tracking = new TrackingService({
    tracking: db,
    settings: db,
    authz: new AuthorizationService(),
    clock,
  });
  return {
    clock,
    logger,
    db,
    messages,
    notifier,
    limiter,
    dispatch,
    riders,
    tracking,
    riderUser: (riderId) => sessionUser(`user-${riderId}`, [{ role: "rider" }], "aal1"),
    customer: sessionUser("customer-1", [{ role: "customer" }], "aal1"),
  };
}

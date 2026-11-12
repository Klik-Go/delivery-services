import { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import { DistancePayRule } from "../dispatch/distance-pay-rule";
import { DEFAULT_DISPATCH_SETTINGS } from "../dispatch/ports";
import { AdminOrderService } from "../ops/admin-order-service";
import { ConsoleAccess } from "../ops/console-access";
import { MerchantAdminService } from "../ops/merchant-admin-service";
import { RiderAdminService } from "../ops/rider-admin-service";
import { RiderOnboardingService } from "../ops/rider-onboarding-service";
import { SettingsService } from "../ops/settings-service";
import { StaffAdminService } from "../ops/staff-admin-service";
import { ZoneAdminService } from "../ops/zone-admin-service";
import type { StatusResult } from "../ordering/order-lifecycle-service";
import type { RefundResult } from "../ordering/refund-service";
import type { AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { RecordingMessages } from "./dispatch-fakes";
import { FakeClock } from "./fake-clock";
import { MemoryLogger } from "./memory-logger";
import {
  FakeKycStorage,
  FakeMerchantAdmin,
  FakeOpsOrders,
  FakeRiderAdmin,
  FakeRiderOnboarding,
  FakeSettings,
  FakeStaff,
  FakeZoneAdmin,
  MemoryAuditLog,
  OpsState,
} from "./ops-fakes";
import { sessionUser } from "./session-users";

/** Stands in for the lifecycle and refund services the console calls. */
export class OrderActionsStub {
  readonly cancelled: { orderId: string; reason: string | undefined }[] = [];
  readonly refunded: { orderId: string; amountCentavos: number | undefined }[] = [];
  refuse: AppError | null = null;

  cancel(
    orderId: string,
    _user: SessionUser | null,
    input: { readonly reason?: string | undefined },
  ): Promise<Result<StatusResult, AppError>> {
    if (this.refuse) return Promise.resolve(err(this.refuse));
    this.cancelled.push({ orderId, reason: input.reason });
    return Promise.resolve(ok({ orderId, status: "cancelled" }));
  }

  refund(input: {
    readonly orderId: string;
    readonly amountCentavos?: number;
    readonly reason: string;
  }): Promise<Result<RefundResult, AppError>> {
    if (this.refuse) return Promise.resolve(err(this.refuse));
    this.refunded.push({ orderId: input.orderId, amountCentavos: input.amountCentavos });
    return Promise.resolve(
      ok({
        refundId: "refund-1",
        amountCentavos: input.amountCentavos ?? 17_900,
        status: "succeeded",
      }),
    );
  }
}

export interface OpsWorld {
  readonly clock: FakeClock;
  readonly state: OpsState;
  readonly kyc: FakeKycStorage;
  readonly messages: RecordingMessages;
  readonly actions: OrderActionsStub;
  readonly orders: AdminOrderService;
  readonly zones: ZoneAdminService;
  readonly merchants: MerchantAdminService;
  readonly riders: RiderAdminService;
  readonly onboarding: RiderOnboardingService;
  readonly settings: SettingsService;
  readonly staff: StaffAdminService;
  readonly admin: SessionUser;
  /** Coordinator of the "makati" zone. */
  readonly coordinator: SessionUser;
  /** Coordinator of the "pampanga" zone. */
  readonly otherCoordinator: SessionUser;
  readonly customer: SessionUser;
}

/** Every console service wired to in-memory fakes. */
export function opsWorld(now = new Date("2026-11-14T04:00:00Z")): OpsWorld {
  const clock = new FakeClock(now);
  const state = new OpsState(() => clock.now());
  const logger = new MemoryLogger();
  const access = new ConsoleAccess(new AuthorizationService(), new MemoryAuditLog(state));
  const kyc = new FakeKycStorage(state);
  const messages = new RecordingMessages();
  const actions = new OrderActionsStub();
  state.addZone({ id: "makati", name: "Makati City" });
  state.addZone({ id: "pampanga", name: "San Fernando, Pampanga" });
  let ids = 0;
  return {
    clock,
    state,
    kyc,
    messages,
    actions,
    orders: new AdminOrderService({
      access,
      orders: new FakeOpsOrders(state),
      dispatchJobs: { job: () => Promise.resolve(null) },
      dispatchSettings: { load: () => Promise.resolve(DEFAULT_DISPATCH_SETTINGS) },
      payRule: new DistancePayRule(),
      lifecycle: actions,
      refunds: actions,
      messages,
      clock,
      logger,
    }),
    zones: new ZoneAdminService({ access, zones: new FakeZoneAdmin(state) }),
    merchants: new MerchantAdminService({ access, merchants: new FakeMerchantAdmin(state), clock }),
    riders: new RiderAdminService({
      access,
      riders: new FakeRiderAdmin(state),
      storage: kyc,
      messages,
      clock,
    }),
    onboarding: new RiderOnboardingService({
      onboarding: new FakeRiderOnboarding(state),
      storage: kyc,
      logger,
      newId: () => {
        ids += 1;
        return `id${String(ids)}`;
      },
    }),
    settings: new SettingsService({ access, settings: new FakeSettings(state) }),
    staff: new StaffAdminService({ access, staff: new FakeStaff(state) }),
    admin: sessionUser("admin-1", [{ role: "admin" }], "aal2"),
    coordinator: sessionUser("coord-makati", [{ role: "coordinator", zoneId: "makati" }], "aal2"),
    otherCoordinator: sessionUser(
      "coord-pampanga",
      [{ role: "coordinator", zoneId: "pampanga" }],
      "aal2",
    ),
    customer: sessionUser("customer-1", [{ role: "customer" }], "aal1"),
  };
}

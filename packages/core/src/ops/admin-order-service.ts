import type { OrderStatus } from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import type { IMessageSender } from "../dispatch/dispatch-service";
import type {
  IDispatchRepository,
  IDispatchSettingsSource,
  IRiderPayRule,
} from "../dispatch/ports";
import type { OrderLifecycleService, StatusResult } from "../ordering/order-lifecycle-service";
import type { RefundResult, RefundService } from "../ordering/refund-service";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { ConflictError, NotFoundError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import { type ConsoleAccess, inScope } from "./console-access";
import type { IOpsOrderRepository, OpsOrder, OpsOrderDetail, OpsRider } from "./ports";
import { slaOf, type Sla } from "./sla";

/** Orders a rider can be given: the store took them and the food has not left. */
const ASSIGNABLE: readonly OrderStatus[] = ["accepted", "preparing", "ready"];

export type OpsBoardOrder = OpsOrder & { readonly sla: Sla | null };

export interface LiveMap {
  readonly orders: readonly OpsBoardOrder[];
  readonly riders: readonly OpsRider[];
}

/**
 * Coordinators and admins running live orders (docs/BUILD_PLAN.md Phase 8): the board with SLA
 * colours, the live map, the order's story, and the hands-on actions — assign or reassign a rider,
 * cancel, refund and support notes. Each action needs a reason and writes audit_logs; anything
 * outside the person's zones reads as missing.
 */
export class AdminOrderService {
  private readonly access: ConsoleAccess;

  constructor(
    private readonly deps: {
      access: ConsoleAccess;
      orders: IOpsOrderRepository;
      dispatchJobs: Pick<IDispatchRepository, "job">;
      dispatchSettings: IDispatchSettingsSource;
      payRule: IRiderPayRule;
      lifecycle: Pick<OrderLifecycleService, "cancel">;
      refunds: Pick<RefundService, "refund">;
      messages: IMessageSender;
      clock: Clock;
      logger: Logger;
    },
  ) {
    this.access = deps.access;
  }

  async board(
    user: SessionUser | null,
    filter: { readonly zoneId?: string | undefined } = {},
  ): Promise<Result<OpsBoardOrder[], AppError>> {
    const allowed = this.access.scope(user);
    if (!allowed.ok) return allowed;
    const { scope } = allowed.value;
    if (filter.zoneId && !inScope(scope, filter.zoneId)) return ok([]);
    const orders = await this.deps.orders.board(filter.zoneId ? [filter.zoneId] : scope);
    const now = this.deps.clock.now();
    return ok(orders.map((order) => ({ ...order, sla: slaOf(order, now) })));
  }

  async liveMap(user: SessionUser | null): Promise<Result<LiveMap, AppError>> {
    const allowed = this.access.scope(user);
    if (!allowed.ok) return allowed;
    const [orders, riders] = await Promise.all([
      this.board(user),
      this.deps.orders.riders(allowed.value.scope),
    ]);
    if (!orders.ok) return orders;
    return ok({ orders: orders.value, riders });
  }

  async detail(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<OpsOrderDetail & { readonly sla: Sla | null }, AppError>> {
    const found = await this.load(user, orderId);
    if (!found.ok) return found;
    return ok({ ...found.value.order, sla: slaOf(found.value.order, this.deps.clock.now()) });
  }

  /** Gives the job to a rider, taking it from whoever had it (or their open offer). */
  async assignRider(
    user: SessionUser | null,
    orderId: string,
    input: { readonly riderId: string; readonly reason: string },
  ): Promise<Result<{ readonly orderId: string; readonly riderId: string }, AppError>> {
    const found = await this.load(user, orderId);
    if (!found.ok) return found;
    const { order, user: actor } = found.value;
    const previousRiderId = order.riderId;
    if (!ASSIGNABLE.includes(order.status)) {
      return err(
        new ConflictError("Riders can be assigned between the store accepting and pickup."),
      );
    }
    if (order.riderId === input.riderId) {
      return err(new ConflictError("That rider already has this order."));
    }
    const rider = await this.deps.orders.rider(input.riderId);
    if (
      !rider ||
      rider.zoneId !== order.zoneId ||
      rider.status !== "active" ||
      (rider.activeOrderId !== null && rider.activeOrderId !== orderId)
    ) {
      return err(
        new ConflictError("Choose an approved rider in this zone who is not on another job."),
      );
    }
    const earnings = await this.earningsFor(orderId);
    const assigned = await this.deps.orders.assignRider({
      orderId,
      riderId: rider.id,
      expectedRiderId: previousRiderId,
      earningsCentavos: earnings,
    });
    if (!assigned) return err(new ConflictError("This order was just changed. Refresh to see it."));
    const action = previousRiderId ? "order.reassign_rider" : "order.assign_rider";
    await this.access.record(
      actor,
      action,
      { type: "orders", id: orderId },
      {
        reason: input.reason,
        riderId: rider.id,
        previousRiderId,
      },
    );
    this.deps.logger.info(action, { orderId, riderId: rider.id });
    await this.deps.messages.notify({
      userId: rider.userId,
      template: "rider_job_assigned",
      orderId,
      params: { code: order.code, store: order.merchantName },
    });
    return ok({ orderId, riderId: rider.id });
  }

  async cancel(
    user: SessionUser | null,
    orderId: string,
    input: { readonly reason: string },
  ): Promise<Result<StatusResult, AppError>> {
    const found = await this.load(user, orderId);
    if (!found.ok) return found;
    const cancelled = await this.deps.lifecycle.cancel(orderId, found.value.user, {
      reason: input.reason,
    });
    if (!cancelled.ok) return cancelled;
    await this.access.record(
      found.value.user,
      "order.cancel",
      { type: "orders", id: orderId },
      {
        reason: input.reason,
        from: found.value.order.status,
      },
    );
    return cancelled;
  }

  async refund(
    user: SessionUser | null,
    orderId: string,
    input: { readonly reason: string; readonly amountCentavos?: Centavos | undefined },
  ): Promise<Result<RefundResult, AppError>> {
    const found = await this.load(user, orderId);
    if (!found.ok) return found;
    const refunded = await this.deps.refunds.refund(
      {
        orderId,
        reason: input.reason,
        ...(input.amountCentavos === undefined ? {} : { amountCentavos: input.amountCentavos }),
      },
      found.value.user,
    );
    if (!refunded.ok) return refunded;
    await this.access.record(
      found.value.user,
      "order.refund",
      { type: "orders", id: orderId },
      {
        reason: input.reason,
        amountCentavos: refunded.value.amountCentavos,
      },
    );
    return refunded;
  }

  async addNote(
    user: SessionUser | null,
    orderId: string,
    input: { readonly body: string },
  ): Promise<Result<{ readonly noteId: string }, AppError>> {
    const found = await this.load(user, orderId);
    if (!found.ok) return found;
    const actor = found.value.user;
    const role = actor.roles.some((grant) => grant.role === "admin") ? "admin" : "coordinator";
    const noteId = await this.deps.orders.addNote({
      orderId,
      authorId: actor.id,
      authorRole: role,
      body: input.body,
    });
    await this.access.record(actor, "order.note", { type: "orders", id: orderId }, { noteId });
    return ok({ noteId });
  }

  private async load(
    user: SessionUser | null,
    orderId: string,
  ): Promise<Result<{ order: OpsOrderDetail; user: SessionUser }, AppError>> {
    const allowed = this.access.scope(user);
    if (!allowed.ok) return allowed;
    const order = await this.deps.orders.order(orderId);
    if (!order) return err(new NotFoundError("Order", orderId));
    const inZone = this.access.inZone(allowed.value.user, order.zoneId, "Order", orderId);
    if (!inZone.ok) return inZone;
    return ok({ order, user: inZone.value });
  }

  private async earningsFor(orderId: string): Promise<Centavos> {
    const [job, settings] = await Promise.all([
      this.deps.dispatchJobs.job(orderId),
      this.deps.dispatchSettings.load(),
    ]);
    return job ? this.deps.payRule.payFor(job, settings) : settings.riderBaseCentavos;
  }
}

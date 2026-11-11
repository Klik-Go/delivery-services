import type { AppRole, OrderStatus } from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import type { RoleGrant, SessionUser } from "../auth/session-user";
import type { IOrderNotifier } from "../notifications/notification-service";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type AppError,
} from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { OrderStateMachine } from "./order-state-machine";
import type {
  BoardOrder,
  IOrderLifecycleRepository,
  IOrderRepository,
  OrderRecord,
  StatusChangeRequest,
} from "./ports";
import type { RefundService } from "./refund-service";

/** How long a store has to confirm a new order (docs/BUSINESS.md §5.4). */
export const MERCHANT_CONFIRM_SECONDS = 180;

/** The store's live orders, in the board's columns. */
export interface MerchantBoard {
  readonly new: readonly (BoardOrder & { readonly confirmBy: Date })[];
  readonly preparing: readonly (BoardOrder & { readonly readyBy: Date | null })[];
  readonly ready: readonly BoardOrder[];
  readonly pickedUp: readonly BoardOrder[];
}

/** The status an order has after a change. */
export interface StatusResult {
  readonly orderId: string;
  readonly status: OrderStatus;
}

type Extra = Pick<
  StatusChangeRequest,
  "prepMinutes" | "rejectReason" | "cancelReason" | "releasePromo" | "meta"
>;

/** Does this grant give its holder a say over this particular order? */
function grantCovers(user: SessionUser, grant: RoleGrant, order: OrderRecord): boolean {
  const staffWithTotp = user.aal === "aal2";
  switch (grant.role) {
    case "customer":
      return order.customerId === user.id;
    case "merchant_owner":
    case "merchant_staff":
      return staffWithTotp && grant.merchantId === order.merchantId;
    case "coordinator":
      return staffWithTotp && grant.zoneId === order.zoneId;
    case "admin":
      return staffWithTotp;
    case "rider":
      // Riders act on orders assigned to them (Phase 7 dispatch).
      return false;
  }
}

/**
 * Moves orders through their lifecycle after checkout (docs/BUSINESS.md §5.2 steps 2–3, BUILD_PLAN
 * Phase 6): the store accepts with a prep time (accepted → preparing), rejects with a reason or
 * marks the order ready; the customer may cancel until the store accepts. Every change goes through
 * {@link OrderStateMachine}, is conditional on the status it started from (two taps or two staff
 * cannot both win) and is written with its actor, so the database records order_events. Paid
 * orders that end early are refunded; everyone concerned is notified.
 */
export class OrderLifecycleService {
  constructor(
    private readonly deps: {
      orders: IOrderRepository;
      lifecycle: IOrderLifecycleRepository;
      states: OrderStateMachine;
      authz: AuthorizationService;
      refunds: RefundService;
      notifier: IOrderNotifier;
      /** Starts looking for a rider when the store accepts (Phase 7). */
      dispatch?: { orderAccepted(orderId: string): Promise<void> };
      logger: Logger;
    },
  ) {}

  /** The store confirms the order and starts cooking; dispatch starts looking for a rider. */
  async accept(
    orderId: string,
    user: SessionUser | null,
    input: { readonly prepMinutes: number },
  ): Promise<Result<StatusResult, AppError>> {
    const result = await this.move(orderId, user, ["accepted", "preparing"], {
      prepMinutes: input.prepMinutes,
      meta: { prepMinutes: input.prepMinutes },
    });
    if (result.ok && this.deps.dispatch) {
      try {
        await this.deps.dispatch.orderAccepted(orderId);
      } catch (error) {
        // The store's accept stands; the background job retries dispatch within seconds.
        this.deps.logger.error("dispatch.start_failed", {
          orderId,
          err: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return result;
  }

  /** The store cannot take the order. */
  reject(
    orderId: string,
    user: SessionUser | null,
    input: { readonly reason: string },
  ): Promise<Result<StatusResult, AppError>> {
    return this.move(orderId, user, ["rejected"], {
      rejectReason: input.reason,
      releasePromo: true,
      meta: { reason: input.reason },
    });
  }

  /** The food is packed and waiting for the rider. */
  markReady(orderId: string, user: SessionUser | null): Promise<Result<StatusResult, AppError>> {
    return this.move(orderId, user, ["ready"], { meta: {} });
  }

  /** The customer (before the store accepts), the zone's coordinator or an admin cancels. */
  async cancel(
    orderId: string,
    user: SessionUser | null,
    input: { readonly reason?: string | undefined },
  ): Promise<Result<StatusResult, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const order = await this.deps.orders.findById(orderId);
    if (order?.customerId === user.id && !["awaiting_payment", "placed"].includes(order.status)) {
      return err(
        new ConflictError(
          "The store has already accepted your order. Please contact support to cancel it.",
        ),
      );
    }
    const reason = input.reason ?? "Cancelled by the customer";
    return this.move(orderId, user, ["cancelled"], {
      cancelReason: reason,
      releasePromo: true,
      meta: { reason },
    });
  }

  /** The store's board: new orders with their confirm-by time, then preparing, ready, picked up. */
  async board(
    merchantId: string,
    user: SessionUser | null,
  ): Promise<Result<MerchantBoard, AppError>> {
    if (!user) return err(new UnauthorizedError());
    if (!this.deps.authz.can(user, { type: "merchant.manage", merchantId })) {
      return err(new ForbiddenError());
    }
    const orders = await this.deps.lifecycle.board(merchantId);
    const within = (status: OrderStatus[]): BoardOrder[] =>
      orders.filter((o) => status.includes(o.status));
    return ok({
      new: within(["placed"]).map((o) => ({
        ...o,
        confirmBy: new Date(o.placedAt.getTime() + MERCHANT_CONFIRM_SECONDS * 1000),
      })),
      preparing: within(["accepted", "preparing"]).map((o) => ({
        ...o,
        readyBy:
          o.acceptedAt && o.prepMinutes
            ? new Date(o.acceptedAt.getTime() + o.prepMinutes * 60_000)
            : null,
      })),
      ready: within(["ready"]),
      pickedUp: within(["picked_up"]),
    });
  }

  private async move(
    orderId: string,
    user: SessionUser | null,
    steps: readonly [OrderStatus, ...OrderStatus[]],
    extra: Extra,
  ): Promise<Result<StatusResult, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const order = await this.deps.orders.findById(orderId);
    // Orders this person may not even see read as missing, so ids cannot be probed.
    if (
      !order ||
      !this.deps.authz.can(user, {
        type: "order.view",
        customerId: order.customerId,
        merchantId: order.merchantId,
        zoneId: order.zoneId,
      })
    ) {
      return err(new NotFoundError("Order", orderId));
    }

    const role = this.actingRole(user, order, steps);
    if (!role.ok) return role;
    const changed = await this.deps.lifecycle.changeStatus({
      orderId,
      from: order.status,
      steps,
      actor: { id: user.id, role: role.value },
      ...extra,
    });
    if (!changed) {
      return err(new ConflictError("This order was just changed. Refresh to see where it is."));
    }
    const final = steps[steps.length - 1] ?? steps[0];
    this.deps.logger.info("order.status_changed", {
      orderId,
      from: order.status,
      to: final,
      role: role.value,
    });

    if ((final === "rejected" || final === "cancelled") && order.paymentStatus === "paid") {
      // Paid online: give the money back now. If the gateway is down, the background job retries.
      const refunded = await this.deps.refunds.refund(
        { orderId, reason: extra.rejectReason ?? extra.cancelReason ?? "Order ended early" },
        "system",
      );
      if (!refunded.ok) {
        this.deps.logger.warn("order.refund_deferred", { orderId, code: refunded.error.code });
      }
    }
    for (const step of steps) {
      await this.deps.notifier.statusChanged(order, step, {
        ...(extra.prepMinutes ? { minutes: extra.prepMinutes } : {}),
        reason: extra.rejectReason ?? extra.cancelReason ?? "",
      });
    }
    return ok({ orderId, status: final });
  }

  /**
   * The role this person acts in for every step: one of their grants that covers this order and
   * that the state machine allows. A change that does not exist from the current status is a
   * conflict for everyone; an existing change by the wrong person is forbidden.
   */
  private actingRole(
    user: SessionUser,
    order: OrderRecord,
    steps: readonly OrderStatus[],
  ): Result<AppRole, AppError> {
    let from = order.status;
    const pairs = steps.map((to) => {
      const pair = { from, to };
      from = to;
      return pair;
    });
    for (const { from: a, to: b } of pairs) {
      if (this.deps.states.actorsFor(a, b).length === 0) {
        return err(
          new ConflictError(
            `An order that is ${a.replace("_", " ")} cannot become ${b.replace("_", " ")}.`,
          ),
        );
      }
    }
    const grant = user.roles.find(
      (g) =>
        grantCovers(user, g, order) &&
        pairs.every(({ from: a, to: b }) => this.deps.states.check(a, b, g.role).ok),
    );
    if (!grant) return err(new ForbiddenError("You can't make that change to this order."));
    return ok(grant.role);
  }
}

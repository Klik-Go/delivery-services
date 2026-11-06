import { ORDER_STATUS_TRANSITIONS, type AppRole, type OrderStatus } from "@klikgo/types";
import { ConflictError, ForbiddenError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/** Who changes an order: a person with a role, or the platform itself (webhooks, timers). */
export type OrderActor = AppRole | "system";

type Transition = `${OrderStatus}->${OrderStatus}`;

/**
 * Who may make each allowed change (docs/ARCHITECTURE.md §4). The list of changes itself is
 * ORDER_STATUS_TRANSITIONS, which the database mirrors and enforces (orders_status_guard).
 */
const ACTORS: Readonly<Partial<Record<Transition, readonly OrderActor[]>>> = {
  "awaiting_payment->placed": ["system"],
  "awaiting_payment->cancelled": ["system", "customer", "coordinator", "admin"],
  "placed->accepted": ["merchant_owner", "merchant_staff"],
  "placed->rejected": ["merchant_owner", "merchant_staff"],
  "placed->cancelled": ["system", "customer", "coordinator", "admin"],
  "accepted->preparing": ["merchant_owner", "merchant_staff"],
  "accepted->cancelled": ["system", "coordinator", "admin"],
  "preparing->ready": ["merchant_owner", "merchant_staff"],
  "preparing->cancelled": ["system", "coordinator", "admin"],
  "ready->picked_up": ["rider"],
  "ready->cancelled": ["coordinator", "admin"],
  "picked_up->delivered": ["rider"],
  "picked_up->failed_delivery": ["rider", "coordinator", "admin"],
};

/**
 * The one place that decides whether an order may move from one status to another and who may
 * move it. Services call it before every status change; the database repeats the transition check
 * and writes the order_events row.
 */
export class OrderStateMachine {
  /** The actors allowed to make a change (empty when the change is not allowed at all). */
  actorsFor(from: OrderStatus, to: OrderStatus): readonly OrderActor[] {
    if (!ORDER_STATUS_TRANSITIONS[from].includes(to)) return [];
    return ACTORS[`${from}->${to}`] ?? [];
  }

  /** Statuses an order never leaves. */
  isTerminal(status: OrderStatus): boolean {
    return ORDER_STATUS_TRANSITIONS[status].length === 0;
  }

  /** Where this actor may move an order next, in the lifecycle's order. */
  nextFor(from: OrderStatus, actor: OrderActor): OrderStatus[] {
    return ORDER_STATUS_TRANSITIONS[from].filter((to) => this.actorsFor(from, to).includes(actor));
  }

  check(from: OrderStatus, to: OrderStatus, actor: OrderActor): Result<void, AppError> {
    if (!ORDER_STATUS_TRANSITIONS[from].includes(to)) {
      return err(new ConflictError(`An order that is ${from} cannot become ${to}.`));
    }
    if (!this.actorsFor(from, to).includes(actor)) {
      return err(new ForbiddenError(`Only ${this.actorsFor(from, to).join(", ")} may do that.`));
    }
    return ok(undefined);
  }
}

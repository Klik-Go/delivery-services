import {
  ORDER_STATUS_TRANSITIONS,
  type AppRole,
  type OrderKind,
  type OrderStatus,
} from "@klikgo/types";
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
 * Pabili orders (Phase 13) have no store: Klik Go takes the order at once (placed → accepted) and
 * the rider shops (accepted → preparing) and records the purchase (preparing → ready). The customer
 * may cancel until a rider takes the job (the lifecycle service checks the rider part); once the
 * rider is shopping only the coordinator or an admin can. Other changes are as for store orders.
 */
const PABILI_ACTORS: Readonly<Partial<Record<Transition, readonly OrderActor[]>>> = {
  ...ACTORS,
  "placed->accepted": ["system"],
  "placed->rejected": [],
  "accepted->preparing": ["rider"],
  "accepted->cancelled": ["system", "customer", "coordinator", "admin"],
  "preparing->ready": ["rider"],
};

const ACTORS_BY_KIND: Readonly<Record<OrderKind, typeof ACTORS>> = {
  store: ACTORS,
  pabili: PABILI_ACTORS,
};

/**
 * The one place that decides whether an order may move from one status to another and who may
 * move it. Services call it before every status change; the database repeats the transition check
 * and writes the order_events row.
 */
export class OrderStateMachine {
  /** The actors allowed to make a change (empty when the change is not allowed at all). */
  actorsFor(from: OrderStatus, to: OrderStatus, kind: OrderKind = "store"): readonly OrderActor[] {
    if (!ORDER_STATUS_TRANSITIONS[from].includes(to)) return [];
    return ACTORS_BY_KIND[kind][`${from}->${to}`] ?? [];
  }

  /** Statuses an order never leaves. */
  isTerminal(status: OrderStatus): boolean {
    return ORDER_STATUS_TRANSITIONS[status].length === 0;
  }

  /** Where this actor may move an order next, in the lifecycle's order. */
  nextFor(from: OrderStatus, actor: OrderActor, kind: OrderKind = "store"): OrderStatus[] {
    return ORDER_STATUS_TRANSITIONS[from].filter((to) =>
      this.actorsFor(from, to, kind).includes(actor),
    );
  }

  check(
    from: OrderStatus,
    to: OrderStatus,
    actor: OrderActor,
    kind: OrderKind = "store",
  ): Result<void, AppError> {
    if (!ORDER_STATUS_TRANSITIONS[from].includes(to)) {
      return err(new ConflictError(`An order that is ${from} cannot become ${to}.`));
    }
    const actors = this.actorsFor(from, to, kind);
    if (!actors.includes(actor)) {
      return err(
        new ForbiddenError(
          actors.length > 0 ? `Only ${actors.join(", ")} may do that.` : "Nobody may do that.",
        ),
      );
    }
    return ok(undefined);
  }
}

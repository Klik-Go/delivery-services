import type { OrderStatus } from "@klikgo/types";
import type { OpsOrder } from "./ports";

/** How each live status is timed (docs/BUILD_PLAN.md Phase 8: amber at 80%, red at 100%). */
export const SLA_TARGETS = {
  /** The store confirms within 3 minutes (docs/BUSINESS.md §5.4). */
  placedSeconds: 180,
  /** A ready order is picked up within 10 minutes. */
  readySeconds: 600,
  /** Delivery takes at most 30 minutes after pickup. */
  pickedUpSeconds: 1800,
  /** Used when a store did not give a prep time. */
  defaultPrepMinutes: 15,
} as const;

export type SlaState = "on_time" | "at_risk" | "late";

export interface Sla {
  readonly state: SlaState;
  /** When the current step should be done. */
  readonly dueAt: Date;
  /** Share of the target used so far (1 = due now). */
  readonly used: number;
}

function startAndTarget(order: OpsOrder): { start: Date; seconds: number } | null {
  const status: OrderStatus = order.status;
  switch (status) {
    case "placed":
      return order.placedAt ? { start: order.placedAt, seconds: SLA_TARGETS.placedSeconds } : null;
    case "accepted":
    case "preparing":
      return order.acceptedAt
        ? {
            start: order.acceptedAt,
            seconds: (order.prepMinutes ?? SLA_TARGETS.defaultPrepMinutes) * 60,
          }
        : null;
    case "ready":
      return order.readyAt ? { start: order.readyAt, seconds: SLA_TARGETS.readySeconds } : null;
    case "picked_up":
      return order.pickedUpAt
        ? { start: order.pickedUpAt, seconds: SLA_TARGETS.pickedUpSeconds }
        : null;
    case "awaiting_payment":
    case "delivered":
    case "rejected":
    case "cancelled":
    case "failed_delivery":
      return null;
  }
}

/** The order's timer for its current step, or null for finished orders. */
export function slaOf(order: OpsOrder, now: Date): Sla | null {
  const timing = startAndTarget(order);
  if (!timing) return null;
  const used = (now.getTime() - timing.start.getTime()) / (timing.seconds * 1000);
  return {
    state: used >= 1 ? "late" : used >= 0.8 ? "at_risk" : "on_time",
    dueAt: new Date(timing.start.getTime() + timing.seconds * 1000),
    used: Math.max(0, used),
  };
}

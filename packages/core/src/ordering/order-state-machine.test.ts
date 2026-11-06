import { APP_ROLES, ORDER_STATUSES, type OrderStatus } from "@klikgo/types";
import { describe, expect, it } from "vitest";
import { OrderStateMachine, type OrderActor } from "./order-state-machine";

/**
 * The full rulebook, written out by hand (docs/ARCHITECTURE.md §4): every other pair of statuses
 * and every other actor must be refused. Keeping it separate from the implementation's table makes
 * an accidental change to either one fail here.
 */
const ALLOWED: Readonly<Record<string, readonly OrderActor[]>> = {
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

const ACTORS: readonly OrderActor[] = [...APP_ROLES, "system"];
const PAIRS: [OrderStatus, OrderStatus][] = ORDER_STATUSES.flatMap((from) =>
  ORDER_STATUSES.map((to): [OrderStatus, OrderStatus] => [from, to]),
);

describe("OrderStateMachine (every pair of statuses × every actor)", () => {
  const machine = new OrderStateMachine();

  it.each(PAIRS)("%s → %s follows the rulebook for each actor", (from, to) => {
    const allowed = ALLOWED[`${from}->${to}`] ?? [];
    for (const actor of ACTORS) {
      const result = machine.check(from, to, actor);
      if (allowed.includes(actor)) {
        expect(result, `${actor} may move ${from} → ${to}`).toEqual({ ok: true, value: undefined });
      } else {
        // A change that does not exist is a conflict; an existing change by the wrong actor is forbidden.
        const expected = allowed.length === 0 ? "CONFLICT" : "FORBIDDEN";
        expect(!result.ok && result.error.code, `${actor} on ${from} → ${to}`).toBe(expected);
      }
    }
    expect([...machine.actorsFor(from, to)].sort()).toEqual([...allowed].sort());
  });

  it("knows the terminal statuses and the next steps of a live order", () => {
    expect(machine.isTerminal("delivered")).toBe(true);
    expect(machine.isTerminal("cancelled")).toBe(true);
    expect(machine.isTerminal("preparing")).toBe(false);
    expect(machine.nextFor("placed", "merchant_owner")).toEqual(["accepted", "rejected"]);
    expect(machine.nextFor("placed", "customer")).toEqual(["cancelled"]);
    expect(machine.nextFor("delivered", "admin")).toEqual([]);
  });
});

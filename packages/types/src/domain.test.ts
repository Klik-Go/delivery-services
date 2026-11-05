import { describe, expect, it } from "vitest";
import {
  INITIAL_ORDER_STATUSES,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  OrderStatusSchema,
  POSTGRES_ENUMS,
  ZONE_RADIUS_KM,
} from "./domain";

describe("domain enums", () => {
  it("validates order statuses with zod", () => {
    expect(OrderStatusSchema.parse("placed")).toBe("placed");
    expect(OrderStatusSchema.safeParse("teleported").success).toBe(false);
  });

  it("only moves orders forward: terminal statuses have no exits", () => {
    for (const terminal of ["delivered", "rejected", "cancelled", "failed_delivery"] as const) {
      expect(ORDER_STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("only lets an order be cancelled before pickup (after pickup it is delivered or failed)", () => {
    const cancellable = ORDER_STATUSES.filter((s) =>
      ORDER_STATUS_TRANSITIONS[s].includes("cancelled"),
    );
    expect(cancellable).toEqual(["awaiting_payment", "placed", "accepted", "preparing", "ready"]);
  });

  it("creates orders as awaiting payment (online) or placed (COD / QR Ph on delivery)", () => {
    expect(INITIAL_ORDER_STATUSES).toEqual(["awaiting_payment", "placed"]);
  });

  it("keeps zone radius bands from docs/BUSINESS.md §5.5", () => {
    expect(ZONE_RADIUS_KM).toEqual({
      barangay: { min: 3, max: 5 },
      city: { min: 8, max: 15 },
      provincial: { min: 20, max: 40 },
    });
  });

  it("lists every enum once for the database parity check", () => {
    expect(Object.keys(POSTGRES_ENUMS)).toHaveLength(22);
    for (const values of Object.values(POSTGRES_ENUMS))
      expect(new Set(values).size).toBe(values.length);
  });
});

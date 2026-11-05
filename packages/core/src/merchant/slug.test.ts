import { describe, expect, it } from "vitest";
import { effectiveCommissionBps, foundingPeriodEnd } from "./commission";
import { slugify } from "./slug";

describe("store slugs", () => {
  it("makes readable URLs from Filipino store names", () => {
    expect(slugify("Aling Nena's Karinderya")).toBe("aling-nenas-karinderya");
    expect(slugify("Kape't Tinapay")).toBe("kapet-tinapay");
    expect(slugify("  Niño's  BBQ & Grill!! ")).toBe("ninos-bbq-grill");
    expect(slugify("!!!")).toBe("store");
    expect(slugify("a".repeat(70))).toHaveLength(60);
    expect(slugify(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });

  it("stays fast on hostile input full of dashes", () => {
    const started = performance.now();
    expect(slugify(`${"-".repeat(100_000)}x${"-".repeat(100_000)}`)).toBe("x");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("commission", () => {
  it("is 0% during the founding period and the agreed rate after it", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    const until = foundingPeriodEnd(now);
    expect(until.toISOString()).toBe("2027-02-03T00:00:00.000Z");
    expect(
      effectiveCommissionBps({ commissionBps: 2000, foundingCommissionUntil: until }, now),
    ).toBe(0);
    expect(
      effectiveCommissionBps({ commissionBps: 2000, foundingCommissionUntil: until }, until),
    ).toBe(2000);
    expect(
      effectiveCommissionBps({ commissionBps: 1500, foundingCommissionUntil: null }, now),
    ).toBe(1500);
  });
});

import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { InMemoryOrderStore, InMemoryPromos } from "../testing/ordering-fakes";
import type { PromoRecord } from "./ports";
import { PromoService } from "./promo-service";

type Promo = Omit<PromoRecord, "redemptions" | "redemptionsByUser">;
const promo = (overrides: Partial<Promo>): Promo => ({
  id: "p-1",
  code: "SAVE10",
  type: "percent_off",
  discountBps: 1000,
  discountCentavos: null,
  maxDiscountCentavos: 3000,
  minSubtotalCentavos: 0,
  startsAt: new Date("2026-11-01T00:00:00Z"),
  endsAt: new Date("2026-12-01T00:00:00Z"),
  maxRedemptions: null,
  perUserLimit: 1,
  zoneId: null,
  merchantId: null,
  fundedBy: "platform",
  isActive: true,
  ...overrides,
});
const cart = {
  userId: "u-1",
  zoneId: "z-1",
  merchantId: "m-1",
  subtotalCentavos: 50000,
  deliveryFeeCentavos: 3900,
};

function setup(p: Promo) {
  const store = new InMemoryOrderStore();
  const promos = new InMemoryPromos(store);
  promos.promos.push(p);
  const service = new PromoService({
    promos,
    clock: new FakeClock(new Date("2026-11-05T00:00:00Z")),
  });
  return { store, service };
}

describe("PromoService", () => {
  it("takes a percentage off the subtotal, capped at the maximum, matching any letter case", async () => {
    const { service } = setup(promo({}));
    expect(await service.apply("save10", cart)).toEqual({
      ok: true,
      value: {
        promoId: "p-1",
        code: "SAVE10",
        type: "percent_off",
        discountCentavos: 3000,
        fundedBy: "platform",
      },
    });
    const small = await service.apply("SAVE10", { ...cart, subtotalCentavos: 12000 });
    expect(small.ok && small.value.discountCentavos).toBe(1200);
  });

  it("makes delivery free, and never takes off more than the subtotal for a fixed amount", async () => {
    const free = setup(promo({ type: "free_delivery", discountBps: null }));
    const applied = await free.service.apply("SAVE10", cart);
    expect(applied.ok && applied.value.discountCentavos).toBe(3900);
    const fixed = setup(promo({ type: "fixed_off", discountBps: null, discountCentavos: 99_999 }));
    const capped = await fixed.service.apply("SAVE10", { ...cart, subtotalCentavos: 4000 });
    expect(capped.ok && capped.value.discountCentavos).toBe(4000);
  });

  it.each([
    ["unknown", promo({ code: "OTHER" }), cart, "not valid right now"],
    ["inactive", promo({ isActive: false }), cart, "not valid right now"],
    [
      "not started",
      promo({ startsAt: new Date("2026-11-10T00:00:00Z") }),
      cart,
      "not valid right now",
    ],
    ["ended", promo({ endsAt: new Date("2026-11-04T00:00:00Z") }), cart, "not valid right now"],
    ["other area", promo({ zoneId: "z-2" }), cart, "does not work in your area"],
    ["other store", promo({ merchantId: "m-2" }), cart, "for a different store"],
    ["below minimum", promo({ minSubtotalCentavos: 60000 }), cart, "Add ₱100 more"],
  ])("refuses a promo that is %s", async (_label, p, context, message) => {
    const { service } = setup(p);
    const result = await service.apply("SAVE10", context);
    expect(!result.ok && result.error).toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [{ path: "promoCode" }],
    });
    expect(!result.ok && result.error.message).toContain(message);
  });

  it("refuses a promo the customer already used, or that everyone has used up", async () => {
    const mine = setup(promo({}));
    mine.store.redemptions.push({ promoId: "p-1", orderId: "o-1", userId: "u-1" });
    const used = await mine.service.apply("SAVE10", cart);
    expect(!used.ok && used.error.message).toContain("already used");

    const all = setup(promo({ maxRedemptions: 1, perUserLimit: 5 }));
    all.store.redemptions.push({ promoId: "p-1", orderId: "o-9", userId: "someone-else" });
    const gone = await all.service.apply("SAVE10", cart);
    expect(!gone.ok && gone.error.message).toContain("used up");
  });
});

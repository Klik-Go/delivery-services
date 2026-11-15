import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { InMemoryOrderStore, InMemoryPromos, type PromoSetup } from "../testing/ordering-fakes";
import { PromoService, type PromoRequest } from "./promo-service";

const promo = (overrides: Partial<PromoSetup>): PromoSetup => ({
  id: "p-1",
  code: "SAVE10",
  type: "percent_off",
  description: null,
  discountBps: 1000,
  discountCentavos: null,
  maxDiscountCentavos: 3000,
  minSubtotalCentavos: 0,
  startsAt: new Date("2026-11-01T00:00:00Z"),
  endsAt: new Date("2026-12-01T00:00:00Z"),
  maxRedemptions: null,
  budgetCentavos: null,
  perUserLimit: 1,
  firstOrders: null,
  zoneId: null,
  merchantId: null,
  ownerId: null,
  source: "campaign",
  fundedBy: "platform",
  isActive: true,
  ...overrides,
});
const cart: PromoRequest = {
  userId: "u-1",
  phoneHash: "phone-1",
  deviceHash: "device-1",
  zoneId: "z-1",
  merchantId: "m-1",
  subtotalCentavos: 50000,
  deliveryFeeCentavos: 3900,
};

function setup(...setups: PromoSetup[]) {
  const store = new InMemoryOrderStore();
  const promos = new InMemoryPromos(store);
  promos.promos.push(...setups);
  const service = new PromoService({
    promos,
    clock: new FakeClock(new Date("2026-11-05T00:00:00Z")),
  });
  const used = (by: Partial<(typeof store.redemptions)[number]>, promoId = "p-1"): void => {
    store.redemptions.push({
      promoId,
      orderId: `o-${String(store.redemptions.length)}`,
      userId: "someone",
      discountCentavos: 3000,
      phoneHash: null,
      deviceHash: null,
      ...by,
    });
  };
  return { store, promos, service, used };
}

const refusal = async (service: PromoService, code: string, request = cart): Promise<string> => {
  const result = await service.apply(code, request);
  return result.ok ? "applied" : result.error.message;
};

describe("PromoService: discounts", () => {
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
    const small = await service.apply("SAVE10", { ...cart, subtotalCentavos: 20000 });
    expect(small.ok && small.value.discountCentavos).toBe(2000);
  });

  it("never takes off more than the subtotal for a fixed amount", async () => {
    const { service } = setup(
      promo({ type: "fixed_off", discountBps: null, discountCentavos: 10000 }),
    );
    const applied = await service.apply("SAVE10", { ...cart, subtotalCentavos: 8000 });
    expect(applied.ok && applied.value.discountCentavos).toBe(8000);
  });

  it("takes off the delivery fee for free delivery, up to its cap", async () => {
    const { service } = setup(
      promo({ type: "free_delivery", discountBps: null, maxDiscountCentavos: null }),
      promo({
        id: "p-2",
        code: "HATID40",
        type: "free_delivery",
        discountBps: null,
        maxDiscountCentavos: 4000,
      }),
    );
    const full = await service.apply("SAVE10", { ...cart, deliveryFeeCentavos: 5900 });
    expect(full.ok && full.value.discountCentavos).toBe(5900);
    const capped = await service.apply("HATID40", { ...cart, deliveryFeeCentavos: 5900 });
    expect(capped.ok && capped.value.discountCentavos).toBe(4000);
  });
});

describe("PromoService: eligibility", () => {
  it("refuses unknown, switched-off, expired and not-yet-started codes alike", async () => {
    const { service } = setup(
      promo({ id: "a", code: "OFFCODE", isActive: false }),
      promo({ id: "b", code: "OLDCODE", endsAt: new Date("2026-11-02T00:00:00Z") }),
      promo({ id: "c", code: "SOONCODE", startsAt: new Date("2026-11-10T00:00:00Z") }),
    );
    for (const code of ["NOPE", "OFFCODE", "OLDCODE", "SOONCODE"]) {
      expect(await refusal(service, code)).toBe("That promo code is not valid right now.");
    }
  });

  it("keeps zone and store promos to their zone and store", async () => {
    const { service } = setup(
      promo({ id: "a", code: "ZONECODE", zoneId: "z-2" }),
      promo({ id: "b", code: "STORECODE", merchantId: "m-2" }),
    );
    expect(await refusal(service, "ZONECODE")).toBe("That promo code does not work in your area.");
    expect(await refusal(service, "STORECODE")).toBe("That promo code is for a different store.");
  });

  it("says how much more to add for the minimum order", async () => {
    const { service } = setup(promo({ minSubtotalCentavos: 30000 }));
    expect(await refusal(service, "SAVE10", { ...cart, subtotalCentavos: 25050 })).toBe(
      "Add ₱50 more to use this code.",
    );
  });

  it("limits first-order promos to new customers, and first-N promos to N orders", async () => {
    const { service, promos } = setup(
      promo({ id: "a", code: "BAGO", firstOrders: 1 }),
      promo({ id: "b", code: "FIRST3", firstOrders: 3 }),
    );
    expect(await refusal(service, "BAGO")).toBe("applied");
    promos.delivered.set("u-1", 1);
    expect(await refusal(service, "BAGO")).toBe("That promo code is for your first order only.");
    expect(await refusal(service, "FIRST3")).toBe("applied");
    promos.delivered.set("u-1", 3);
    expect(await refusal(service, "FIRST3")).toBe(
      "That promo code is for your first 3 orders only.",
    );
  });

  it("stops at the total number of uses and at the peso budget", async () => {
    const { service, used } = setup(
      promo({ id: "a", code: "ONLY2", maxRedemptions: 2 }),
      promo({ id: "b", code: "BUDGET", budgetCentavos: 5000 }),
    );
    used({}, "a");
    expect(await refusal(service, "ONLY2")).toBe("applied");
    used({}, "a");
    expect(await refusal(service, "ONLY2")).toBe("That promo code has been used up.");
    used({ discountCentavos: 3000 }, "b");
    // ₱30 given away of ₱50: another ₱30 would go over.
    expect(await refusal(service, "BUDGET")).toBe("That promo code has been used up.");
    expect(await refusal(service, "BUDGET", { ...cart, subtotalCentavos: 20000 })).toBe("applied");
  });

  it("refuses a second use by the same account, phone number or device", async () => {
    const { service, used } = setup(promo({}));
    const stranger = { ...cart, userId: "u-9", phoneHash: "phone-9", deviceHash: "device-9" };
    expect(await refusal(service, "SAVE10", stranger)).toBe("applied");
    for (const by of [{ userId: "u-1" }, { phoneHash: "phone-1" }, { deviceHash: "device-1" }]) {
      const fresh = setup(promo({}));
      fresh.used(by);
      expect(await refusal(fresh.service, "SAVE10")).toBe("You have already used that promo code.");
    }
    used({ deviceHash: "device-1" });
    expect(await refusal(service, "SAVE10", { ...cart, userId: "u-2", phoneHash: "phone-2" })).toBe(
      "You have already used that promo code.",
    );
  });

  it("lets only its owner use a personal voucher; others see an unknown code", async () => {
    const { service } = setup(promo({ ownerId: "u-1", source: "loyalty" }));
    expect(await refusal(service, "SAVE10")).toBe("applied");
    expect(await refusal(service, "SAVE10", { ...cart, userId: "u-2" })).toBe(
      "That promo code is not valid right now.",
    );
  });
});

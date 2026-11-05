import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { DistanceBandFee, ServiceFee, SmallOrderFee, ZoneBaseFee } from "./fee-strategies";
import { PricingService } from "./pricing-service";
import { AYALA, catalogWorld } from "../testing/catalog-world";

function setup() {
  const { area, catalog } = catalogWorld();
  const pricing = new PricingService({
    catalog,
    serviceArea: area,
    delivery: [new DistanceBandFee(), new ZoneBaseFee()],
    surcharges: [new SmallOrderFee(), new ServiceFee()],
    clock: new FakeClock(new Date("2026-11-02T03:00:00Z")),
  });
  return { pricing, catalog };
}

describe("PricingService", () => {
  it("prices items and choices from the menu, then adds delivery and small-order fees", async () => {
    const { pricing } = setup();
    const quote = await pricing.quote({
      merchantId: "kape",
      items: [{ itemId: "item-barako", quantity: 2, optionIds: ["o-less"] }],
      dropoff: AYALA,
    });
    expect(quote.ok && quote.value).toMatchObject({
      subtotalCentavos: 12000,
      deliveryFeeCentavos: 3900,
      smallOrderFeeCentavos: 2000,
      serviceFeeCentavos: 0,
      totalCentavos: 17900,
      deliverable: true,
      lines: [{ name: "Kapeng Barako", unitPriceCentavos: 6000, optionNames: ["Less sugar"] }],
    });
  });

  it("adds paid choices and drops the small-order fee above the minimum", async () => {
    const { pricing } = setup();
    const quote = await pricing.quote({
      merchantId: "kape",
      items: [{ itemId: "item-barako", quantity: 3, optionIds: ["o-extra"] }],
      dropoff: AYALA,
    });
    expect(quote.ok && quote.value).toMatchObject({
      subtotalCentavos: 25500,
      smallOrderFeeCentavos: 0,
    });
  });

  it("flags sold-out, unknown and incomplete lines and leaves them out of the total", async () => {
    const { pricing } = setup();
    const quote = await pricing.quote({
      merchantId: "kape",
      items: [
        { itemId: "item-ensaymada", quantity: 1, optionIds: [] },
        { itemId: "item-pandesal", quantity: 1, optionIds: [] },
        { itemId: "item-barako", quantity: 1, optionIds: [] },
        { itemId: "item-missing", quantity: 1, optionIds: [] },
      ],
      dropoff: AYALA,
    });
    expect(quote.ok && quote.value.subtotalCentavos).toBe(4000);
    expect(quote.ok && quote.value.issues).toEqual([
      { itemId: "item-ensaymada", code: "sold_out" },
      { itemId: "item-barako", code: "choices_needed" },
      { itemId: "item-missing", code: "not_found" },
    ]);
  });

  it("refuses foreign or too many choices, and sold-out choices", async () => {
    const { pricing } = setup();
    const quote = await pricing.quote({
      merchantId: "kape",
      items: [
        { itemId: "item-barako", quantity: 1, optionIds: ["o-none", "o-less"] },
        { itemId: "item-pandesal", quantity: 1, optionIds: ["o-less"] },
        { itemId: "item-barako", quantity: 1, optionIds: ["o-gone"] },
      ],
      dropoff: AYALA,
    });
    expect(quote.ok && quote.value.issues.map((i) => i.code)).toEqual([
      "invalid_choice",
      "invalid_choice",
      "sold_out",
    ]);
    expect(quote.ok && quote.value.smallOrderFeeCentavos).toBe(0);
  });

  it("uses the zone's base fee and per-km rate when no distance band applies", () => {
    const { pricing } = setup();
    const fees = { baseFeeCentavos: 3900, perKmCentavos: 1000, rules: [] };
    expect(pricing.deliveryFee(fees, 800)).toBe(3900);
    expect(pricing.deliveryFee(fees, 3200)).toBe(6900);
  });

  it("charges a service fee when the zone has one, and nothing when no strategy applies", async () => {
    const { pricing, catalog } = setup();
    const fees = await catalog.zoneFees("zone-makati");
    catalog.fees.set("zone-makati", {
      ...fees,
      rules: [
        ...fees.rules,
        {
          kind: "service_fee",
          minDistanceM: null,
          maxDistanceM: null,
          minSubtotalCentavos: null,
          feeCentavos: 500,
          priority: 1,
        },
      ],
    });
    const quote = await pricing.quote({
      merchantId: "kape",
      items: [{ itemId: "item-pandesal", quantity: 1, optionIds: [] }],
      dropoff: AYALA,
    });
    expect(quote.ok && quote.value.serviceFeeCentavos).toBe(500);
    const empty = new PricingService({
      catalog,
      serviceArea: { zoneFor: () => Promise.resolve(null) },
      delivery: [],
      surcharges: [],
      clock: new FakeClock(),
    });
    expect(empty.deliveryFee(fees, 1000)).toBe(0);
  });

  it("says when the store does not deliver to the pin, and when the store is unknown", async () => {
    const { pricing } = setup();
    const outside = await pricing.quote({
      merchantId: "kape",
      items: [{ itemId: "item-pandesal", quantity: 1, optionIds: [] }],
      dropoff: { lat: 10.3, lng: 123.9 },
    });
    expect(outside.ok && outside.value.deliverable).toBe(false);
    const missing = await pricing.quote({
      merchantId: "nope",
      items: [{ itemId: "x", quantity: 1, optionIds: [] }],
      dropoff: AYALA,
    });
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
  });
});

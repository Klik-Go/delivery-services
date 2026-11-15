import { describe, expect, it } from "vitest";
import { DistanceBandFee, ServiceFee, SmallOrderFee, ZoneBaseFee } from "../catalog/fee-strategies";
import { PricingService } from "../catalog/pricing-service";
import { AYALA, catalogWorld } from "../testing/catalog-world";
import { FakeClock } from "../testing/fake-clock";
import { InMemoryOrderHistory } from "../testing/retention-fakes";
import { sessionUser } from "../testing/session-users";
import { HISTORY_PAGE, OrderHistoryService } from "./order-history-service";
import type { HistoryOrder, ReorderSource } from "./ports";

function setup() {
  const { area, catalog } = catalogWorld();
  const pricing = new PricingService({
    catalog,
    serviceArea: area,
    delivery: [new DistanceBandFee(), new ZoneBaseFee()],
    surcharges: [new SmallOrderFee(), new ServiceFee()],
    clock: new FakeClock(new Date("2026-11-02T03:00:00Z")),
  });
  const history = new InMemoryOrderHistory();
  const service = new OrderHistoryService({ history, pricing });
  const source = (lines: ReorderSource["lines"]): ReorderSource => ({
    orderId: "order-1",
    customerId: "carmen",
    merchantId: "kape",
    merchantSlug: "kape-t-tinapay",
    dropoff: AYALA,
    lines,
  });
  return {
    history,
    service,
    source,
    carmen: sessionUser("carmen", [{ role: "customer" }], "aal1"),
  };
}

const past = (i: number, customerId = "carmen"): HistoryOrder & { customerId: string } => ({
  id: `order-${String(i)}`,
  code: `KG-00000${String(i)}`,
  status: "delivered",
  merchantId: "kape",
  merchantName: "Kape't Tinapay",
  merchantSlug: "kape-t-tinapay",
  totalCentavos: 17900,
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)),
  deliveredAt: new Date(Date.UTC(2026, 10, 1, 1, i)),
  itemCount: 2,
  itemsSummary: "2× Kapeng Barako",
  hasRider: true,
  rated: [],
  customerId,
});

describe("OrderHistoryService", () => {
  it("lists the customer's own orders, newest first, a page at a time", async () => {
    const { history, service, carmen } = setup();
    for (let i = 0; i < HISTORY_PAGE + 3; i += 1) history.orders.push(past(i));
    history.orders.push(past(99, "diego"));
    const first = await service.list(carmen, null);
    expect(first.ok && first.value).toHaveLength(HISTORY_PAGE);
    expect(first.ok && first.value[0]?.id).toBe(`order-${String(HISTORY_PAGE + 2)}`);
    const last = first.ok ? first.value[first.value.length - 1] : undefined;
    const next = await service.list(carmen, last?.createdAt ?? null);
    expect(next.ok && next.value.map((o) => o.id)).toEqual(["order-2", "order-1", "order-0"]);
    expect((await service.list(null, null)).ok).toBe(false);
  });

  it("prices a reorder today and flags sold-out, removed and changed items", async () => {
    const { history, service, source, carmen } = setup();
    history.sources.set(
      "order-1",
      source([
        { menuItemId: "item-barako", name: "Kapeng Barako", quantity: 2, optionIds: ["o-less"] },
        { menuItemId: "item-ensaymada", name: "Ensaymada", quantity: 1, optionIds: [] },
        { menuItemId: null, name: "Old special", quantity: 1, optionIds: [] },
        { menuItemId: "item-pandesal", name: "Pandesal (10 pcs)", quantity: 1, optionIds: [] },
        { menuItemId: "item-barako", name: "Kapeng Barako", quantity: 1, optionIds: ["o-gone"] },
      ]),
    );
    const plan = await service.reorder(carmen, "order-1");
    expect(plan.ok && plan.value.lines.map((l) => [l.name, l.available, l.issue])).toEqual([
      ["Kapeng Barako", true, null],
      ["Ensaymada", false, "sold_out"],
      ["Old special", false, "removed"],
      ["Pandesal (10 pcs)", true, null],
      // The Muscovado choice is sold out today.
      ["Kapeng Barako", false, "sold_out"],
    ]);
    expect(plan.ok && plan.value.lines[0]?.unitPriceCentavos).toBe(6000);
    expect(plan.ok && plan.value.quote?.subtotalCentavos).toBe(2 * 6000 + 4000);
    expect(plan.ok && plan.value.merchantSlug).toBe("kape-t-tinapay");
  });

  it("returns no quote when nothing can be ordered again, and hides other people's orders", async () => {
    const { history, service, source, carmen } = setup();
    history.sources.set(
      "order-1",
      source([{ menuItemId: null, name: "Old special", quantity: 1, optionIds: [] }]),
    );
    const plan = await service.reorder(carmen, "order-1");
    expect(plan.ok && plan.value.quote).toBeNull();
    const diego = sessionUser("diego", [{ role: "customer" }], "aal1");
    const theirs = await service.reorder(diego, "order-1");
    expect(!theirs.ok && theirs.error.code).toBe("NOT_FOUND");
    expect((await service.reorder(null, "order-1")).ok).toBe(false);
  });
});

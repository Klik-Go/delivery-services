import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { MemoryLogger } from "../testing/memory-logger";
import { InMemoryRatings } from "../testing/retention-fakes";
import { sessionUser } from "../testing/session-users";
import type { RatableOrder } from "./ports";
import { RatingService } from "./rating-service";

const DELIVERED = new Date("2026-11-15T04:00:00Z");
const HOUR = 60 * 60 * 1000;

function setup() {
  const clock = new FakeClock(new Date(DELIVERED.getTime() + HOUR));
  const repo = new InMemoryRatings(() => clock.now());
  const order: RatableOrder = {
    id: "order-1",
    code: "KG-ABC123",
    customerId: "carmen",
    merchantId: "nena",
    merchantName: "Aling Nena's",
    zoneId: "makati",
    riderId: "rider-rico",
    riderUserId: "rico",
    riderName: "Rico",
    status: "delivered",
    deliveredAt: DELIVERED,
  };
  repo.orders.set(order.id, order);
  const service = new RatingService({ ratings: repo, clock, logger: new MemoryLogger() });
  return {
    clock,
    repo,
    order,
    service,
    carmen: sessionUser("carmen", [{ role: "customer" }], "aal1"),
    rico: sessionUser("rico", [{ role: "rider" }], "aal1"),
  };
}

describe("RatingService: customers rate the store and the rider", () => {
  it("rates both separately after delivery and shows each rating as editable for 24 hours", async () => {
    const { service, carmen, repo } = setup();
    const sheet = await service.rateOrder(carmen, "order-1", {
      merchant: { score: 5, tags: ["tasty", "hot_food"], comment: " Masarap! " },
      rider: { score: 4, tags: ["friendly"] },
    });
    expect(sheet.ok && sheet.value).toMatchObject({
      open: true,
      closesAt: "2026-11-22T04:00:00.000Z",
      merchant: {
        name: "Aling Nena's",
        rating: { score: 5, tags: ["tasty", "hot_food"], comment: "Masarap!" },
      },
      rider: { name: "Rico", rating: { score: 4, comment: null } },
    });
    expect(sheet.ok && sheet.value.merchant?.rating?.editableUntil).toBe(
      "2026-11-16T05:00:00.000Z",
    );
    expect(repo.ratingsStore.map((r) => [r.targetType, r.targetId])).toEqual([
      ["merchant", "nena"],
      ["rider", "rider-rico"],
    ]);
    expect(repo.tickets).toEqual([]);
  });

  it("lets a rating change within 24 hours, then locks it", async () => {
    const { service, carmen, clock, repo } = setup();
    await service.rateOrder(carmen, "order-1", { merchant: { score: 3, tags: [] } });
    clock.advanceBy(10 * HOUR);
    const changed = await service.rateOrder(carmen, "order-1", {
      merchant: { score: 4, tags: [] },
    });
    expect(changed.ok && changed.value.merchant?.rating?.score).toBe(4);
    expect(repo.ratingsStore).toHaveLength(1);
    clock.advanceBy(15 * HOUR);
    const late = await service.rateOrder(carmen, "order-1", { merchant: { score: 5, tags: [] } });
    expect(!late.ok && late.error.message).toBe("Your store rating can no longer be changed.");
    const sheet = await service.sheet(carmen, "order-1");
    expect(sheet.ok && sheet.value.merchant?.rating?.editableUntil).toBeNull();
  });

  it("closes ratings 7 days after delivery and refuses orders not yet delivered", async () => {
    const { service, carmen, clock, repo, order } = setup();
    clock.advanceBy(7 * 24 * HOUR);
    const late = await service.rateOrder(carmen, "order-1", { merchant: { score: 5, tags: [] } });
    expect(!late.ok && late.error.message).toBe("Ratings close 7 days after delivery.");
    const sheet = await service.sheet(carmen, "order-1");
    expect(sheet.ok && sheet.value.open).toBe(false);

    repo.orders.set("order-2", { ...order, id: "order-2", status: "picked_up", deliveredAt: null });
    const early = await service.rateOrder(carmen, "order-2", { merchant: { score: 5, tags: [] } });
    expect(!early.ok && early.error.message).toBe(
      "You can rate an order once it has been delivered.",
    );
  });

  it("treats someone else's order as missing", async () => {
    const { service } = setup();
    const diego = sessionUser("diego", [{ role: "customer" }], "aal1");
    const result = await service.rateOrder(diego, "order-1", { merchant: { score: 1, tags: [] } });
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect(!(await service.sheet(null, "order-1")).ok).toBe(true);
  });

  it("refuses a rider rating on an order that had no rider", async () => {
    const { service, carmen, repo, order } = setup();
    repo.orders.set("order-1", { ...order, riderId: null, riderUserId: null, riderName: null });
    const result = await service.rateOrder(carmen, "order-1", { rider: { score: 5, tags: [] } });
    expect(!result.ok && result.error.code).toBe("VALIDATION_FAILED");
    const sheet = await service.sheet(carmen, "order-1");
    expect(sheet.ok && sheet.value.rider).toBeNull();
  });

  it("opens one coordinator ticket for a rating of 2 or less, with tags but never the comment", async () => {
    const { service, carmen, repo } = setup();
    await service.rateOrder(carmen, "order-1", {
      merchant: { score: 2, tags: ["cold_food", "missing_item"], comment: "Call me at 0917…" },
    });
    expect(repo.tickets).toEqual([
      {
        zoneId: "makati",
        summary: "Store Aling Nena's rated 2/5 on KG-ABC123 (cold food, missing item)",
        ratingId: "rating-1",
      },
    ]);
    // Changing it to 1 does not open a second ticket.
    await service.rateOrder(carmen, "order-1", { merchant: { score: 1, tags: [] } });
    expect(repo.tickets).toHaveLength(1);
    // A rider rating that drops from 4 to 2 opens its own ticket.
    await service.rateOrder(carmen, "order-1", { rider: { score: 4, tags: [] } });
    await service.rateOrder(carmen, "order-1", { rider: { score: 2, tags: ["late"] } });
    expect(repo.tickets.map((t) => t.summary)).toContain(
      "Rider Rico rated 2/5 on KG-ABC123 (late)",
    );
  });
});

describe("RatingService: riders rate the customer", () => {
  it("lists the rider's deliveries of the last 7 days and rates a customer once", async () => {
    const { service, rico, repo, order, clock } = setup();
    repo.orders.set("old", {
      ...order,
      id: "old",
      deliveredAt: new Date(DELIVERED.getTime() - 8 * 24 * HOUR),
    });
    const list = await service.riderDeliveries(rico);
    expect(list.ok && list.value.map((d) => d.orderId)).toEqual(["order-1"]);

    const rated = await service.rateCustomer(rico, "order-1", {
      score: 1,
      tags: ["no_answer"],
      comment: undefined,
    });
    expect(rated.ok && rated.value.rating).toMatchObject({ score: 1, tags: ["no_answer"] });
    expect(repo.tickets.map((t) => t.summary)).toEqual([
      "Customer rated 1/5 on KG-ABC123 (no answer)",
    ]);
    const again = await service.riderDeliveries(rico);
    expect(again.ok && again.value[0]?.rating?.score).toBe(1);

    clock.advanceBy(25 * HOUR);
    const late = await service.rateCustomer(rico, "order-1", {
      score: 5,
      tags: [],
      comment: undefined,
    });
    expect(!late.ok && late.error.message).toBe("Your customer rating can no longer be changed.");
  });

  it("does not let another rider rate the customer", async () => {
    const { service } = setup();
    const rosa = sessionUser("rosa", [{ role: "rider" }], "aal1");
    const result = await service.rateCustomer(rosa, "order-1", {
      score: 5,
      tags: [],
      comment: undefined,
    });
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
    expect(!(await service.riderDeliveries(null)).ok).toBe(true);
    expect(
      !(await service.rateCustomer(null, "order-1", { score: 5, tags: [], comment: undefined })).ok,
    ).toBe(true);
  });
});

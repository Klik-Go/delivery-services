import { describe, expect, it } from "vitest";
import { sessionUser } from "../testing/session-users";
import { barakoOrder, orderingWorld } from "../testing/ordering-world";

const KEY = "checkout-attempt-0001";

describe("OrderService.placeOrder", () => {
  it("places a cash-on-delivery order straight to the store, priced by the server", async () => {
    const w = orderingWorld();
    const placed = await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    expect(placed).toEqual({
      ok: true,
      value: {
        orderId: "order-1",
        code: "KG-TEST01",
        status: "placed",
        totalCentavos: 17900,
        paymentMethod: "cod",
        checkoutUrl: null,
      },
    });
    const [order] = w.store.orders;
    expect(order).toMatchObject({
      subtotalCentavos: 12000,
      deliveryFeeCentavos: 3900,
      smallOrderFeeCentavos: 2000,
      totalCentavos: 17900,
      prepMinutes: 15,
      zoneId: "zone-makati",
      lines: [
        {
          menuItemId: "item-barako",
          name: "Kapeng Barako",
          basePriceCentavos: 6000,
          modifiersUnitCentavos: 0,
          quantity: 2,
          modifiers: [{ id: "o-less", name: "Less sugar" }],
          lineTotalCentavos: 12000,
        },
      ],
    });
    expect(w.store.payments).toMatchObject([
      { gateway: "cod", method: "cod", amountCentavos: 17900 },
    ]);
  });

  it("starts an online payment and leaves the order waiting for it", async () => {
    const w = orderingWorld();
    const placed = await w.orders.placeOrder(barakoOrder({ paymentMethod: "gcash" }), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    expect(placed.ok && placed.value).toMatchObject({
      status: "awaiting_payment",
      checkoutUrl: "https://pay.example.test/checkout?session=fake_cs_order-1_1",
    });
    expect(w.online.checkouts).toEqual([
      {
        orderId: "order-1",
        orderCode: "KG-TEST01",
        method: "gcash",
        amountCentavos: 17900,
        description: "Klik Go order KG-TEST01",
        successUrl: "https://klikgo.test/orders/order-1?paid=1",
        cancelUrl: "https://klikgo.test/orders/order-1?cancelled=1",
      },
    ]);
  });

  it("answers a repeated Idempotency-Key with the same order instead of a second one", async () => {
    const w = orderingWorld();
    const context = { idempotencyKey: KEY, actor: w.customer, urls: w.urls };
    const first = await w.orders.placeOrder(barakoOrder({ paymentMethod: "gcash" }), context);
    const second = await w.orders.placeOrder(barakoOrder({ paymentMethod: "gcash" }), context);
    expect(second).toEqual(first);
    expect(w.store.orders).toHaveLength(1);
    expect(w.online.checkouts).toHaveLength(1);
  });

  it("refuses an Idempotency-Key that was used for a different cart", async () => {
    const w = orderingWorld();
    const context = { idempotencyKey: KEY, actor: w.customer, urls: w.urls };
    await w.orders.placeOrder(barakoOrder(), context);
    const other = await w.orders.placeOrder(barakoOrder({ tipCentavos: 2000 }), context);
    expect(!other.ok && other.error.code).toBe("CONFLICT");
  });

  it("resumes the payment on retry when the gateway failed the first time", async () => {
    const w = orderingWorld();
    const context = { idempotencyKey: KEY, actor: w.customer, urls: w.urls };
    w.online.failCheckout = true;
    const failed = await w.orders.placeOrder(barakoOrder({ paymentMethod: "maya" }), context);
    expect(!failed.ok && failed.error.code).toBe("UNAVAILABLE");
    expect(w.store.orders).toHaveLength(1);

    w.online.failCheckout = false;
    const retried = await w.orders.placeOrder(barakoOrder({ paymentMethod: "maya" }), context);
    expect(retried.ok && retried.value.checkoutUrl).toContain("fake_cs_order-1");
    expect(w.store.orders).toHaveLength(1);
  });

  it("adds the rider tip and takes off a promo", async () => {
    const w = orderingWorld();
    w.promoRepo.promos.push({
      id: "promo-1",
      code: "KAINTAYO",
      type: "fixed_off",
      discountBps: null,
      discountCentavos: 5000,
      maxDiscountCentavos: null,
      minSubtotalCentavos: 10000,
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2027-01-01"),
      maxRedemptions: null,
      perUserLimit: 1,
      zoneId: null,
      merchantId: null,
      fundedBy: "platform",
      isActive: true,
    });
    const placed = await w.orders.placeOrder(
      barakoOrder({ promoCode: "KAINTAYO", tipCentavos: 2000 }),
      { idempotencyKey: KEY, actor: w.customer, urls: w.urls },
    );
    expect(placed.ok && placed.value.totalCentavos).toBe(17900 - 5000 + 2000);
    expect(w.store.orders[0]).toMatchObject({ discountCentavos: 5000, tipCentavos: 2000 });
    expect(w.store.redemptions).toEqual([
      { promoId: "promo-1", orderId: "order-1", userId: "customer-1" },
    ]);
  });

  it("refuses a promo that does not apply instead of ignoring it silently", async () => {
    const w = orderingWorld();
    const placed = await w.orders.placeOrder(barakoOrder({ promoCode: "NOPE1234" }), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    expect(!placed.ok && placed.error).toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [{ path: "promoCode" }],
    });
    expect(w.store.orders).toEqual([]);
  });

  it("refuses sold-out dishes, pins the store does not reach and closed stores", async () => {
    const w = orderingWorld();
    const context = (key: string) => ({ idempotencyKey: key, actor: w.customer, urls: w.urls });
    const soldOut = await w.orders.placeOrder(
      barakoOrder({ items: [{ itemId: "item-ensaymada", quantity: 1, optionIds: [] }] }),
      context("sold-out-key-000001"),
    );
    expect(!soldOut.ok && soldOut.error.code).toBe("VALIDATION_FAILED");

    const far = await w.orders.placeOrder(
      barakoOrder({ dropoff: { lat: 14.65, lng: 121.2 } }),
      context("far-away-key-000001"),
    );
    expect(!far.ok && far.error).toMatchObject({ issues: [{ path: "dropoff" }] });

    const at = w.catalog.stores.findIndex((s) => s.merchantId === "kape");
    const kape = w.catalog.stores[at];
    if (kape) w.catalog.stores[at] = { ...kape, isOpen: false };
    const closed = await w.orders.placeOrder(barakoOrder(), context("closed-key-00000001"));
    expect(!closed.ok && closed.error.code).toBe("CONFLICT");
    expect(w.store.orders).toEqual([]);
  });

  it("refuses cash on delivery where the store only takes online payments", async () => {
    const w = orderingWorld();
    const kape = w.catalog.stores.find((s) => s.merchantId === "kape");
    if (kape) kape.acceptsCod = false;
    const placed = await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    expect(!placed.ok && placed.error).toMatchObject({ issues: [{ path: "paymentMethod" }] });
  });

  it("accepts a scheduled time only from today's slots", async () => {
    const w = orderingWorld();
    const bad = await w.orders.placeOrder(barakoOrder({ scheduledFor: "2026-11-02T03:10:00Z" }), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    expect(!bad.ok && bad.error).toMatchObject({ issues: [{ path: "scheduledFor" }] });

    const quote = await w.orders.quoteCheckout(barakoOrder(), w.customer);
    const slot = quote.ok ? quote.value.slots[0] : undefined;
    expect(slot).toBe("2026-11-02T04:00:00.000Z");
    const good = await w.orders.placeOrder(barakoOrder({ scheduledFor: slot }), {
      idempotencyKey: "scheduled-key-000001",
      actor: w.customer,
      urls: w.urls,
    });
    expect(good.ok).toBe(true);
    expect(w.store.orders[0]?.scheduledFor?.toISOString()).toBe(slot);
  });

  it("only lets customers place orders", async () => {
    const w = orderingWorld();
    const rider = sessionUser("rider-1", [{ role: "rider" }]);
    const placed = await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: KEY,
      actor: rider,
      urls: w.urls,
    });
    expect(!placed.ok && placed.error.code).toBe("FORBIDDEN");
  });
});

describe("OrderService.quoteCheckout", () => {
  it("prices promo and tip, lists payment methods and reports a bad promo without failing", async () => {
    const w = orderingWorld();
    const quote = await w.orders.quoteCheckout(
      barakoOrder({ promoCode: "NOPE1234", tipCentavos: 1000 }),
      w.customer,
    );
    expect(quote.ok && quote.value).toMatchObject({
      promo: null,
      promoError: "That promo code is not valid right now.",
      tipCentavos: 1000,
      totalCentavos: 18900,
      paymentMethods: ["gcash", "maya", "card", "qrph", "cod"],
    });
  });

  it("asks guests to sign in before using a promo code", async () => {
    const w = orderingWorld();
    const quote = await w.orders.quoteCheckout(barakoOrder({ promoCode: "KAINTAYO" }), null);
    expect(quote.ok && quote.value.promoError).toBe("Sign in to use a promo code.");
  });
});

describe("OrderService.view", () => {
  it("shows the customer their order with its payment page while it awaits payment", async () => {
    const w = orderingWorld();
    await w.orders.placeOrder(barakoOrder({ paymentMethod: "gcash" }), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    const view = await w.orders.view("order-1", w.customer);
    expect(view.ok && view.value).toMatchObject({
      code: "KG-TEST01",
      status: "awaiting_payment",
      paymentMethod: "gcash",
      totalCentavos: 17900,
      refundedCentavos: 0,
      checkoutUrl: expect.stringContaining("fake_cs_order-1") as unknown,
    });
  });

  it("shows the delivery PIN of a big order to its customer only", async () => {
    const w = orderingWorld();
    const big = barakoOrder({
      items: [{ itemId: "item-barako", quantity: 10, optionIds: ["o-less"] }],
    });
    await w.orders.placeOrder(big, { idempotencyKey: KEY, actor: w.customer, urls: w.urls });
    const mine = await w.orders.view("order-1", w.customer);
    expect(mine.ok && mine.value.deliveryPin).toBe("4821");
    const staff = await w.orders.view("order-1", w.owner);
    expect(staff.ok && staff.value.deliveryPin).toBeNull();
  });

  it("hides an order from other customers and asks guests to sign in", async () => {
    const w = orderingWorld();
    await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    const stranger = sessionUser("customer-2", [{ role: "customer" }], "aal1");
    const hidden = await w.orders.view("order-1", stranger);
    expect(!hidden.ok && hidden.error.code).toBe("NOT_FOUND");
    const missing = await w.orders.view("order-9", w.customer);
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
    const guest = await w.orders.view("order-1", null);
    expect(!guest.ok && guest.error.code).toBe("UNAUTHORIZED");
  });

  it("lets the zone's coordinator see the order", async () => {
    const w = orderingWorld();
    await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: KEY,
      actor: w.customer,
      urls: w.urls,
    });
    const coordinator = sessionUser("coord-1", [{ role: "coordinator", zoneId: "zone-makati" }]);
    const view = await w.orders.view("order-1", coordinator);
    expect(view.ok && view.value.checkoutUrl).toBeNull();
  });
});

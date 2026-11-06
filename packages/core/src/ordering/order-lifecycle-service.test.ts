import { describe, expect, it } from "vitest";
import { sessionUser } from "../testing/session-users";
import { barakoOrder, orderingWorld, type OrderingWorld } from "../testing/ordering-world";

async function placed(
  method: "cod" | "gcash" = "cod",
): Promise<{ w: OrderingWorld; orderId: string }> {
  const w = orderingWorld();
  const result = await w.orders.placeOrder(barakoOrder({ paymentMethod: method }), {
    idempotencyKey: "lifecycle-checkout-01",
    actor: w.customer,
    urls: w.urls,
  });
  if (!result.ok) throw result.error;
  return { w, orderId: result.value.orderId };
}

async function paid(): Promise<{ w: OrderingWorld; orderId: string }> {
  const { w, orderId } = await placed("gcash");
  const payment = w.store.payments[0];
  await w.events.handle({
    kind: "payment_paid",
    gateway: "paymongo",
    eventId: "evt_paid",
    type: "checkout_session.payment.paid",
    intentId: payment?.intentId ?? "",
    gatewayPaymentId: "pay_1",
    amountCentavos: 17900,
    feeCentavos: 450,
    payload: {},
  });
  return { w, orderId };
}

describe("OrderLifecycleService", () => {
  it("tells the store about a new cash order as soon as it is placed", async () => {
    const { w, orderId } = await placed();
    expect(w.notifier.changes).toEqual([{ orderId, to: "placed", params: {} }]);
  });

  it("tells the store about an online order only once it is paid", async () => {
    const { w, orderId } = await placed("gcash");
    expect(w.notifier.changes).toEqual([]);
    await paid();
    const again = await paid();
    expect(again.w.notifier.changes).toEqual([{ orderId, to: "placed", params: {} }]);
  });

  it("accepts with a prep time: accepted then preparing, both by the owner, customer told", async () => {
    const { w, orderId } = await placed();
    w.clock.advanceBy(60_000);
    expect(await w.lifecycle.accept(orderId, w.owner, { prepMinutes: 20 })).toEqual({
      ok: true,
      value: { orderId, status: "preparing" },
    });
    expect(w.store.events.slice(1)).toMatchObject([
      {
        from: "placed",
        to: "accepted",
        actorId: "owner-kape",
        actorRole: "merchant_owner",
        meta: { prepMinutes: 20 },
      },
      { from: "accepted", to: "preparing", actorRole: "merchant_owner" },
    ]);
    expect(w.notifier.changes.at(-1)).toMatchObject({ to: "preparing", params: { minutes: 20 } });
    const view = await w.orders.view(orderId, w.customer);
    expect(view.ok && view.value).toMatchObject({
      status: "preparing",
      prepMinutes: 20,
      merchantName: "Kape't Tinapay",
      readyBy: new Date(w.clock.now().getTime() + 20 * 60_000).toISOString(),
      canCancel: false,
    });
  });

  it("marks a preparing order ready, and refuses to skip a step", async () => {
    const { w, orderId } = await placed();
    const early = await w.lifecycle.markReady(orderId, w.owner);
    expect(!early.ok && early.error.code).toBe("CONFLICT");
    await w.lifecycle.accept(orderId, w.owner, { prepMinutes: 15 });
    expect((await w.lifecycle.markReady(orderId, w.owner)).ok).toBe(true);
    expect(w.store.orders[0]?.status).toBe("ready");
  });

  it("rejects with a reason, gives the promo back and tells the customer", async () => {
    const { w, orderId } = await placed();
    w.store.redemptions.push({ promoId: "p1", orderId, userId: "customer-1" });
    const rejected = await w.lifecycle.reject(orderId, w.owner, { reason: "Out of coffee beans" });
    expect(rejected.ok).toBe(true);
    expect(w.store.redemptions).toEqual([]);
    const view = await w.orders.view(orderId, w.customer);
    expect(view.ok && view.value).toMatchObject({
      status: "rejected",
      rejectReason: "Out of coffee beans",
    });
    expect(w.notifier.changes.at(-1)).toMatchObject({
      to: "rejected",
      params: { reason: "Out of coffee beans" },
    });
  });

  it("refunds a paid order the store rejects", async () => {
    const { w, orderId } = await paid();
    await w.lifecycle.reject(orderId, w.owner, { reason: "Closing early" });
    expect(w.store.payments[0]).toMatchObject({ status: "refunded", refundedCentavos: 17900 });
    expect(w.store.ledgerNet(orderId)).toBe(0);
  });

  it("leaves the refund to the background job when the gateway is down", async () => {
    const { w, orderId } = await paid();
    w.online.failRefund = true;
    expect((await w.lifecycle.reject(orderId, w.owner, { reason: "Closing early" })).ok).toBe(true);
    expect(await w.store.refundsDue(10)).toEqual([{ orderId, reason: "Closing early" }]);
    w.online.failRefund = false;
    expect(await w.jobs.run()).toEqual({ notifications: 0, refundsStarted: 1, refundsFailed: 0 });
    expect(await w.store.refundsDue(10)).toEqual([]);
  });

  it("counts refunds the job could not start and logs them for a later run", async () => {
    const { w, orderId } = await paid();
    w.online.failRefund = true;
    await w.lifecycle.reject(orderId, w.owner, { reason: "Closing early" });
    expect(await w.jobs.run()).toEqual({ notifications: 0, refundsStarted: 0, refundsFailed: 1 });
    expect(w.logger.lines.map((l) => l.message)).toContain("jobs.refund_failed");
  });

  it("lets the customer cancel until the store accepts, then explains why not", async () => {
    const first = await placed();
    expect(await first.w.lifecycle.cancel(first.orderId, first.w.customer, {})).toEqual({
      ok: true,
      value: { orderId: first.orderId, status: "cancelled" },
    });
    expect(first.w.store.orders[0]?.cancelReason).toBe("Cancelled by the customer");

    const second = await placed();
    await second.w.lifecycle.accept(second.orderId, second.w.owner, { prepMinutes: 10 });
    const late = await second.w.lifecycle.cancel(second.orderId, second.w.customer, {
      reason: "Changed my mind",
    });
    expect(!late.ok && late.error.code).toBe("CONFLICT");
  });

  it("lets the zone's coordinator cancel an accepted order", async () => {
    const { w, orderId } = await placed();
    await w.lifecycle.accept(orderId, w.owner, { prepMinutes: 10 });
    const coordinator = sessionUser("coord-1", [{ role: "coordinator", zoneId: "zone-makati" }]);
    const cancelled = await w.lifecycle.cancel(orderId, coordinator, { reason: "Rider shortage" });
    expect(cancelled.ok).toBe(true);
    expect(w.store.events.at(-1)).toMatchObject({ to: "cancelled", actorRole: "coordinator" });
  });

  it("hides the order from other stores and customers, and refuses guests", async () => {
    const { w, orderId } = await placed();
    const otherOwner = sessionUser("owner-nena", [{ role: "merchant_owner", merchantId: "nena" }]);
    const other = await w.lifecycle.accept(orderId, otherOwner, { prepMinutes: 10 });
    expect(!other.ok && other.error.code).toBe("NOT_FOUND");
    const stranger = sessionUser("customer-2", [{ role: "customer" }], "aal1");
    const cancel = await w.lifecycle.cancel(orderId, stranger, {});
    expect(!cancel.ok && cancel.error.code).toBe("NOT_FOUND");
    const guest = await w.lifecycle.markReady(orderId, null);
    expect(!guest.ok && guest.error.code).toBe("UNAUTHORIZED");
    const missing = await w.lifecycle.accept("order-9", w.owner, { prepMinutes: 10 });
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
  });

  it("forbids changes a person may see but not make", async () => {
    const { w, orderId } = await placed();
    // The customer sees their order but cannot accept it for the store.
    const self = await w.lifecycle.accept(orderId, w.customer, { prepMinutes: 10 });
    expect(!self.ok && self.error.code).toBe("FORBIDDEN");
    // Staff without TOTP see nothing of the store.
    const noTotp = sessionUser("staff-1", [{ role: "merchant_staff", merchantId: "kape" }], "aal1");
    const blocked = await w.lifecycle.accept(orderId, noTotp, { prepMinutes: 10 });
    expect(!blocked.ok && blocked.error.code).toBe("NOT_FOUND");
  });

  it("lets only one of two simultaneous changes win", async () => {
    const { w, orderId } = await placed();
    const staff = sessionUser("staff-1", [{ role: "merchant_staff", merchantId: "kape" }]);
    const [a, b] = await Promise.all([
      w.lifecycle.accept(orderId, w.owner, { prepMinutes: 10 }),
      w.lifecycle.reject(orderId, staff, { reason: "Too busy" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(!loser.ok && loser.error.code).toBe("CONFLICT");
  });

  it("builds the store's board with confirm-by and ready-by times", async () => {
    const { w, orderId } = await placed();
    const placedAt = w.clock.now().getTime();
    let board = await w.lifecycle.board("kape", w.owner);
    expect(board.ok && board.value.new).toMatchObject([
      {
        id: orderId,
        items: [{ name: "Kapeng Barako", quantity: 2, modifiers: ["Less sugar"] }],
        confirmBy: new Date(placedAt + 180_000),
      },
    ]);
    await w.lifecycle.accept(orderId, w.owner, { prepMinutes: 15 });
    board = await w.lifecycle.board("kape", w.owner);
    expect(board.ok && board.value).toMatchObject({
      new: [],
      preparing: [{ id: orderId, readyBy: new Date(placedAt + 15 * 60_000) }],
      ready: [],
      pickedUp: [],
    });
    const forbidden = await w.lifecycle.board("kape", w.customer);
    expect(!forbidden.ok && forbidden.error.code).toBe("FORBIDDEN");
    const guest = await w.lifecycle.board("kape", null);
    expect(!guest.ok && guest.error.code).toBe("UNAUTHORIZED");
  });
});

import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../shared/errors";
import { err, ok } from "../shared/result";
import { PaymentWebhookService } from "./payment-webhook-service";
import type { IPaymentWebhookVerifier, PaymentEvent } from "./ports";
import { sessionUser } from "../testing/session-users";
import { barakoOrder, orderingWorld } from "../testing/ordering-world";

async function onlineOrder() {
  const w = orderingWorld();
  const placed = await w.orders.placeOrder(barakoOrder({ paymentMethod: "gcash" }), {
    idempotencyKey: "online-checkout-0001",
    actor: w.customer,
    urls: w.urls,
  });
  if (!placed.ok) throw placed.error;
  const payment = w.store.payments[0];
  if (!payment) throw new Error("no payment");
  const paid = (eventId = "evt_paid_1", amount = 17900): PaymentEvent => ({
    kind: "payment_paid",
    gateway: "paymongo",
    eventId,
    type: "checkout_session.payment.paid",
    intentId: payment.intentId,
    gatewayPaymentId: "pay_123",
    amountCentavos: amount,
    feeCentavos: 450,
    payload: {},
  });
  return { w, orderId: placed.value.orderId, payment, paid };
}

describe("PaymentEventService", () => {
  it("places the order, records the fee and holds the payment as the customer's deposit", async () => {
    const { w, orderId, paid } = await onlineOrder();
    expect(await w.events.handle(paid())).toEqual({ ok: true, value: "processed" });
    expect(w.store.orders[0]).toMatchObject({ status: "placed", paymentStatus: "paid" });
    expect(w.store.payments[0]).toMatchObject({
      status: "paid",
      gatewayPaymentId: "pay_123",
      feeCentavos: 450,
    });
    expect(w.store.ledger).toEqual([
      {
        orderId,
        lines: [
          expect.objectContaining({ account: "gateway_clearing", debitCentavos: 17450 }),
          expect.objectContaining({ account: "gateway_fees", debitCentavos: 450 }),
          expect.objectContaining({
            account: "customer_deposits",
            partyId: "customer-1",
            creditCentavos: 17900,
          }),
        ],
      },
    ]);
    expect(w.store.ledgerNet(orderId)).toBe(0);
  });

  it("ignores a replayed event and a second event for the same payment", async () => {
    const { w, paid } = await onlineOrder();
    await w.events.handle(paid());
    expect(await w.events.handle(paid())).toEqual({ ok: true, value: "duplicate" });
    expect(await w.events.handle(paid("evt_paid_2"))).toEqual({ ok: true, value: "processed" });
    expect(w.store.ledger).toHaveLength(1);
  });

  it("refunds a payment that arrives after the order timed out", async () => {
    const { w, orderId, paid } = await onlineOrder();
    w.store.cancelUnpaid(orderId);
    await w.events.handle(paid());
    expect(w.store.orders[0]?.status).toBe("cancelled");
    expect(w.online.refunds).toEqual([
      {
        gatewayPaymentId: "pay_123",
        amountCentavos: 17900,
        reason: "Paid after the order was cancelled",
      },
    ]);
    expect(w.store.payments[0]).toMatchObject({ status: "refunded", refundedCentavos: 17900 });
    expect(w.store.refunds[0]).toMatchObject({ requestedBy: null, status: "succeeded" });
    expect(w.store.ledgerNet(orderId)).toBe(0);
    expect(w.webhooks.events.get("paymongo:evt_paid_1")?.error).toBe("late payment refunded");
  });

  it("never places an order for the wrong amount", async () => {
    const { w, paid } = await onlineOrder();
    await w.events.handle(paid("evt_short", 100));
    expect(w.store.orders[0]?.status).toBe("awaiting_payment");
    expect(w.store.ledger).toEqual([]);
    expect(w.webhooks.events.get("paymongo:evt_short")?.error).toBe("amount mismatch");
    expect(w.logger.lines.map((l) => l.message)).toContain("payment_event.amount_mismatch");
  });

  it("notes events for payments it does not know and ignores unhandled types", async () => {
    const { w } = await onlineOrder();
    await w.events.handle({
      kind: "payment_paid",
      gateway: "paymongo",
      eventId: "evt_unknown",
      type: "checkout_session.payment.paid",
      intentId: "cs_someone_else",
      gatewayPaymentId: "pay_x",
      amountCentavos: 100,
      feeCentavos: 0,
      payload: {},
    });
    await w.events.handle({
      kind: "ignored",
      gateway: "paymongo",
      eventId: "evt_other",
      type: "link.payment.paid",
      payload: {},
    });
    expect(w.webhooks.events.get("paymongo:evt_unknown")?.error).toBe("unknown payment");
    expect(w.webhooks.events.get("paymongo:evt_other")).toMatchObject({
      processed: true,
      error: null,
    });
  });

  it("marks a failed payment and keeps the order waiting for its timeout", async () => {
    const { w, payment } = await onlineOrder();
    await w.events.handle({
      kind: "payment_failed",
      gateway: "paymongo",
      eventId: "evt_failed",
      type: "payment.failed",
      intentId: payment.intentId,
      payload: {},
    });
    expect(w.store.orders[0]).toMatchObject({
      status: "awaiting_payment",
      paymentStatus: "failed",
    });
    expect(w.store.payments[0]?.status).toBe("failed");
  });

  it("updates a refund from the gateway's refund event", async () => {
    const { w, orderId, paid } = await onlineOrder();
    await w.events.handle(paid());
    const admin = sessionUser("admin-1", [{ role: "admin" }]);
    await w.refunds.refund({ orderId, amountCentavos: 1000, reason: "Missing item" }, admin);
    await w.events.handle({
      kind: "refund_updated",
      gateway: "paymongo",
      eventId: "evt_refund",
      type: "payment.refund.updated",
      gatewayRef: "fake_ref_1",
      status: "failed",
      payload: {},
    });
    expect(w.store.refunds[0]?.status).toBe("failed");
  });
});

describe("RefundService", () => {
  const admin = sessionUser("admin-1", [{ role: "admin" }]);

  it("refunds part of a paid order from the deposit and keeps the ledger balanced", async () => {
    const { w, orderId, paid } = await onlineOrder();
    await w.events.handle(paid());
    const refunded = await w.refunds.refund(
      { orderId, amountCentavos: 2000, reason: "Missing coffee" },
      admin,
    );
    expect(refunded).toEqual({
      ok: true,
      value: { refundId: "refund-1", amountCentavos: 2000, status: "succeeded" },
    });
    expect(w.store.payments[0]).toMatchObject({
      status: "partially_refunded",
      refundedCentavos: 2000,
    });
    expect(w.store.ledger[1]?.lines).toEqual([
      expect.objectContaining({ account: "customer_deposits", debitCentavos: 2000 }),
      expect.objectContaining({ account: "gateway_clearing", creditCentavos: 2000 }),
    ]);
    expect(w.store.ledgerNet(orderId)).toBe(0);
    expect(await w.store.depositBalance(orderId)).toBe(15900);
  });

  it("never refunds more than is left, across several refunds", async () => {
    const { w, orderId, paid } = await onlineOrder();
    await w.events.handle(paid());
    await w.refunds.refund({ orderId, amountCentavos: 17000, reason: "Most of it" }, admin);
    const tooMuch = await w.refunds.refund(
      { orderId, amountCentavos: 1000, reason: "Again" },
      admin,
    );
    expect(!tooMuch.ok && tooMuch.error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "You can refund up to ₱9.00.",
    });
    const rest = await w.refunds.refund({ orderId, reason: "The rest" }, admin);
    expect(rest.ok && rest.value.amountCentavos).toBe(900);
    expect(w.store.payments[0]?.status).toBe("refunded");
  });

  it("releases the reservation when the gateway refuses", async () => {
    const { w, orderId, paid } = await onlineOrder();
    await w.events.handle(paid());
    w.online.failRefund = true;
    const refused = await w.refunds.refund({ orderId, amountCentavos: 2000, reason: "Try" }, admin);
    expect(!refused.ok && refused.error.code).toBe("UNAVAILABLE");
    expect(w.store.payments[0]).toMatchObject({ status: "paid", refundedCentavos: 0 });
    expect(w.store.refunds[0]?.status).toBe("failed");
    expect(w.store.ledger).toHaveLength(1);
  });

  it("only refunds paid online orders, and only for admins or the zone's coordinator", async () => {
    const { w, orderId, paid } = await onlineOrder();
    const unpaid = await w.refunds.refund({ orderId, reason: "Not yet" }, admin);
    expect(!unpaid.ok && unpaid.error.code).toBe("CONFLICT");
    await w.events.handle(paid());

    const customer = await w.refunds.refund({ orderId, reason: "Mine" }, w.customer);
    expect(!customer.ok && customer.error.code).toBe("FORBIDDEN");
    const otherZone = sessionUser("coord-2", [{ role: "coordinator", zoneId: "zone-other" }]);
    expect((await w.refunds.refund({ orderId, reason: "x" }, otherZone)).ok).toBe(false);
    const coordinator = sessionUser("coord-1", [{ role: "coordinator", zoneId: "zone-makati" }]);
    expect(
      (await w.refunds.refund({ orderId, amountCentavos: 100, reason: "x" }, coordinator)).ok,
    ).toBe(true);

    const missing = await w.refunds.refund({ orderId: "nope", reason: "x" }, admin);
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
  });

  it("leaves cash payments to be refunded by hand", async () => {
    const w = orderingWorld();
    const placed = await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: "cash-checkout-000001",
      actor: w.customer,
      urls: w.urls,
    });
    if (!placed.ok) throw placed.error;
    const cash = w.store.payments[0];
    if (cash) {
      cash.status = "paid";
      cash.gatewayPaymentId = "cod";
    }
    const refused = await w.refunds.refund({ orderId: placed.value.orderId, reason: "x" }, admin);
    expect(!refused.ok && refused.error.message).toBe("Cash payments are refunded by hand.");
  });
});

describe("PaymentWebhookService", () => {
  const signedBy = (secret: string): IPaymentWebhookVerifier => ({
    verify: (rawBody, signature) =>
      signature === secret
        ? ok(JSON.parse(rawBody) as PaymentEvent)
        : err(new UnauthorizedError("Invalid webhook signature.")),
  });

  it("applies a signed event once and refuses unsigned ones without touching the order", async () => {
    const { w, paid } = await onlineOrder();
    const webhooks = new PaymentWebhookService({
      verifier: signedBy("good"),
      events: w.events,
      clock: w.clock,
      logger: w.logger,
    });
    const body = JSON.stringify(paid());
    const refused = await webhooks.receive(body, "bad");
    expect(!refused.ok && refused.error.code).toBe("UNAUTHORIZED");
    expect(w.store.orders[0]?.status).toBe("awaiting_payment");
    expect(await webhooks.receive(body, "good")).toEqual({ ok: true, value: "processed" });
    expect(await webhooks.receive(body, "good")).toEqual({ ok: true, value: "duplicate" });
    expect(w.store.orders[0]?.status).toBe("placed");
  });
});

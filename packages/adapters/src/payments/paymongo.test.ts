import { MemoryLogger } from "@klikgo/core/testing";
import { describe, expect, it, vi } from "vitest";
import { CashOnDeliveryGateway } from "./cash-on-delivery-gateway";
import { PayMongoGateway } from "./paymongo-gateway";
import {
  payMongoModeOf,
  payMongoSignatureHeader,
  PayMongoWebhookVerifier,
  UnconfiguredWebhookVerifier,
} from "./paymongo-webhook-verifier";

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

const request = {
  orderId: "order-1",
  orderCode: "KG-ABC234",
  method: "maya" as const,
  amountCentavos: 17900,
  description: "Klik Go order KG-ABC234",
  successUrl: "https://app.test/orders/order-1?paid=1",
  cancelUrl: "https://app.test/orders/order-1?cancelled=1",
};

describe("PayMongoGateway", () => {
  it("creates a hosted checkout session for the chosen method and the exact order total", async () => {
    const fetcher = vi.fn(() =>
      json(200, {
        data: {
          id: "cs_123",
          type: "checkout_session",
          attributes: { checkout_url: "https://checkout.paymongo.com/cs_123" },
        },
      }),
    );
    const gateway = new PayMongoGateway({
      secretKey: "sk_test_abc",
      logger: new MemoryLogger(),
      fetch: fetcher,
    });
    expect(await gateway.startCheckout(request)).toEqual({
      ok: true,
      value: { intentId: "cs_123", checkoutUrl: "https://checkout.paymongo.com/cs_123" },
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paymongo.com/v2/checkout_sessions");
    expect(new Headers(init.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("sk_test_abc:").toString("base64")}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        attributes: {
          line_items: [
            { name: "Klik Go order KG-ABC234", amount: 17900, currency: "PHP", quantity: 1 },
          ],
          payment_method_types: ["paymaya"],
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          description: "Klik Go order KG-ABC234",
          reference_number: "KG-ABC234",
          metadata: { order_id: "order-1" },
          send_email_receipt: false,
          show_line_items: true,
          show_description: true,
        },
      },
    });
  });

  it("reports PayMongo's refusals and outages without leaking the key", async () => {
    const logger = new MemoryLogger();
    const refused = new PayMongoGateway({
      secretKey: "sk_test_secret",
      logger,
      fetch: () =>
        json(400, {
          errors: [{ code: "parameter_below_minimum", detail: "Amount is too small." }],
        }),
    });
    const result = await refused.startCheckout(request);
    expect(!result.ok && result.error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Amount is too small.",
    });
    const down = new PayMongoGateway({
      secretKey: "sk_test_secret",
      logger,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    expect((await down.startCheckout(request)).ok).toBe(false);
    const fiveHundred = new PayMongoGateway({
      secretKey: "sk_test_secret",
      logger,
      fetch: () => json(503, {}),
    });
    const outage = await fiveHundred.refund({
      gatewayPaymentId: "pay_1",
      amountCentavos: 100,
      reason: "x",
    });
    expect(!outage.ok && outage.error.code).toBe("UNAVAILABLE");
    expect(JSON.stringify(logger.lines)).not.toContain("sk_test_secret");
  });

  it("refunds a payment and reads a session's status", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() =>
        json(200, { data: { id: "ref_9", attributes: { status: "pending" } } }),
      )
      .mockImplementationOnce(() =>
        json(200, {
          data: {
            id: "cs_1",
            attributes: { status: "active", payments: [{ attributes: { status: "paid" } }] },
          },
        }),
      )
      .mockImplementationOnce(() =>
        json(200, { data: { id: "cs_1", attributes: { status: "expired", payments: [] } } }),
      );
    const gateway = new PayMongoGateway({
      secretKey: "sk_test_abc",
      logger: new MemoryLogger(),
      fetch: fetcher,
    });
    expect(
      await gateway.refund({
        gatewayPaymentId: "pay_1",
        amountCentavos: 2000,
        reason: "Missing coffee",
      }),
    ).toEqual({
      ok: true,
      value: { ref: "ref_9", status: "pending" },
    });
    const body = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as unknown;
    expect(body).toEqual({
      data: {
        attributes: {
          amount: 2000,
          payment_id: "pay_1",
          reason: "others",
          notes: "Missing coffee",
        },
      },
    });
    expect(await gateway.status("cs_1")).toEqual({ ok: true, value: "paid" });
    expect(await gateway.status("cs_1")).toEqual({ ok: true, value: "expired" });
  });
});

describe("CashOnDeliveryGateway", () => {
  it("starts nothing online and leaves refunds to people", async () => {
    const cod = new CashOnDeliveryGateway();
    expect(await cod.startCheckout({ ...request, method: "cod" })).toEqual({
      ok: true,
      value: { intentId: "cod_order-1", checkoutUrl: null },
    });
    expect(await cod.status()).toEqual({ ok: true, value: "pending" });
    expect((await cod.refund()).ok).toBe(false);
  });
});

describe("PayMongoWebhookVerifier", () => {
  const secret = "whsk_test_secret";
  const now = new Date("2026-11-06T01:00:00Z");
  const t = Math.floor(now.getTime() / 1000);
  const paidEvent = (livemode = false) =>
    JSON.stringify({
      data: {
        id: "evt_1",
        type: "event",
        attributes: {
          type: "checkout_session.payment.paid",
          livemode,
          data: {
            id: "cs_123",
            type: "checkout_session",
            attributes: {
              payments: [
                {
                  id: "pay_9",
                  type: "payment",
                  attributes: { amount: 17900, fee: 448, net_amount: 17452, status: "paid" },
                },
              ],
            },
          },
        },
      },
    });
  const verifier = new PayMongoWebhookVerifier({ webhookSecret: secret, mode: "test" });

  it("accepts a correctly signed paid event and maps it", () => {
    const body = paidEvent();
    expect(verifier.verify(body, payMongoSignatureHeader(secret, body, t, "test"), now)).toEqual({
      ok: true,
      value: {
        kind: "payment_paid",
        gateway: "paymongo",
        eventId: "evt_1",
        type: "checkout_session.payment.paid",
        intentId: "cs_123",
        gatewayPaymentId: "pay_9",
        amountCentavos: 17900,
        feeCentavos: 448,
        payload: JSON.parse(body) as unknown,
      },
    });
  });

  it.each([
    ["no header", null],
    ["a wrong secret", payMongoSignatureHeader("whsk_other", paidEvent(), t, "test")],
    ["the live signature in test mode", payMongoSignatureHeader(secret, paidEvent(), t, "live")],
    ["an old timestamp (replay)", payMongoSignatureHeader(secret, paidEvent(), t - 600, "test")],
    ["garbage", "t=abc,te=xyz"],
  ])("refuses a request with %s", (_label, header) => {
    const result = verifier.verify(paidEvent(), header, now);
    expect(!result.ok && result.error.code).toBe("UNAUTHORIZED");
  });

  it("refuses a body changed after signing, and a live event at a test endpoint", () => {
    const header = payMongoSignatureHeader(secret, paidEvent(), t, "test");
    expect(verifier.verify(paidEvent().replace("17900", "100"), header, now).ok).toBe(false);
    const live = paidEvent(true);
    expect(verifier.verify(live, payMongoSignatureHeader(secret, live, t, "test"), now).ok).toBe(
      false,
    );
  });

  it("maps refund updates and ignores events Klik Go does not use", () => {
    const sign = (body: string) => payMongoSignatureHeader(secret, body, t, "test");
    const event = (type: string, data: unknown) =>
      JSON.stringify({
        data: { id: `evt_${type}`, type: "event", attributes: { type, livemode: false, data } },
      });
    const refund = event("payment.refund.updated", {
      id: "ref_9",
      attributes: { status: "succeeded" },
    });
    expect(verifier.verify(refund, sign(refund), now)).toMatchObject({
      ok: true,
      value: { kind: "refund_updated", gatewayRef: "ref_9", status: "succeeded" },
    });
    const failed = event("payment.failed", { id: "pay_1", attributes: {} });
    expect(verifier.verify(failed, sign(failed), now)).toMatchObject({
      ok: true,
      value: { kind: "ignored" },
    });
    const notJson = "nope";
    expect(verifier.verify(notJson, sign(notJson), now).ok).toBe(false);
  });

  it("answers 503 while the webhook secret is missing so PayMongo retries later", () => {
    const result = new UnconfiguredWebhookVerifier().verify();
    expect(!result.ok && result.error.code).toBe("UNAVAILABLE");
  });

  it("tells test keys from live keys", () => {
    expect(payMongoModeOf("sk_live_123")).toBe("live");
    expect(payMongoModeOf("sk_test_123")).toBe("test");
    expect(payMongoModeOf(undefined)).toBe("test");
  });
});

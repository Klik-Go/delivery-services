import { MemoryLogger } from "@klikgo/core/testing";
import { describe, expect, it } from "vitest";
import { PayMongoGateway } from "./paymongo-gateway";

/**
 * Against PayMongo's real API in test mode: `pnpm --filter @klikgo/adapters test:paymongo` with
 * PAYMONGO_TEST_SECRET_KEY (sk_test_…) set, or the "PayMongo test mode" GitHub workflow.
 * Skipped otherwise. A live key is refused so this can never create real charges.
 */
const KEY = process.env.PAYMONGO_TEST_SECRET_KEY;
const describeExternal = describe.skipIf(!KEY);

describeExternal("PayMongo in test mode (external)", () => {
  if (KEY && !KEY.startsWith("sk_test_")) {
    throw new Error("PAYMONGO_TEST_SECRET_KEY must be a test key (sk_test_…).");
  }
  const logger = new MemoryLogger();
  const gateway = new PayMongoGateway({ secretKey: KEY ?? "", logger, timeoutMs: 20_000 });
  const orderId = crypto.randomUUID();

  it("opens a hosted GCash checkout for the exact order total and reads it back as pending", async () => {
    const started = await gateway.startCheckout({
      orderId,
      orderCode: "KG-TEST01",
      method: "gcash",
      amountCentavos: 17900,
      description: "Klik Go test order KG-TEST01",
      successUrl: `https://klikgo.example/orders/${orderId}?paid=1`,
      cancelUrl: `https://klikgo.example/orders/${orderId}?cancelled=1`,
    });
    expect(started.ok, JSON.stringify(logger.lines)).toBe(true);
    if (!started.ok) return;
    expect(started.value.intentId).toMatch(/^cs_/);
    expect(new URL(started.value.checkoutUrl ?? "").hostname).toBe("checkout.paymongo.com");

    const page = await fetch(started.value.checkoutUrl ?? "");
    expect(page.status).toBe(200);
    expect(await gateway.status(started.value.intentId)).toEqual({ ok: true, value: "pending" });
  });

  it("refuses to refund a payment that does not exist, without leaking the key", async () => {
    const refused = await gateway.refund({
      gatewayPaymentId: "pay_doesnotexist000000000",
      amountCentavos: 100,
      reason: "external test",
    });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(logger.lines)).not.toContain(KEY ?? "never");
  });
});

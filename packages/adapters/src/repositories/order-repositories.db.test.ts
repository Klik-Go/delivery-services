import { randomUUID } from "node:crypto";
import { LedgerService, type NewOrder } from "@klikgo/core";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPromoRepository, PrismaWebhookEventStore } from "./prisma-checkout-support";
import { PrismaOrderRepository } from "./prisma-order-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const CARMEN = "5eed0000-0000-4000-8000-0000000000e1";
const KAPE = "5eed0000-0000-4000-8000-000000000102";

/** Orders, payments, refunds and webhook events against the seeded local database. */
describeDb("order and payment repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const orders = new PrismaOrderRepository(prisma);
  const ledger = new LedgerService();
  const created: string[] = [];

  afterAll(async () => {
    // Ledger rows and order events are append-only by design; these orders stay as test data in
    // the local database (a `pnpm db:reset` clears them), so only throwaway webhook rows go.
    await prisma.webhook_events.deleteMany({ where: { event_id: { startsWith: "evt_repo_" } } });
    await prisma.$disconnect();
  });

  async function newOrder(
    overrides: Partial<NewOrder> = {},
  ): Promise<{ id: string; code: string }> {
    const zone = await prisma.merchants.findUniqueOrThrow({
      where: { id: KAPE },
      select: { zone_id: true },
    });
    const order = await orders.create({
      customerId: CARMEN,
      merchantId: KAPE,
      zoneId: zone.zone_id,
      status: "awaiting_payment",
      paymentMethod: "gcash",
      subtotalCentavos: 12000,
      deliveryFeeCentavos: 3900,
      serviceFeeCentavos: 0,
      smallOrderFeeCentavos: 2000,
      discountCentavos: 0,
      tipCentavos: 0,
      totalCentavos: 17900,
      address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "+639170000031" },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      scheduledFor: null,
      prepMinutes: 15,
      idempotencyKey: `repo-test-${randomUUID()}`,
      requestHash: "b".repeat(64),
      lines: [
        {
          menuItemId: (
            await prisma.menu_items.findFirstOrThrow({
              where: { merchant_id: KAPE, name: "Kapeng Barako" },
            })
          ).id,
          name: "Kapeng Barako",
          basePriceCentavos: 6000,
          modifiersUnitCentavos: 0,
          quantity: 2,
          modifiers: [{ id: "o-less", name: "Less sugar" }],
          lineTotalCentavos: 12000,
        },
      ],
      promo: null,
      ...overrides,
    });
    if (order) created.push(order.id);
    return order ?? { id: "", code: "" };
  }

  it("creates the order with its lines, a KG- code and a first history row by the customer", async () => {
    const order = await newOrder();
    expect(order.code).toMatch(/^KG-[A-Z2-9]{6}$/);
    const items = await prisma.order_items.findMany({ where: { order_id: order.id } });
    expect(items).toMatchObject([
      { name_snapshot: "Kapeng Barako", quantity: 2, line_total_centavos: 12000 },
    ]);
    const events = await prisma.order_events.findMany({ where: { order_id: order.id } });
    expect(events).toMatchObject([
      {
        from_status: null,
        to_status: "awaiting_payment",
        actor_id: CARMEN,
        actor_role: "customer",
      },
    ]);
    const row = await prisma.orders.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.address_snapshot).toMatchObject({
      landmark: "Blue tower lobby",
      contact_phone: "+639170000031",
    });
  });

  it("answers null instead of a second order for the same customer and Idempotency-Key", async () => {
    const key = `repo-dup-${randomUUID()}`;
    await newOrder({ idempotencyKey: key });
    const zone = await prisma.orders.findFirstOrThrow({ where: { idempotency_key: key } });
    const again = await orders.create({
      customerId: CARMEN,
      merchantId: KAPE,
      zoneId: zone.zone_id,
      status: "placed",
      paymentMethod: "cod",
      subtotalCentavos: 100,
      deliveryFeeCentavos: 0,
      serviceFeeCentavos: 0,
      smallOrderFeeCentavos: 0,
      discountCentavos: 0,
      tipCentavos: 0,
      totalCentavos: 100,
      address: { label: "Home", landmark: "Gate", contactPhone: "+639170000031" },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      scheduledFor: null,
      prepMinutes: 15,
      idempotencyKey: key,
      requestHash: "c".repeat(64),
      lines: [],
      promo: null,
    });
    expect(again).toBeNull();
    expect((await orders.findByIdempotencyKey(CARMEN, key))?.requestHash).toBe("b".repeat(64));
  });

  it("captures a payment once: places the order as the system and posts a balanced deposit", async () => {
    const order = await newOrder();
    await orders.attachPayment(order.id, {
      gateway: "paymongo",
      intentId: `cs_repo_${order.id}`,
      method: "gcash",
      amountCentavos: 17900,
      checkoutUrl: "https://checkout.paymongo.test/x",
    });
    const found = await orders.findByIntent("paymongo", `cs_repo_${order.id}`);
    expect(found?.order).toMatchObject({ id: order.id, status: "awaiting_payment" });
    const capture = {
      paymentId: found?.payment.id ?? "",
      orderId: order.id,
      gatewayPaymentId: "pay_repo",
      feeCentavos: 450,
      paidAt: new Date(),
      ledger: ledger.capture({
        orderId: order.id,
        customerId: CARMEN,
        amountCentavos: 17900,
        feeCentavos: 450,
      }),
    };
    expect(await orders.recordCapture(capture)).toEqual({
      alreadyPaid: false,
      orderStatus: "placed",
    });
    expect(await orders.recordCapture(capture)).toEqual({
      alreadyPaid: true,
      orderStatus: "placed",
    });
    const events = await prisma.order_events.findMany({
      where: { order_id: order.id },
      orderBy: { id: "asc" },
    });
    expect(events.at(-1)).toMatchObject({
      to_status: "placed",
      actor_id: null,
      meta: { by: "system", reason: "payment_confirmed" },
    });
    expect(await orders.depositBalance(order.id)).toBe(17900);
    const entries = await prisma.ledger_entries.findMany({ where: { order_id: order.id } });
    expect(entries.reduce((sum, e) => sum + e.debit_centavos - e.credit_centavos, 0)).toBe(0);
    expect(entries).toHaveLength(3);
  });

  it("keeps a timed-out order cancelled when its payment arrives late", async () => {
    const order = await newOrder();
    await orders.attachPayment(order.id, {
      gateway: "paymongo",
      intentId: `cs_late_${order.id}`,
      method: "gcash",
      amountCentavos: 17900,
      checkoutUrl: null,
    });
    await prisma.$executeRaw`update public.orders set created_at = now() - interval '20 minutes' where id = ${order.id}::uuid`;
    await prisma.$queryRaw`select private.cancel_unpaid_orders()`;
    const found = await orders.findByIntent("paymongo", `cs_late_${order.id}`);
    expect(found?.payment.status).toBe("failed");
    const result = await orders.recordCapture({
      paymentId: found?.payment.id ?? "",
      orderId: order.id,
      gatewayPaymentId: "pay_late",
      feeCentavos: 450,
      paidAt: new Date(),
      ledger: ledger.capture({
        orderId: order.id,
        customerId: CARMEN,
        amountCentavos: 17900,
        feeCentavos: 450,
      }),
    });
    expect(result).toEqual({ alreadyPaid: false, orderStatus: "cancelled" });
  });

  it("reserves, completes and fails refunds without ever passing the amount paid", async () => {
    const order = await newOrder();
    await orders.attachPayment(order.id, {
      gateway: "paymongo",
      intentId: `cs_refund_${order.id}`,
      method: "gcash",
      amountCentavos: 17900,
      checkoutUrl: null,
    });
    const found = await orders.findByIntent("paymongo", `cs_refund_${order.id}`);
    const paymentId = found?.payment.id ?? "";
    await orders.recordCapture({
      paymentId,
      orderId: order.id,
      gatewayPaymentId: "pay_refund",
      feeCentavos: 450,
      paidAt: new Date(),
      ledger: ledger.capture({
        orderId: order.id,
        customerId: CARMEN,
        amountCentavos: 17900,
        feeCentavos: 450,
      }),
    });
    const first = await orders.reserveRefund({
      paymentId,
      orderId: order.id,
      amountCentavos: 2000,
      reason: "Missing coffee",
      requestedBy: null,
    });
    expect(first).not.toBeNull();
    expect(
      await orders.reserveRefund({
        paymentId,
        orderId: order.id,
        amountCentavos: 16000,
        reason: "Too much",
        requestedBy: null,
      }),
    ).toBeNull();
    await orders.completeRefund({
      refundId: first?.refundId ?? "",
      paymentId,
      gatewayRef: `ref_${order.id}`,
      status: "pending",
      ledger: ledger.refund({
        orderId: order.id,
        customerId: CARMEN,
        amountCentavos: 2000,
        fromDeposit: true,
      }),
    });
    expect(await orders.updateRefundStatus(`ref_${order.id}`, "succeeded")).toBe(true);
    expect(await orders.updateRefundStatus("ref_unknown", "succeeded")).toBe(false);
    expect((await orders.findById(order.id))?.payment).toMatchObject({
      status: "partially_refunded",
      refundedCentavos: 2000,
    });
    expect(await orders.depositBalance(order.id)).toBe(15900);

    const second = await orders.reserveRefund({
      paymentId,
      orderId: order.id,
      amountCentavos: 1000,
      reason: "Retry",
      requestedBy: null,
    });
    await orders.failRefund({ refundId: second?.refundId ?? "", paymentId, amountCentavos: 1000 });
    expect((await orders.findById(order.id))?.payment?.refundedCentavos).toBe(2000);
  });

  it("stores each webhook event once and reports whether it was processed", async () => {
    const events = new PrismaWebhookEventStore(prisma);
    const id = `evt_repo_${randomUUID()}`;
    expect(await events.record("paymongo", id, "checkout_session.payment.paid", { a: 1 })).toBe(
      "new",
    );
    expect(await events.record("paymongo", id, "checkout_session.payment.paid", { a: 1 })).toBe(
      "pending",
    );
    await events.markProcessed("paymongo", id, null);
    expect(await events.record("paymongo", id, "checkout_session.payment.paid", { a: 1 })).toBe(
      "processed",
    );
  });

  it("reads a promo with its redemption counts for one customer", async () => {
    const promos = new PrismaPromoRepository(prisma);
    expect(await promos.findByCode("KAINTAYO", CARMEN)).toMatchObject({
      code: "KAINTAYO",
      type: "fixed_off",
      discountCentavos: 5000,
      minSubtotalCentavos: 30000,
      fundedBy: "platform",
      isActive: true,
      redemptionsByUser: 0,
    });
    expect(await promos.findByCode("NOPE1234", CARMEN)).toBeNull();
  });
});

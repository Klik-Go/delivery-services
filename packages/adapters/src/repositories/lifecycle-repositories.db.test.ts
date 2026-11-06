import { randomUUID } from "node:crypto";
import type { NewOrder } from "@klikgo/core";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaNotificationLog,
  PrismaPushSubscriptions,
  PrismaRecipientDirectory,
} from "./prisma-notifications";
import { PrismaOrderRepository } from "./prisma-order-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const CARMEN = "5eed0000-0000-4000-8000-0000000000e1";
const KAPE = "5eed0000-0000-4000-8000-000000000102";
const KAPE_OWNER = "5eed0000-0000-4000-8000-0000000000b2";

/** Order lifecycle, the notification queue and push subscriptions against the seeded database. */
describeDb("lifecycle and notification repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const orders = new PrismaOrderRepository(prisma);
  const log = new PrismaNotificationLog(prisma);
  const directory = new PrismaRecipientDirectory(prisma);
  const push = new PrismaPushSubscriptions(prisma);

  afterAll(async () => {
    await prisma.device_push_subscriptions.deleteMany({
      where: { endpoint: { startsWith: "https://push.example.test/repo-" } },
    });
    await prisma.$disconnect();
  });

  async function codOrder(): Promise<string> {
    const zone = await prisma.merchants.findUniqueOrThrow({
      where: { id: KAPE },
      select: { zone_id: true },
    });
    const item = await prisma.menu_items.findFirstOrThrow({
      where: { merchant_id: KAPE, name: "Kapeng Barako" },
    });
    const order: NewOrder = {
      customerId: CARMEN,
      merchantId: KAPE,
      zoneId: zone.zone_id,
      status: "placed",
      paymentMethod: "cod",
      subtotalCentavos: 12000,
      deliveryFeeCentavos: 3900,
      serviceFeeCentavos: 0,
      smallOrderFeeCentavos: 2000,
      discountCentavos: 0,
      tipCentavos: 0,
      totalCentavos: 17900,
      address: {
        label: "Office",
        landmark: "Blue tower lobby",
        contactPhone: "+639170000031",
        notes: "Ring twice",
      },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      scheduledFor: null,
      prepMinutes: 15,
      idempotencyKey: `repo-life-${randomUUID()}`,
      requestHash: "d".repeat(64),
      lines: [
        {
          menuItemId: item.id,
          name: "Kapeng Barako",
          basePriceCentavos: 6000,
          modifiersUnitCentavos: 0,
          quantity: 2,
          modifiers: [{ id: "o-less", name: "Less sugar" }],
          lineTotalCentavos: 12000,
        },
      ],
      promo: null,
    };
    const created = await orders.create(order);
    if (!created) throw new Error("order not created");
    return created.id;
  }

  it("accepts in one transaction (accepted then preparing) with the actor on both history rows", async () => {
    const id = await codOrder();
    expect(
      await orders.changeStatus({
        orderId: id,
        from: "placed",
        steps: ["accepted", "preparing"],
        actor: { id: KAPE_OWNER, role: "merchant_owner" },
        meta: { prepMinutes: 25 },
        prepMinutes: 25,
      }),
    ).toBe(true);
    const record = await orders.findById(id);
    expect(record).toMatchObject({
      status: "preparing",
      prepMinutes: 25,
      merchantName: "Kape't Tinapay",
    });
    expect(record?.timeline.acceptedAt).toBeInstanceOf(Date);
    expect(record?.timeline.preparingAt).toBeInstanceOf(Date);
    const events = await prisma.order_events.findMany({
      where: { order_id: id },
      orderBy: { id: "asc" },
    });
    expect(events.slice(1)).toMatchObject([
      {
        from_status: "placed",
        to_status: "accepted",
        actor_id: KAPE_OWNER,
        actor_role: "merchant_owner",
        meta: { prepMinutes: 25 },
      },
      {
        from_status: "accepted",
        to_status: "preparing",
        actor_id: KAPE_OWNER,
        actor_role: "merchant_owner",
      },
    ]);
  });

  it("refuses a change from a status the order has already left", async () => {
    const id = await codOrder();
    const accept = {
      orderId: id,
      from: "placed" as const,
      steps: ["accepted", "preparing"] as const,
      actor: { id: KAPE_OWNER, role: "merchant_owner" as const },
      meta: {},
      prepMinutes: 10,
    };
    const [a, b] = await Promise.all([orders.changeStatus(accept), orders.changeStatus(accept)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await orders.findById(id))?.status).toBe("preparing");
  });

  it("records a rejection and a customer cancellation with their reasons", async () => {
    const rejected = await codOrder();
    await orders.changeStatus({
      orderId: rejected,
      from: "placed",
      steps: ["rejected"],
      actor: { id: KAPE_OWNER, role: "merchant_owner" },
      meta: { reason: "Out of beans" },
      rejectReason: "Out of beans",
      releasePromo: true,
    });
    expect(await orders.findById(rejected)).toMatchObject({
      status: "rejected",
      rejectReason: "Out of beans",
    });
    const cancelled = await codOrder();
    await orders.changeStatus({
      orderId: cancelled,
      from: "placed",
      steps: ["cancelled"],
      actor: { id: CARMEN, role: "customer" },
      meta: {},
      cancelReason: "Cancelled by the customer",
    });
    const row = await prisma.orders.findUniqueOrThrow({ where: { id: cancelled } });
    expect(row).toMatchObject({
      status: "cancelled",
      cancelled_by: CARMEN,
      cancelled_by_role: "customer",
    });
  });

  it("lists the store's live orders with items and notes, oldest first", async () => {
    const id = await codOrder();
    const board = await orders.board(KAPE);
    expect(board.find((o) => o.id === id)).toMatchObject({
      status: "placed",
      notes: "Ring twice",
      items: [{ name: "Kapeng Barako", quantity: 2, modifiers: ["Less sugar"] }],
      prepMinutes: null,
    });
    const placedTimes = board.map((o) => o.placedAt.getTime());
    expect(placedTimes).toEqual([...placedTimes].sort((x, y) => x - y));
  });

  it("finds paid orders that ended early and still need their refund", async () => {
    const id = await codOrder();
    await orders.attachPayment(id, {
      gateway: "paymongo",
      intentId: `cs_due_${id}`,
      method: "gcash",
      amountCentavos: 17900,
      checkoutUrl: null,
    });
    await prisma.payments.updateMany({
      where: { order_id: id },
      data: { status: "paid", paid_at: new Date() },
    });
    await orders.changeStatus({
      orderId: id,
      from: "placed",
      steps: ["rejected"],
      actor: { id: KAPE_OWNER, role: "merchant_owner" },
      meta: {},
      rejectReason: "Closing early",
    });
    expect(await orders.refundsDue(500)).toContainEqual({ orderId: id, reason: "Closing early" });
  });

  it("claims queued messages once and records how sending went", async () => {
    const id = await codOrder();
    await prisma.notifications.create({
      data: {
        user_id: KAPE_OWNER,
        channel: "sms",
        template: "merchant_order_waiting",
        payload: { code: "KG-TEST01", minutes: 2, nested: { no: 1 } },
        order_id: id,
      },
    });
    await prisma.notifications.create({
      data: { user_id: KAPE_OWNER, channel: "in_app", template: "not_a_template", order_id: id },
    });
    const [first, second] = await Promise.all([log.claimQueued(100), log.claimQueued(100)]);
    const mine = [...first, ...second].filter((n) => n.orderId === id);
    expect(mine).toEqual([
      expect.objectContaining({
        channel: "sms",
        template: "merchant_order_waiting",
        params: { code: "KG-TEST01", minutes: 2 },
      }),
    ]);
    const unknown = await prisma.notifications.findFirstOrThrow({
      where: { order_id: id, template: "not_a_template" },
    });
    expect(unknown).toMatchObject({ status: "failed", error: "unknown template" });
    await log.finish(mine[0]?.id ?? "", { ok: true });
    const startedId = await log.start(
      { userId: CARMEN, template: "order_ready", orderId: id, params: { code: "KG-TEST01" } },
      "in_app",
    );
    await log.finish(startedId, { ok: false, error: "UNAVAILABLE" });
    const rows = await prisma.notifications.findMany({
      where: { order_id: id },
      orderBy: { created_at: "asc" },
    });
    expect(rows.map((r) => [r.template, r.status])).toEqual([
      ["merchant_order_waiting", "sent"],
      ["not_a_template", "failed"],
      ["order_ready", "failed"],
    ]);
  });

  it("finds the store's team and texts the store's phone for its orders", async () => {
    expect(await directory.merchantTeam(KAPE)).toContain(KAPE_OWNER);
    const id = await codOrder();
    const before = await prisma.merchants.findUniqueOrThrow({
      where: { id: KAPE },
      select: { phone: true },
    });
    await prisma.merchants.update({ where: { id: KAPE }, data: { phone: "+639170000555" } });
    try {
      expect(await directory.smsNumberFor(KAPE_OWNER, id)).toBe("+639170000555");
      const customerPhone = (
        await prisma.profiles.findUniqueOrThrow({ where: { id: CARMEN }, select: { phone: true } })
      ).phone;
      expect(await directory.smsNumberFor(CARMEN, id)).toBe(customerPhone);
    } finally {
      await prisma.merchants.update({ where: { id: KAPE }, data: { phone: before.phone } });
    }
  });

  it("keeps one subscription per browser, owned by whoever subscribed last", async () => {
    const endpoint = `https://push.example.test/repo-${randomUUID()}`;
    const sub = { endpoint, keys: { p256dh: "p".repeat(80), auth: "a".repeat(22) } };
    await push.save(CARMEN, sub, "Pixel 7");
    expect(await push.forUser(CARMEN)).toContainEqual(sub);
    await push.save(KAPE_OWNER, sub, null);
    expect(await push.forUser(CARMEN)).not.toContainEqual(sub);
    await push.remove(endpoint, CARMEN);
    expect(await push.forUser(KAPE_OWNER)).toContainEqual(sub);
    await push.remove(endpoint, null);
    expect(await push.forUser(KAPE_OWNER)).not.toContainEqual(sub);
  });
});

import { randomUUID } from "node:crypto";
import { LedgerService } from "@klikgo/core";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaDispatchRepository } from "./prisma-dispatch-repository";
import { PrismaOrderRepository } from "./prisma-order-repository";
import { PrismaPabiliRepository, PrismaPabiliSettings } from "./prisma-pabili-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const CARMEN = "5eed0000-0000-4000-8000-0000000000e1";
const RICO = "5eed0000-0000-4000-8000-000000000201";
const RICO_USER = "5eed0000-0000-4000-8000-0000000000d1";
const ROSA = "5eed0000-0000-4000-8000-000000000202";
const SHOP = { lat: 14.5588, lng: 121.0205 };
const DROP = { lat: 14.5547, lng: 121.0244 };

/** Pabili orders, the rider's shopping steps and the pickup view, against the seeded database. */
describeDb("pabili repository (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const repo = new PrismaPabiliRepository(prisma);
  const dispatch = new PrismaDispatchRepository(prisma);
  const orders = new PrismaOrderRepository(prisma);
  const created: string[] = [];

  afterAll(async () => {
    // Leave no rider holding a job, and no float, for the other suites.
    await prisma.orders.updateMany({
      where: { id: { in: created }, status: { notIn: ["delivered"] } },
      data: { rider_id: null },
    });
    await prisma.riders.updateMany({
      where: { id: { in: [RICO, ROSA] } },
      data: { pabili_float_centavos: 0 },
    });
    await prisma.$disconnect();
  });

  async function zone(): Promise<string> {
    const [row] = await prisma.$queryRaw<{ id: string }[]>`
      select id from public.zone_for_point(
        extensions.st_setsrid(extensions.st_makepoint(${DROP.lng}, ${DROP.lat}), 4326)::extensions.geography)`;
    if (!row) throw new Error("No seeded zone at the drop-off");
    return row.id;
  }

  async function place(budgetCentavos = 50_000): Promise<{ id: string; code: string }> {
    const result = await repo.create({
      customerId: CARMEN,
      zoneId: await zone(),
      storeName: "Aling Nena Sari-sari",
      storeNotes: "Beside the chapel",
      pickup: SHOP,
      dropoff: DROP,
      address: { label: "Home", landmark: "Blue gate", contactPhone: "+639170000031" },
      budgetCentavos,
      deliveryFeeCentavos: 3_900,
      serviceFeeCentavos: 4_900,
      totalCentavos: 8_800,
      lines: [
        { position: 1, description: "Eggs (medium)", quantity: 12, note: null },
        { position: 2, description: "Pandesal", quantity: 10, note: "Fresh if possible" },
      ],
      idempotencyKey: `repo-pabili-${randomUUID()}`,
      requestHash: "a".repeat(64),
    });
    if (result.kind !== "created") throw new Error("not created");
    created.push(result.id);
    return result;
  }

  it("stores the order with no store, taken by Klik Go in the same transaction, and reads it back", async () => {
    const { id, code } = await place();
    const found = await repo.find(id);
    expect(found).toMatchObject({
      orderId: id,
      code,
      customerId: CARMEN,
      status: "accepted",
      storeName: "Aling Nena Sari-sari",
      storeNotes: "Beside the chapel",
      budgetCentavos: 50_000,
      totalCentavos: 8_800,
      itemCostCentavos: null,
      receiptPath: null,
    });
    expect(found?.pickup.lat).toBeCloseTo(SHOP.lat, 5);
    expect(found?.lines.map((l) => [l.position, l.description, l.status])).toEqual([
      [1, "Eggs (medium)", "pending"],
      [2, "Pandesal", "pending"],
    ]);
    const events = await prisma.order_events.findMany({
      where: { order_id: id },
      orderBy: { id: "asc" },
      select: { to_status: true, actor_role: true, actor_id: true },
    });
    expect(events).toEqual([
      { to_status: "placed", actor_role: "customer", actor_id: CARMEN },
      { to_status: "accepted", actor_role: null, actor_id: null },
    ]);
    // The order record names the shop, with no store.
    const record = await orders.findById(id);
    expect(record).toMatchObject({
      kind: "pabili",
      merchantId: null,
      merchantName: "Aling Nena Sari-sari",
    });
  });

  it("finds a retry by its Idempotency-Key and refuses a second order with the same key", async () => {
    const key = `repo-pabili-${randomUUID()}`;
    const input = {
      customerId: CARMEN,
      zoneId: await zone(),
      storeName: "Palengke",
      storeNotes: null,
      pickup: SHOP,
      dropoff: DROP,
      address: { label: "Home", landmark: "Blue gate", contactPhone: "+639170000031" },
      budgetCentavos: 10_000,
      deliveryFeeCentavos: 3_900,
      serviceFeeCentavos: 4_900,
      totalCentavos: 8_800,
      lines: [{ position: 1, description: "Kangkong", quantity: 2, note: null }],
      idempotencyKey: key,
      requestHash: "b".repeat(64),
    };
    const first = await repo.create(input);
    if (first.kind === "created") created.push(first.id);
    expect(await repo.create(input)).toEqual({ kind: "duplicate" });
    expect((await repo.findByIdempotencyKey(CARMEN, key))?.storeName).toBe("Palengke");
    expect(await repo.findByIdempotencyKey(CARMEN, "repo-pabili-nothing-here")).toBeNull();
  });

  it("dispatch sees the kind, budget and floats; the rider shops and records the receipt; delivery settles the fees", async () => {
    const { id } = await place(40_000);
    await repo.setFloat(RICO, 60_000);
    const job = await dispatch.job(id);
    expect(job).toMatchObject({
      kind: "pabili",
      budgetCentavos: 40_000,
      merchantName: "Aling Nena Sari-sari",
    });
    expect(job?.pickup.lat).toBeCloseTo(SHOP.lat, 5);
    const rico = await dispatch.riderForUser(RICO_USER);
    expect(rico?.pabiliFloatCentavos).toBe(60_000);

    // Assign Rico through an accepted offer.
    const offerId = await dispatch.createOffer({
      orderId: id,
      riderId: RICO,
      earningsCentavos: 3_500,
      expiresAt: new Date(Date.now() + 30_000),
    });
    expect(offerId).not.toBeNull();
    const offer = await dispatch.currentOffer(RICO, new Date());
    expect(offer).toMatchObject({
      kind: "pabili",
      budgetCentavos: 40_000,
      cashToCollectCentavos: 48_800,
    });
    expect(
      await dispatch.respond({
        offerId: offerId ?? "",
        riderId: RICO,
        answer: "accepted",
        now: new Date(),
      }),
    ).toEqual({
      orderId: id,
    });

    const now = new Date();
    expect(
      await repo.startShopping({ orderId: id, riderId: ROSA, riderUserId: RICO_USER, now }),
    ).toBe(false);
    expect(
      await repo.startShopping({ orderId: id, riderId: RICO, riderUserId: RICO_USER, now }),
    ).toBe(true);
    expect(
      await repo.startShopping({ orderId: id, riderId: RICO, riderUserId: RICO_USER, now }),
    ).toBe(false);

    // The database refuses a cost above the budget, and the whole step rolls back.
    await expect(
      repo.recordPurchase({
        orderId: id,
        riderId: RICO,
        riderUserId: RICO_USER,
        itemCostCentavos: 40_001,
        receiptPath: `${id}/receipt.jpg`,
        lines: [{ position: 1, status: "bought" }],
        now,
      }),
    ).rejects.toThrow(/pabili_requests_within_budget/);
    expect((await repo.find(id))?.status).toBe("preparing");

    expect(
      await repo.recordPurchase({
        orderId: id,
        riderId: RICO,
        riderUserId: RICO_USER,
        itemCostCentavos: 31_250,
        receiptPath: `${id}/receipt.jpg`,
        lines: [
          { position: 1, status: "bought" },
          { position: 2, status: "unavailable" },
        ],
        now,
      }),
    ).toBe(true);
    const bought = await repo.find(id);
    expect(bought).toMatchObject({
      status: "ready",
      itemCostCentavos: 31_250,
      receiptPath: `${id}/receipt.jpg`,
    });
    expect(bought?.lines.map((l) => l.status)).toEqual(["bought", "unavailable"]);

    const active = await dispatch.activeJob(RICO);
    expect(active).toMatchObject({ kind: "pabili", store: { name: "Aling Nena Sari-sari" } });
    expect(active?.pabili).toMatchObject({ budgetCentavos: 40_000, itemCostCentavos: 31_250 });
    expect(active?.pabili?.list).toHaveLength(2);

    const facts = await dispatch.settlementFacts(id);
    expect(facts).toMatchObject({ merchantId: null, subtotalCentavos: 0, commissionBps: 0 });
    expect(await dispatch.pickUp(id, RICO, RICO_USER)).toBe(true);
    const ledger = new LedgerService().settlement({
      orderId: id,
      customerId: CARMEN,
      merchantId: null,
      riderId: RICO,
      paidOnline: false,
      subtotalCentavos: 0,
      deliveryFeeCentavos: 3_900,
      serviceFeeCentavos: 4_900,
      smallOrderFeeCentavos: 0,
      tipCentavos: 0,
      discountCentavos: 0,
      discountFundedBy: "platform",
      commissionCentavos: 0,
      riderPayCentavos: 3_500,
    });
    expect(
      await dispatch.deliver({
        orderId: id,
        riderId: RICO,
        riderUserId: RICO_USER,
        proofPath: null,
        ledger,
      }),
    ).toBe(true);
    const events = await prisma.order_events.findMany({
      where: { order_id: id },
      orderBy: { id: "asc" },
      select: { to_status: true, actor_role: true },
    });
    expect(events.map((e) => `${e.to_status}:${e.actor_role ?? "system"}`)).toEqual([
      "placed:customer",
      "accepted:system",
      "preparing:rider",
      "ready:rider",
      "picked_up:rider",
      "delivered:rider",
    ]);
  });

  it("reads the pabili switch with defaults for anything left out", async () => {
    const before = await prisma.feature_flags.findUniqueOrThrow({ where: { key: "pabili" } });
    try {
      await prisma.feature_flags.update({
        where: { key: "pabili" },
        data: { enabled: true, rollout: { max_item_centavos: 80_000 } },
      });
      const settings = new PrismaPabiliSettings(prisma, 0);
      expect(await settings.current()).toEqual({
        enabled: true,
        maxItemCentavos: 80_000,
        serviceFeeCentavos: 4_900,
        maxItems: 20,
        maxTripM: 5_000,
      });
      settings.forget();
      await prisma.feature_flags.update({
        where: { key: "pabili" },
        data: { rollout: { max_items: "lots" } },
      });
      expect((await settings.current()).maxItems).toBe(20);
      expect((await new PrismaPabiliSettings(prisma).current()).enabled).toBe(true);
    } finally {
      await prisma.feature_flags.update({
        where: { key: "pabili" },
        data: { enabled: before.enabled, rollout: before.rollout ?? {} },
      });
    }
  });

  it("prices a zone from its rules and refuses an inactive or unknown zone", async () => {
    const fees = await repo.zoneFees(await zone());
    expect(fees?.rules.length).toBeGreaterThan(0);
    expect(await repo.zoneFees(randomUUID())).toBeNull();
  });
});

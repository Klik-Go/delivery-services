import { randomUUID } from "node:crypto";
import { LedgerService, type NewOrder } from "@klikgo/core";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaDispatchRepository } from "./prisma-dispatch-repository";
import { PrismaOrderRepository } from "./prisma-order-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const CARMEN = "5eed0000-0000-4000-8000-0000000000e1";
const KAPE = "5eed0000-0000-4000-8000-000000000102";
const KAPE_OWNER = "5eed0000-0000-4000-8000-0000000000b2";
const COORDINATOR = "5eed0000-0000-4000-8000-0000000000c1";
const RICO = "5eed0000-0000-4000-8000-000000000201";
const RICO_USER = "5eed0000-0000-4000-8000-0000000000d1";
const ROSA = "5eed0000-0000-4000-8000-000000000202";
const ROSA_USER = "5eed0000-0000-4000-8000-0000000000d2";
const OWNER = { id: KAPE_OWNER, role: "merchant_owner" as const };

/** Dispatch, the rider's job and tracking against the seeded database (Rosa is nearest the store). */
describeDb("dispatch repository (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const orders = new PrismaOrderRepository(prisma);
  const repo = new PrismaDispatchRepository(prisma);
  const created: string[] = [];

  /** Riders free, online and freshly located, with no open offers left by other suites. */
  async function freshRiders(): Promise<void> {
    await prisma.dispatch_offers.updateMany({
      where: { rider_id: { in: [ROSA, RICO] }, status: "offered" },
      data: { status: "expired" },
    });
    await prisma.riders.updateMany({
      where: { id: { in: [ROSA, RICO] } },
      data: { is_online: true },
    });
    const now = new Date();
    await repo.saveLocation(ROSA, { lat: 14.559, lng: 121.022 }, now, 0);
    await repo.saveLocation(RICO, { lat: 14.564, lng: 121.028 }, now, 0);
  }

  async function preparingOrder(totalCentavos = 17900): Promise<string> {
    const merchant = await prisma.merchants.findUniqueOrThrow({
      where: { id: KAPE },
      select: { zone_id: true },
    });
    const item = await prisma.menu_items.findFirstOrThrow({
      where: { merchant_id: KAPE, name: "Kapeng Barako" },
    });
    const order: NewOrder = {
      customerId: CARMEN,
      merchantId: KAPE,
      zoneId: merchant.zone_id,
      status: "placed",
      paymentMethod: "cod",
      subtotalCentavos: totalCentavos - 5900,
      deliveryFeeCentavos: 3900,
      serviceFeeCentavos: 0,
      smallOrderFeeCentavos: 0,
      discountCentavos: 0,
      tipCentavos: 2000,
      totalCentavos,
      address: {
        label: "Office",
        landmark: "Blue tower lobby",
        barangay: "Bel-Air",
        contactPhone: "+639170000031",
        notes: "Ring twice",
      },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      scheduledFor: null,
      prepMinutes: 15,
      idempotencyKey: `repo-dispatch-${randomUUID()}`,
      requestHash: "e".repeat(64),
      lines: [
        {
          menuItemId: item.id,
          name: "Kapeng Barako",
          basePriceCentavos: (totalCentavos - 5900) / 2,
          modifiersUnitCentavos: 0,
          quantity: 2,
          modifiers: [],
          lineTotalCentavos: totalCentavos - 5900,
        },
      ],
      promo: null,
    };
    const placed = await orders.create(order);
    if (!placed) throw new Error("order not created");
    created.push(placed.id);
    const accepted = await orders.changeStatus({
      orderId: placed.id,
      from: "placed",
      steps: ["accepted", "preparing"],
      actor: OWNER,
      prepMinutes: 15,
      meta: {},
    });
    expect(accepted).toBe(true);
    return placed.id;
  }

  beforeAll(freshRiders);

  afterAll(async () => {
    // Leave no rider holding a job for the other suites.
    await prisma.orders.updateMany({
      where: { id: { in: created }, status: { notIn: ["delivered"] } },
      data: { rider_id: null },
    });
    await prisma.dispatch_offers.updateMany({
      where: { order_id: { in: created }, status: "offered" },
      data: { status: "expired" },
    });
    await prisma.$disconnect();
  });

  it("reads the dispatch settings from the feature flag", async () => {
    expect(await repo.load()).toMatchObject({ offerSeconds: 30, pinThresholdCentavos: 50000 });
  });

  it("runs a job from offer to delivery and settles it", async () => {
    const orderId = await preparingOrder();
    const job = await repo.job(orderId);
    expect(job).toMatchObject({
      status: "preparing",
      riderId: null,
      attempts: 0,
      hasOpenOffer: false,
    });
    expect(job?.readyBy).toBeInstanceOf(Date);
    if (!job) return;

    const candidates = await repo.candidates(job, 5000);
    expect(candidates.map((c) => c.riderId).slice(0, 2)).toEqual([ROSA, RICO]);
    expect(candidates[0]).toMatchObject({ userId: ROSA_USER, cashLimitCentavos: 300000 });

    const expiresAt = new Date(Date.now() + 30_000);
    const offerId = await repo.createOffer({
      orderId,
      riderId: ROSA,
      earningsCentavos: 3500,
      expiresAt,
    });
    expect(offerId).toEqual(expect.any(String));
    expect(
      await repo.createOffer({ orderId, riderId: RICO, earningsCentavos: 3500, expiresAt }),
    ).toBeNull();
    expect((await repo.job(orderId))?.hasOpenOffer).toBe(true);
    expect(await repo.awaitingDispatch()).not.toContain(orderId);

    const offer = await repo.currentOffer(ROSA, new Date());
    expect(offer).toMatchObject({
      orderId,
      storeName: "Kape't Tinapay",
      dropoffArea: "Bel-Air",
      earningsCentavos: 3500,
      tipCentavos: 2000,
      cashToCollectCentavos: 17900,
    });
    expect(offer?.tripMeters).toBeGreaterThan(500);

    const now = new Date();
    expect(
      await repo.respond({ offerId: offerId ?? "", riderId: RICO, answer: "accepted", now }),
    ).toBe("not_found");
    expect(
      await repo.respond({ offerId: offerId ?? "", riderId: ROSA, answer: "declined", now }),
    ).toEqual({ orderId });
    expect(
      await repo.respond({ offerId: offerId ?? "", riderId: ROSA, answer: "accepted", now }),
    ).toBe("closed");
    expect(await repo.awaitingDispatch()).toContain(orderId);

    const secondJob = await repo.job(orderId);
    if (!secondJob) return;
    expect((await repo.candidates(secondJob, 5000)).map((c) => c.riderId)).not.toContain(ROSA);
    const ricoOffer = await repo.createOffer({
      orderId,
      riderId: RICO,
      earningsCentavos: 3600,
      expiresAt,
    });
    expect(
      await repo.respond({
        offerId: ricoOffer ?? "",
        riderId: RICO,
        answer: "accepted",
        now: new Date(),
      }),
    ).toEqual({ orderId });
    expect(await prisma.orders.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      rider_id: RICO,
      rider_earnings_centavos: 3600,
      dispatch_status: "assigned",
      dispatch_attempts: 2,
    });

    const active = await repo.activeJob(RICO);
    expect(active).toMatchObject({
      orderId,
      status: "preparing",
      contactPhone: "+639170000031",
      pinRequired: false,
      earningsCentavos: 3600,
      dropoff: { landmark: "Blue tower lobby", notes: "Ring twice", barangay: "Bel-Air" },
      items: [{ name: "Kapeng Barako", quantity: 2 }],
    });

    expect(await repo.markArrivedAtStore(orderId, RICO, new Date())).toBe(true);
    expect(await repo.markArrivedAtStore(orderId, ROSA, new Date())).toBe(false);
    expect(await repo.pickUp(orderId, RICO, RICO_USER)).toBe(false);
    await orders.changeStatus({
      orderId,
      from: "preparing",
      steps: ["ready"],
      actor: OWNER,
      meta: {},
    });
    expect(await repo.pickUp(orderId, RICO, RICO_USER)).toBe(true);
    const pickedUp = await prisma.order_events.findFirst({
      where: { order_id: orderId, to_status: "picked_up" },
    });
    expect(pickedUp).toMatchObject({ actor_id: RICO_USER, actor_role: "rider" });

    // The throttle: a second fix within the interval is dropped.
    expect(
      await repo.saveLocation(
        RICO,
        { lat: 14.556, lng: 121.023, heading: 370, speedKph: 18, accuracyM: 8 },
        new Date(Date.now() + 10_000),
        4000,
      ),
    ).toBe(true);
    expect(
      await repo.saveLocation(
        RICO,
        { lat: 14.556, lng: 121.024 },
        new Date(Date.now() + 11_000),
        4000,
      ),
    ).toBe(false);
    await repo.addBreadcrumb(RICO, orderId, { lat: 14.556, lng: 121.023 }, new Date());
    expect(await prisma.rider_location_breadcrumbs.count({ where: { order_id: orderId } })).toBe(1);

    const tracking = await repo.facts(orderId);
    expect(tracking).toMatchObject({
      status: "picked_up",
      customerId: CARMEN,
      rider: {
        firstName: "Rico",
        vehicleType: "motorcycle",
        location: { lat: 14.556, lng: 121.023 },
      },
    });

    const facts = await repo.settlementFacts(orderId);
    expect(facts).toMatchObject({
      paidOnline: false,
      tipCentavos: 2000,
      riderPayCentavos: 3600,
      discountFundedBy: "platform",
    });
    if (!facts) return;
    const cashBefore = await repo.cashHeld(RICO);
    const ledger = new LedgerService().settlement({
      ...facts,
      riderId: RICO,
      commissionCentavos: 0,
    });
    expect(
      await repo.deliver({
        orderId,
        riderId: RICO,
        riderUserId: RICO_USER,
        proofPath: `${orderId}/proof.jpg`,
        ledger,
      }),
    ).toBe(true);
    expect(
      await repo.deliver({
        orderId,
        riderId: RICO,
        riderUserId: RICO_USER,
        proofPath: null,
        ledger,
      }),
    ).toBe(false);
    expect(await repo.cashHeld(RICO)).toBe(cashBefore + 17900);
    expect(await repo.activeJob(RICO)).toBeNull();
    const today = await repo.earningsSince(RICO, new Date(Date.now() - 3_600_000));
    expect(today.jobs).toBeGreaterThanOrEqual(1);
    expect(today.payCentavos).toBeGreaterThanOrEqual(3600);
    expect(await repo.facts("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await repo.job("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await repo.settlementFacts("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("expires offers past their time and flags the order for the coordinator once", async () => {
    await freshRiders();
    const orderId = await preparingOrder(60100);
    expect(await repo.deliveryPin(orderId)).toMatch(/^\d{4}$/);
    const offerId = await repo.createOffer({
      orderId,
      riderId: ROSA,
      earningsCentavos: 3500,
      expiresAt: new Date(Date.now() + 1000),
    });
    expect(offerId).not.toBeNull();
    expect(await repo.expireDue(new Date(Date.now() + 5000))).toContain(orderId);
    expect(await repo.currentOffer(ROSA, new Date())).toBeNull();
    expect(
      (await prisma.orders.findUniqueOrThrow({ where: { id: orderId } })).dispatch_status,
    ).toBe("unassigned");

    expect(await repo.flag(orderId, new Date())).toBe(true);
    expect(await repo.flag(orderId, new Date())).toBe(false);
    const alerts = await prisma.notifications.findMany({
      where: { order_id: orderId, template: "dispatch_unassigned" },
    });
    expect(alerts.map((a) => [a.user_id, a.channel]).sort()).toEqual([
      [COORDINATOR, "in_app"],
      [COORDINATOR, "push"],
    ]);
    await prisma.notifications.deleteMany({ where: { order_id: orderId } });
  });

  it("knows the rider behind a user and their online switch", async () => {
    const rosa = await repo.riderForUser(ROSA_USER);
    expect(rosa).toMatchObject({
      id: ROSA,
      status: "active",
      vehicleType: "motorcycle",
      plateNo: "NAC 5678",
    });
    await repo.setOnline(ROSA, false);
    expect((await repo.riderForUser(ROSA_USER))?.isOnline).toBe(false);
    await repo.setOnline(ROSA, true);
    expect(await repo.riderForUser(CARMEN)).toBeNull();
  });
});

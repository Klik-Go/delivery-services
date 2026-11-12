import { randomUUID } from "node:crypto";
import { getPrismaClient } from "@klikgo/db";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaAuditLog,
  PrismaMerchantAdmin,
  PrismaOpsOrders,
  PrismaRiderAdmin,
  PrismaRiderOnboarding,
  PrismaSettings,
  PrismaStaff,
  PrismaZoneAdmin,
} from "./prisma-ops-repositories";
import { PrismaOrderRepository } from "./prisma-order-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const CARMEN = "5eed0000-0000-4000-8000-0000000000e1";
const KAPE = "5eed0000-0000-4000-8000-000000000102";
const SILOG = "5eed0000-0000-4000-8000-000000000104";
const KAPE_OWNER = "5eed0000-0000-4000-8000-0000000000b2";
const ADMIN = "5eed0000-0000-4000-8000-0000000000a1";
const COORDINATOR = "5eed0000-0000-4000-8000-0000000000c1";
const RICO = "5eed0000-0000-4000-8000-000000000201";
const ROSA = "5eed0000-0000-4000-8000-000000000202";

/** The console's repositories against the seeded database; every change is put back. */
describeDb("ops console repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const orders = new PrismaOrderRepository(prisma);
  const ops = new PrismaOpsOrders(prisma);
  const zones = new PrismaZoneAdmin(prisma);
  const merchants = new PrismaMerchantAdmin(prisma);
  const riders = new PrismaRiderAdmin(prisma);
  const onboarding = new PrismaRiderOnboarding(prisma);
  const settings = new PrismaSettings(prisma);
  const staff = new PrismaStaff(prisma);
  const audit = new PrismaAuditLog(prisma);
  let makati: string;
  let sanMarcelino: string;
  const created: string[] = [];
  const cleanups: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    makati = (await prisma.zones.findUniqueOrThrow({ where: { slug: "makati" } })).id;
    sanMarcelino = (
      await prisma.zones.findUniqueOrThrow({ where: { slug: "san-marcelino-zambales" } })
    ).id;
  });

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await prisma.orders.updateMany({ where: { id: { in: created } }, data: { rider_id: null } });
    await prisma.$disconnect();
  });

  async function preparingOrder(): Promise<string> {
    const item = await prisma.menu_items.findFirstOrThrow({
      where: { merchant_id: KAPE, name: "Kapeng Barako" },
    });
    const placed = await orders.create({
      customerId: CARMEN,
      merchantId: KAPE,
      zoneId: makati,
      status: "placed",
      paymentMethod: "cod",
      subtotalCentavos: 12000,
      deliveryFeeCentavos: 3900,
      serviceFeeCentavos: 0,
      smallOrderFeeCentavos: 0,
      discountCentavos: 0,
      tipCentavos: 0,
      totalCentavos: 15900,
      address: { label: "Office", landmark: "Lobby", contactPhone: "+639170000031" },
      dropoff: { lat: 14.5547, lng: 121.0244 },
      scheduledFor: null,
      prepMinutes: 15,
      idempotencyKey: `repo-ops-${randomUUID()}`,
      requestHash: "f".repeat(64),
      lines: [
        {
          menuItemId: item.id,
          name: "Kapeng Barako",
          basePriceCentavos: 6000,
          modifiersUnitCentavos: 0,
          quantity: 2,
          modifiers: [],
          lineTotalCentavos: 12000,
        },
      ],
      promo: null,
    });
    if (!placed) throw new Error("order not created");
    created.push(placed.id);
    await orders.changeStatus({
      orderId: placed.id,
      from: "placed",
      steps: ["accepted", "preparing"],
      actor: { id: KAPE_OWNER, role: "merchant_owner" },
      prepMinutes: 15,
      meta: {},
    });
    return placed.id;
  }

  it("shows live orders by zone, the order's story and notes, and assigns riders", async () => {
    const orderId = await preparingOrder();
    const board = await ops.board([makati]);
    expect(board.map((o) => o.id)).toContain(orderId);
    expect(await ops.board([sanMarcelino])).toEqual([]);
    expect(await ops.board([])).toEqual([]);
    expect((await ops.board("all")).some((o) => o.id === orderId)).toBe(true);

    await prisma.dispatch_offers.create({
      data: {
        order_id: orderId,
        rider_id: ROSA,
        rider_earnings_centavos: 3500,
        expires_at: new Date(Date.now() + 30_000),
      },
    });
    expect(
      await ops.assignRider({
        orderId,
        riderId: RICO,
        expectedRiderId: ROSA,
        earningsCentavos: 3500,
      }),
    ).toBe(false);
    expect(
      await ops.assignRider({
        orderId,
        riderId: RICO,
        expectedRiderId: null,
        earningsCentavos: 3700,
      }),
    ).toBe(true);
    const offers = await prisma.dispatch_offers.findMany({ where: { order_id: orderId } });
    expect(offers.map((o) => o.status)).toEqual(["expired"]);

    const noteId = await ops.addNote({
      orderId,
      authorId: COORDINATOR,
      authorRole: "coordinator",
      body: "Call on arrival",
    });
    const detail = await ops.order(orderId);
    expect(detail).toMatchObject({
      status: "preparing",
      riderId: RICO,
      riderName: "Rico Rider",
      prepMinutes: 15,
      customerId: CARMEN,
      paymentStatus: "pending",
      history: [
        { from: null, to: "placed", actorRole: "customer" },
        { from: "placed", to: "accepted", actorRole: "merchant_owner" },
        { from: "accepted", to: "preparing", actorRole: "merchant_owner" },
      ],
      notes: [
        {
          id: noteId,
          body: "Call on arrival",
          authorRole: "coordinator",
          authorName: "Cora Coordinator",
        },
      ],
    });
    expect(await ops.order(randomUUID())).toBeNull();

    const rico = await ops.rider(RICO);
    expect(rico).toMatchObject({ name: "Rico Rider", status: "active", activeOrderId: orderId });
    expect(await ops.rider(randomUUID())).toBeNull();
    expect((await ops.riders([makati])).map((r) => r.id)).toEqual(
      expect.arrayContaining([RICO, ROSA]),
    );
  });

  it("reads and edits zones, outlines, coordinators and fee rules", async () => {
    const before = await zones.zone(sanMarcelino);
    expect(before?.ring.length).toBeGreaterThanOrEqual(3);
    cleanups.push(() => zones.setArea(sanMarcelino, before?.ring ?? []));
    cleanups.push(() =>
      zones.update(sanMarcelino, {
        baseFeeCentavos: before?.baseFeeCentavos,
        isActive: before?.isActive,
        maxRadiusKm: before?.maxRadiusKm,
      }),
    );

    const square: [number, number][] = [
      [120.15, 14.96],
      [120.17, 14.96],
      [120.17, 14.98],
      [120.15, 14.98],
    ];
    expect(await zones.setArea(sanMarcelino, square)).toBe("ok");
    expect((await zones.zone(sanMarcelino))?.ring).toEqual(square);
    const bowTie: [number, number][] = [square[0], square[2], square[1], square[3]] as [
      number,
      number,
    ][];
    expect(await zones.setArea(sanMarcelino, bowTie)).toBe("invalid");
    expect(await zones.setArea(randomUUID(), square)).toBe("missing");
    expect(await zones.setArea(sanMarcelino, [])).toBe("invalid");

    expect(
      await zones.update(sanMarcelino, {
        baseFeeCentavos: 4100,
        maxRadiusKm: 25,
        name: before?.name,
      }),
    ).toBe(true);
    expect(await zones.zone(sanMarcelino)).toMatchObject({
      baseFeeCentavos: 4100,
      maxRadiusKm: 25,
      zoneType: "provincial",
    });
    expect(await zones.update(randomUUID(), { isActive: true })).toBe(false);

    expect(await zones.isZoneCoordinator(COORDINATOR, makati)).toBe(true);
    expect(await zones.isZoneCoordinator(COORDINATOR, sanMarcelino)).toBe(false);
    const coord = (await zones.zone(makati))?.coordinatorId ?? null;
    cleanups.push(() => zones.setCoordinator(makati, coord));
    expect(await zones.setCoordinator(makati, null)).toBe(true);
    expect((await zones.zone(makati))?.coordinatorId).toBeNull();

    const ruleId = await zones.createFeeRule(sanMarcelino, {
      name: "Service fee",
      kind: "service_fee",
      minDistanceM: null,
      maxDistanceM: null,
      minSubtotalCentavos: null,
      feeCentavos: 500,
      priority: 0,
      isActive: true,
    });
    cleanups.push(() => prisma.fee_rules.delete({ where: { id: ruleId } }));
    expect(
      await zones.updateFeeRule(ruleId, {
        feeCentavos: 700,
        isActive: false,
        name: "Service",
        minDistanceM: null,
        maxDistanceM: null,
        minSubtotalCentavos: null,
        priority: 1,
        kind: "service_fee",
      }),
    ).toBe(true);
    expect(await zones.feeRule(ruleId)).toMatchObject({
      feeCentavos: 700,
      isActive: false,
      name: "Service",
    });
    expect(await zones.feeRule(randomUUID())).toBeNull();
    expect(await zones.updateFeeRule(randomUUID(), { feeCentavos: 1 })).toBe(false);
    expect((await zones.zones([makati])).map((z) => z.slug)).toEqual(["makati"]);
    expect((await zones.zones("all")).length).toBeGreaterThanOrEqual(3);
  });

  it("suspends stores and schedules commission", async () => {
    const before = await merchants.merchant(SILOG);
    if (!before) throw new Error("Seed store missing (run pnpm db:reset)");
    cleanups.push(() =>
      prisma.merchants.update({
        where: { id: SILOG },
        data: {
          status: before.status,
          status_reason: null,
          is_open: true,
          commission_bps: before.commissionBps,
          next_commission_bps: null,
          next_commission_from: null,
        },
      }),
    );
    expect(await merchants.setStatus(SILOG, "suspended", "Food safety")).toBe(true);
    expect(await merchants.merchant(SILOG)).toMatchObject({
      status: "suspended",
      statusReason: "Food safety",
    });
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await merchants.setCommission(SILOG, 1500, tomorrow, new Date())).toBe(true);
    expect(await merchants.merchant(SILOG)).toMatchObject({
      commissionBps: before?.commissionBps,
      nextCommissionBps: 1500,
    });
    const [later] = await prisma.$queryRaw<{ bps: number }[]>`
      select private.commission_bps(${SILOG}::uuid, now() + interval '2 days') as bps`;
    expect(later?.bps).toBe(1500);
    expect(
      await merchants.setCommission(SILOG, 1800, new Date(Date.now() - 1000), new Date()),
    ).toBe(true);
    expect(await merchants.merchant(SILOG)).toMatchObject({
      commissionBps: 1800,
      nextCommissionBps: null,
    });
    expect(await merchants.setStatus(randomUUID(), "active", null)).toBe(false);
    expect(await merchants.merchant(randomUUID())).toBeNull();
    expect((await merchants.merchants([makati])).some((m) => m.id === SILOG)).toBe(true);
    expect((await merchants.merchants("all")).length).toBeGreaterThanOrEqual(5);
  });

  it("takes a rider application through documents, review and approval", async () => {
    const { data } = await adminAuth().auth.admin.createUser({
      phone: `6391799${String(Date.now()).slice(-5)}`,
      phone_confirm: true,
    });
    const userId = data.user?.id ?? "";
    cleanups.push(() => adminAuth().auth.admin.deleteUser(userId));
    const riderId = await onboarding.apply({
      userId,
      zoneId: makati,
      vehicleType: "motorcycle",
      plateNo: "E2E 0002",
      fullName: "Repo Rider",
      payoutAccountName: "Repo Rider",
    });
    expect(riderId).toEqual(expect.any(String));
    expect(
      await onboarding.apply({
        userId,
        zoneId: makati,
        vehicleType: "bicycle",
        plateNo: null,
        fullName: "x",
        payoutAccountName: "x",
      }),
    ).toBeNull();
    expect(await prisma.user_roles.count({ where: { user_id: userId, role: "rider" } })).toBe(1);
    expect(await onboarding.zoneExists(makati)).toBe(true);
    expect(await onboarding.zoneExists(randomUUID())).toBe(false);

    const docId = await onboarding.addDocument({
      riderId: riderId ?? "",
      type: "government_id",
      storagePath: `${riderId ?? ""}/government_id-1.jpg`,
    });
    const second = await onboarding.addDocument({
      riderId: riderId ?? "",
      type: "government_id",
      storagePath: `${riderId ?? ""}/government_id-2.jpg`,
    });
    const application = await onboarding.riderForUser(userId);
    expect(application).toMatchObject({
      name: "Repo Rider",
      status: "pending_kyc",
      payoutAccountName: "Repo Rider",
    });
    expect(application?.documents.map((d) => d.id)).toEqual([second]);

    expect((await riders.riders([makati], "pending")).map((r) => r.id)).toContain(riderId);
    expect(await riders.riders([sanMarcelino], "pending")).toEqual([]);
    expect(await riders.document(docId)).toMatchObject({ zoneId: makati, status: "pending" });
    expect(await riders.document(randomUUID())).toBeNull();
    expect(
      await riders.reviewDocument({
        documentId: docId,
        status: "rejected",
        reason: "Blurry",
        reviewerId: COORDINATOR,
      }),
    ).toBe(true);
    expect(
      await riders.reviewDocument({
        documentId: docId,
        status: "approved",
        reason: null,
        reviewerId: COORDINATOR,
      }),
    ).toBe(false);

    expect(await riders.setStatus(riderId ?? "", "active", null)).toBe(true);
    await prisma.riders.update({ where: { id: riderId ?? "" }, data: { is_online: true } });
    expect(await riders.setStatus(riderId ?? "", "active", null)).toBe(false);
    expect(await riders.setStatus(riderId ?? "", "suspended", "No-shows")).toBe(true);
    expect(await riders.rider(riderId ?? "")).toMatchObject({
      status: "suspended",
      statusReason: "No-shows",
    });
    expect(
      (await prisma.riders.findUniqueOrThrow({ where: { id: riderId ?? "" } })).is_online,
    ).toBe(false);
    expect(await riders.rider(randomUUID())).toBeNull();
    expect((await riders.riders("all", "suspended")).some((r) => r.id === riderId)).toBe(true);
    expect(Array.isArray(await riders.riders("all", "coaching"))).toBe(true);
    expect(Array.isArray(await riders.riders("all", "active"))).toBe(true);
    expect(await onboarding.riderForUser(randomUUID())).toBeNull();
  });

  it("edits feature flags, lists and revokes staff roles, and writes audit rows", async () => {
    const dispatch = await settings.flag("dispatch");
    cleanups.push(() =>
      settings.updateFlag(
        "dispatch",
        { enabled: dispatch?.enabled ?? true, rollout: dispatch?.rollout ?? {} },
        ADMIN,
      ),
    );
    expect(
      await settings.updateFlag(
        "dispatch",
        { enabled: true, rollout: { ...dispatch?.rollout, offer_seconds: 45 } },
        ADMIN,
      ),
    ).toBe(true);
    expect((await settings.flag("dispatch"))?.rollout).toMatchObject({ offer_seconds: 45 });
    expect(await settings.updateFlag("nope", { enabled: true, rollout: {} }, ADMIN)).toBe(false);
    expect(await settings.flag("nope")).toBeNull();
    expect((await settings.flags()).map((f) => f.key)).toEqual(
      expect.arrayContaining(["dispatch", "merchant_sla"]),
    );

    const grant = await prisma.user_roles.create({
      data: { user_id: CARMEN, role: "coordinator", zone_id: sanMarcelino },
    });
    await zones.setCoordinator(sanMarcelino, CARMEN);
    cleanups.push(() => prisma.user_roles.deleteMany({ where: { id: grant.id } }));
    const list = await staff.staff();
    expect(list.find((g) => g.id === grant.id)).toMatchObject({
      role: "coordinator",
      zoneName: "San Marcelino, Zambales",
      name: "Carmen Customer",
    });
    expect((await staff.grant(grant.id))?.zoneId).toBe(sanMarcelino);
    expect(await staff.revoke(grant.id)).toBe(true);
    expect((await zones.zone(sanMarcelino))?.coordinatorId).toBeNull();
    expect(await staff.revoke(grant.id)).toBe(false);
    expect(await staff.grant(grant.id)).toBeNull();

    const entity = randomUUID();
    await audit.record({
      actorId: ADMIN,
      actorRole: "admin",
      action: "repo.test",
      entityType: "tests",
      entityId: entity,
      meta: { reason: "Testing" },
    });
    const row = await prisma.audit_logs.findFirst({ where: { entity_id: entity } });
    expect(row).toMatchObject({
      action: "repo.test",
      actor_role: "admin",
      meta: { reason: "Testing" },
    });
  });
});

let client: SupabaseClient | undefined;
/** Local test setup only: the service-role client creates a throwaway applicant account. */
function adminAuth(): SupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return client;
}

import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { DistanceBandFee, ZoneBaseFee } from "../catalog/fee-strategies";
import { FeedService } from "../catalog/feed-service";
import { PricingService } from "../catalog/pricing-service";
import { ConsoleAccess } from "../ops/console-access";
import type { AuditEntry, IAuditLog } from "../ops/ports";
import {
  AYALA,
  FakeClock,
  FakePhotoStorage,
  FakeSmsSender,
  InMemoryKpis,
  InMemoryPilotInvites,
  InMemoryPilotSettings,
  MemoryCache,
  MemoryLogger,
  NO_FIGURES,
  SequentialInviteCodes,
  barakoOrder,
  catalogWorld,
  orderingWorld,
  sessionUser,
} from "../testing";
import { INVITE_ONLY_MESSAGE, PilotInviteService } from "./invite-service";
import { KPI_TARGETS, KpiService, derive, manilaMidnight } from "./kpi-service";

const NOW = new Date("2026-11-24T04:00:00Z"); // 12:00 in Manila
const admin = sessionUser("admin-1", [{ role: "admin" }]);
const coordinator = sessionUser("coord-1", [{ role: "coordinator", zoneId: "zone-1" }]);
const customer = sessionUser("cust-1", [{ role: "customer" }], "aal1");
const rider = sessionUser("rider-1", [{ role: "customer" }, { role: "rider" }], "aal1");

class AuditSpy implements IAuditLog {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

function inviteWorld() {
  const invites = new InMemoryPilotInvites();
  const settings = new InMemoryPilotSettings().set({ inviteOnly: true, maxCustomers: 2 });
  const sms = new FakeSmsSender();
  const audit = new AuditSpy();
  const service = new PilotInviteService({
    invites,
    settings,
    codes: new SequentialInviteCodes(),
    access: new ConsoleAccess(new AuthorizationService(), audit),
    sms,
    clock: new FakeClock(NOW),
    logger: new MemoryLogger(),
    appUrl: "https://klikgo.example/",
  });
  return { invites, settings, sms, audit, service };
}

describe("PilotInviteService", () => {
  it("lets everyone order while the pilot is open, and asks plain customers for a code once it is invite-only", async () => {
    const { service, settings } = inviteWorld();
    settings.set({ inviteOnly: false });
    expect(await service.canOrder("cust-1")).toBe(true);
    expect(await service.landingFor(customer, "/")).toBe("/");
    settings.set({ inviteOnly: true });
    expect(await service.canOrder("cust-1")).toBe(false);
    expect(await service.landingFor(customer, "/orders")).toBe("/join?next=%2Forders");
    expect(await service.landingFor(rider, "/rider")).toBe("/rider");
    expect(await service.landingFor(admin, "/admin")).toBe("/admin");
  });

  it("creates audited batches of codes for admins only", async () => {
    const { service, invites, audit } = inviteWorld();
    const made = await service.createBatch(admin, {
      batch: "Flyers Poblacion",
      count: 3,
      expiresInDays: 30,
    });
    expect(made).toEqual({ ok: true, value: { codes: ["CODE0001", "CODE0002", "CODE0003"] } });
    expect(invites.invites[0]?.expiresAt?.toISOString()).toBe("2026-12-24T04:00:00.000Z");
    expect(audit.entries.map((e) => [e.action, e.meta])).toEqual([
      ["invite.create", { batch: "Flyers Poblacion", count: 3 }],
    ]);
    expect((await service.createBatch(coordinator, { batch: "x", count: 1 })).ok).toBe(false);
    const tooMany = await service.createBatch(admin, { batch: "x", count: 500 });
    expect(!tooMany.ok && tooMany.error.code).toBe("VALIDATION_FAILED");
  });

  it("redeems a code once, keeps access, and stops at the customer limit", async () => {
    const { service, invites } = inviteWorld();
    await service.createBatch(admin, { batch: "Flyers", count: 3 });
    expect(await service.redeem(customer, " code0001 ")).toEqual({
      ok: true,
      value: { canOrder: true },
    });
    expect(await service.canOrder("cust-1")).toBe(true);
    expect((await service.redeem(customer, "CODE0002")).ok).toBe(true);
    const used = await service.redeem(sessionUser("cust-2", []), "CODE0001");
    expect(!used.ok && used.error.message).toContain("already used");
    const missing = await service.redeem(sessionUser("cust-2", []), "NOPE");
    expect(!missing.ok && missing.error.message).toContain("doesn't exist");
    expect((await service.redeem(sessionUser("cust-2", []), "CODE0002")).ok).toBe(true);
    const full = await service.redeem(sessionUser("cust-3", []), "CODE0003");
    expect(!full.ok && full.error.code).toBe("CONFLICT");
    expect(!full.ok && full.error.message).toContain("The pilot is full");
    invites.invites.push({
      code: "OLD00001",
      batch: "x",
      waitlistId: null,
      expiresAt: new Date(0),
      createdAt: new Date(0),
      sentAt: null,
      redeemedBy: null,
      redeemedAt: null,
    });
    const expired = await service.redeem(sessionUser("cust-4", []), "OLD00001");
    expect(!expired.ok && expired.error.message).toContain("expired");
    expect((await service.redeem(null, "CODE0003")).ok).toBe(false);
  });

  it("texts one code to each waiting person, once, and reports texts that failed", async () => {
    const { service, invites, sms } = inviteWorld();
    invites.waitlist.push(
      { waitlistId: "w-1", name: "Ana", phone: "+639170000001" },
      { waitlistId: "w-2", name: "Ben", phone: "+639170000002" },
    );
    expect(await service.inviteWaitlist(admin, { count: 5 })).toEqual({
      ok: true,
      value: { invited: 2, notSent: 0 },
    });
    expect(sms.sent.map((m) => m.to)).toEqual(["+639170000001", "+639170000002"]);
    expect(sms.sent[0]?.body).toBe(
      "Klik Go: you're invited! Your code is CODE0001. Order at https://klikgo.example/join?code=CODE0001",
    );
    expect(sms.sent[0]?.body.length).toBeLessThanOrEqual(160);
    expect(invites.invites.every((i) => i.sentAt !== null && i.batch === "Waitlist")).toBe(true);
    expect(await service.inviteWaitlist(admin, { count: 5 })).toEqual({
      ok: true,
      value: { invited: 0, notSent: 0 },
    });
    const bad = await service.inviteWaitlist(admin, { count: 0 });
    expect(!bad.ok && bad.error.code).toBe("VALIDATION_FAILED");
  });

  it("counts texts that could not be sent", async () => {
    const { service, invites } = inviteWorld();
    invites.waitlist.push({ waitlistId: "w-1", name: "Ana", phone: "+639170000001" });
    const failing = new PilotInviteService({
      invites,
      settings: new InMemoryPilotSettings(),
      codes: new SequentialInviteCodes(),
      access: new ConsoleAccess(new AuthorizationService(), new AuditSpy()),
      sms: {
        send: () =>
          Promise.resolve({
            ok: false as const,
            error: { code: "UNAVAILABLE", message: "down", name: "AppError" } as never,
          }),
      },
      clock: new FakeClock(NOW),
      logger: new MemoryLogger(),
      appUrl: "https://klikgo.example",
    });
    expect(await failing.inviteWaitlist(admin, { count: 1 })).toEqual({
      ok: true,
      value: { invited: 1, notSent: 1 },
    });
    expect(invites.invites[0]?.sentAt).toBeNull();
    expect((await service.summary(admin)).ok && (await service.summary(admin))).toMatchObject({
      value: { total: 1, redeemed: 0 },
    });
    expect((await service.summary(coordinator)).ok).toBe(false);
    expect((await service.status(customer)).ok && (await service.status(customer))).toMatchObject({
      value: { inviteOnly: true, canOrder: false },
    });
    expect((await service.status(null)).ok).toBe(false);
  });
});

describe("the pilot switches at checkout and in the feed", () => {
  it("refuses orders from customers without an invite while the pilot is invite-only", async () => {
    const w = orderingWorld();
    w.pilot.set({ inviteOnly: true });
    const quote = await w.orders.quoteCheckout(barakoOrder(), w.customer);
    expect(quote.ok && quote.value.inviteRequired).toBe(true);
    const refused = await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: "pilot-1",
      actor: w.customer,
      urls: w.urls,
    });
    expect(!refused.ok && refused.error.message).toBe(INVITE_ONLY_MESSAGE);
    w.invites.invites.push({
      code: "WELCOME1",
      batch: "x",
      waitlistId: null,
      expiresAt: null,
      createdAt: new Date(0),
      sentAt: null,
      redeemedBy: w.customer.id,
      redeemedAt: new Date(0),
    });
    expect(
      (
        await w.orders.placeOrder(barakoOrder(), {
          idempotencyKey: "pilot-2",
          actor: w.customer,
          urls: w.urls,
        })
      ).ok,
    ).toBe(true);
  });

  it("offers no later times and refuses scheduled orders while scheduling is off", async () => {
    const w = orderingWorld();
    w.pilot.set({ scheduledOrders: false });
    const quote = await w.orders.quoteCheckout(barakoOrder(), w.customer);
    expect(quote.ok && quote.value.slots).toEqual([]);
    const later = await w.orders.placeOrder(
      barakoOrder({ scheduledFor: "2026-11-02T05:00:00.000Z" }),
      { idempotencyKey: "pilot-3", actor: w.customer, urls: w.urls },
    );
    expect(!later.ok && later.error.message).toContain("Ordering for later is off");
  });

  it("shows only the pilot's store categories while pilot_scope is on", async () => {
    const { area, catalog } = catalogWorld();
    const first = catalog.stores[0];
    if (first)
      catalog.stores.push({ ...first, merchantId: "sari", slug: "sari", category: "grocery" });
    const clock = new FakeClock(new Date("2026-11-02T03:00:00Z"));
    const pilot = new InMemoryPilotSettings();
    const feed = new FeedService({
      serviceArea: area,
      catalog,
      pricing: new PricingService({
        catalog,
        serviceArea: area,
        delivery: [new DistanceBandFee(), new ZoneBaseFee()],
        surcharges: [],
        clock,
      }),
      photos: new FakePhotoStorage(),
      cache: new MemoryCache(() => 0),
      clock,
      pilot,
    });
    expect((await feed.feed(AYALA, null)).categories.sort()).toEqual(["food", "grocery"]);
    pilot.set({ categories: ["food"] });
    const scoped = await feed.feed(AYALA, null);
    expect(scoped.categories).toEqual(["food"]);
    expect(scoped.stores.some((s) => s.merchantId === "sari")).toBe(false);
  });
});

describe("KpiService", () => {
  it("works out Manila midnight", () => {
    expect(manilaMidnight(NOW).toISOString()).toBe("2026-11-23T16:00:00.000Z");
    expect(manilaMidnight(new Date("2026-11-23T15:59:00Z")).toISOString()).toBe(
      "2026-11-22T16:00:00.000Z",
    );
  });

  it("derives the ratios, contribution and rider figures, and leaves empty periods blank", () => {
    const period = derive("7d", NOW, NOW, {
      ...NO_FIGURES,
      placed: 40,
      delivered: 38,
      cancelledByPlatform: 1,
      codDelivered: 19,
      gmvCentavos: 1_064_000,
      platformRevenueCentavos: 290_000,
      promoCostCentavos: 20_000,
      gatewayFeesCentavos: 6_000,
      refundsCentavos: 2_000,
      avgConfirmSeconds: 95.4,
      avgDeliverySeconds: 1_830,
      customers: 25,
      repeatCustomers: 10,
      riderEarningsCentavos: 300_000,
      riderOnlineSeconds: 36_000,
      riderBusySeconds: 25_200,
    });
    expect(period).toMatchObject({
      aovCentavos: 28_000,
      takeRateBps: 2_726,
      completionBps: 9_500,
      platformCancelBps: 250,
      codShareBps: 5_000,
      repeatBps: 4_000,
      contributionPerOrderCentavos: 6_895,
      confirmSeconds: 95,
      deliveryMinutes: 30.5,
      utilisationBps: 7_000,
      riderEarningsPerHourCentavos: 30_000,
    });
    expect(derive("today", NOW, NOW, NO_FIGURES)).toMatchObject({
      aovCentavos: null,
      takeRateBps: null,
      utilisationBps: null,
      riderEarningsPerHourCentavos: null,
      confirmSeconds: null,
      deliveryMinutes: null,
    });
  });

  it("shows today, 7 and 30 Manila days and a 14-day trend to admins only", async () => {
    const kpis = new InMemoryKpis(
      () => ({ ...NO_FIGURES, placed: 1 }),
      [{ day: "2026-11-24", placed: 1, delivered: 0, gmvCentavos: 0, avgConfirmSeconds: null }],
    );
    const service = new KpiService({
      access: new ConsoleAccess(new AuthorizationService(), new AuditSpy()),
      kpis,
      clock: new FakeClock(NOW),
    });
    const result = await service.dashboard(admin);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.periods.map((p) => [p.label, p.from.toISOString()])).toEqual([
      ["today", "2026-11-23T16:00:00.000Z"],
      ["7d", "2026-11-17T16:00:00.000Z"],
      ["30d", "2026-10-25T16:00:00.000Z"],
    ]);
    expect(result.value.days).toHaveLength(1);
    expect(result.value.targets).toBe(KPI_TARGETS);
    const refused = await service.dashboard(coordinator);
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_DISPATCH_SETTINGS } from "./ports";
import { parseDispatchSettings } from "./dispatch-settings";
import { DistancePayRule } from "./distance-pay-rule";
import { NearestAvailableStrategy } from "./nearest-available-strategy";
import { dispatchWorld, RICO_AT, ROSA_AT } from "../testing";

function world() {
  const w = dispatchWorld();
  w.db.addRider({ id: "rosa", location: ROSA_AT });
  w.db.addRider({ id: "rico", location: RICO_AT });
  w.db.addRider({ id: "rey", status: "pending_kyc", isOnline: false, location: ROSA_AT });
  w.db.addOrder({ id: "o1" });
  return w;
}

describe("DispatchService", () => {
  it("offers the job to the nearest online rider with the pay and a 30-second window", async () => {
    const w = world();
    const outcome = await w.dispatch.dispatch("o1");
    expect(outcome).toMatchObject({ kind: "offered", riderId: "rosa" });
    const [offer] = w.db.offers;
    expect(offer?.expiresAt.getTime()).toBe(w.clock.now().getTime() + 30_000);
    expect(offer?.earningsCentavos).toBe(3500);
    expect(w.messages.sent).toEqual([
      expect.objectContaining({ userId: "user-rosa", template: "rider_offer", orderId: "o1" }),
    ]);
    expect(w.db.order("o1").attempts).toBe(1);
  });

  it("never offers a job to riders who are pending approval or offline", async () => {
    const w = world();
    w.db.rider("rosa").isOnline = false;
    w.db.rider("rico").isOnline = false;
    expect(await w.dispatch.dispatch("o1")).toEqual({ kind: "flagged" });
    expect(w.db.offers).toEqual([]);
  });

  it("moves to the next rider as soon as the first declines", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    const declined = await w.dispatch.respond("rosa", "offer-1", "declined");
    expect(declined.ok).toBe(true);
    expect(w.db.offers.map((o) => [o.riderId, o.status])).toEqual([
      ["rosa", "declined"],
      ["rico", "offered"],
    ]);
  });

  it("expires unanswered offers on the next tick and offers the next rider", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    w.clock.advanceBy(31_000);
    w.db.rider("rico").locationAt = w.clock.now();
    const tick = await w.dispatch.tick();
    expect(tick).toEqual({ expired: 1, offered: 1, flagged: 0 });
    expect(w.db.offers.map((o) => [o.riderId, o.status])).toEqual([
      ["rosa", "expired"],
      ["rico", "offered"],
    ]);
  });

  it("skips a rider who would go over their cash limit on a cash order", async () => {
    const w = world();
    w.db.rider("rosa").cashHeldCentavos = 295_000;
    expect(await w.dispatch.dispatch("o1")).toMatchObject({ riderId: "rico" });
  });

  it("ignores the cash limit when the order was paid online", async () => {
    const w = world();
    w.db.rider("rosa").cashHeldCentavos = 295_000;
    w.db.order("o1").paymentMethod = "gcash";
    expect(await w.dispatch.dispatch("o1")).toMatchObject({ riderId: "rosa" });
  });

  it("tells the coordinator once when every rider declined, and keeps looking", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    await w.dispatch.respond("rosa", "offer-1", "declined");
    await w.dispatch.respond("rico", "offer-2", "declined");
    const flaggedAt = w.db.order("o1").flaggedAt;
    expect(flaggedAt).not.toBeNull();
    expect(w.logger.lines.some((e) => e.message === "dispatch.unassigned")).toBe(true);

    expect(await w.dispatch.tick()).toEqual({ expired: 0, offered: 0, flagged: 1 });
    expect(w.db.order("o1").flaggedAt).toBe(flaggedAt);

    w.db.addRider({ id: "rina", location: ROSA_AT });
    expect(await w.dispatch.tick()).toEqual({ expired: 0, offered: 1, flagged: 0 });
  });

  it("flags the order after the maximum number of offers but still offers it", async () => {
    const w = world();
    w.db.settings = { ...DEFAULT_DISPATCH_SETTINGS, maxAttempts: 1 };
    await w.dispatch.dispatch("o1");
    await w.dispatch.respond("rosa", "offer-1", "declined");
    expect(w.db.order("o1").flaggedAt).not.toBeNull();
    expect(w.db.offers.at(-1)).toMatchObject({ riderId: "rico", status: "offered" });
  });

  it("does nothing for orders that already have a rider, an open offer or are not cooking", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    expect(await w.dispatch.dispatch("o1")).toEqual({ kind: "skipped" });
    w.db.addOrder({ id: "o2", status: "placed" });
    expect(await w.dispatch.dispatch("o2")).toEqual({ kind: "skipped" });
    expect(await w.dispatch.dispatch("missing")).toEqual({ kind: "skipped" });
  });

  it("waits until shortly before the food is ready when set to start late", async () => {
    const w = world();
    w.db.settings = { ...DEFAULT_DISPATCH_SETTINGS, start: "before_ready", leadMinutes: 10 };
    w.db.order("o1").readyBy = new Date(w.clock.now().getTime() + 25 * 60_000);
    await w.dispatch.orderAccepted("o1");
    expect(w.db.offers).toEqual([]);
    w.clock.advanceBy(16 * 60_000);
    for (const r of w.db.riders) r.locationAt = w.clock.now();
    expect(await w.dispatch.tick()).toMatchObject({ offered: 1 });
  });

  it("assigns the rider who accepts in time and tells the customer", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    const accepted = await w.dispatch.respond("rosa", "offer-1", "accepted");
    expect(accepted).toEqual({ ok: true, value: { orderId: "o1" } });
    expect(w.db.order("o1")).toMatchObject({ riderId: "rosa", earningsCentavos: 3500 });
    expect(w.messages.sent.at(-1)).toMatchObject({
      userId: "customer-1",
      template: "order_rider_assigned",
    });
  });

  it("refuses offers that belong to someone else or have ended", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    const stolen = await w.dispatch.respond("rico", "offer-1", "accepted");
    expect(!stolen.ok && stolen.error.code).toBe("NOT_FOUND");
    await w.dispatch.respond("rosa", "offer-1", "accepted");
    const again = await w.dispatch.respond("rosa", "offer-1", "accepted");
    expect(!again.ok && again.error.code).toBe("CONFLICT");
  });

  it("refuses an offer accepted after its 30 seconds", async () => {
    const w = world();
    await w.dispatch.dispatch("o1");
    w.clock.advanceBy(30_000);
    const late = await w.dispatch.respond("rosa", "offer-1", "accepted");
    expect(!late.ok && late.error.code).toBe("CONFLICT");
  });

  it("keeps ticking when one order fails", async () => {
    const w = world();
    w.db.addOrder({ id: "o2" });
    const original = w.db.job.bind(w.db);
    w.db.job = (id: string) => (id === "o1" ? Promise.reject(new Error("db")) : original(id));
    expect(await w.dispatch.tick()).toMatchObject({ offered: 1 });
    expect(w.logger.lines.some((e) => e.message === "dispatch.failed")).toBe(true);
  });
});

describe("NearestAvailableStrategy", () => {
  it("picks the nearest rider who can carry the cash", () => {
    const job = {
      id: "o",
      code: "KG",
      zoneId: "z",
      merchantName: "S",
      status: "preparing" as const,
      riderId: null,
      paymentMethod: "cod" as const,
      totalCentavos: 10_000,
      pickup: ROSA_AT,
      dropoff: RICO_AT,
      attempts: 0,
      flaggedAt: null,
      readyBy: null,
      hasOpenOffer: false,
    };
    const rider = (riderId: string, distanceM: number, cashHeldCentavos = 0) => ({
      riderId,
      userId: riderId,
      distanceM,
      cashHeldCentavos,
      cashLimitCentavos: 300_000,
    });
    const strategy = new NearestAvailableStrategy();
    expect(strategy.choose(job, [rider("far", 900), rider("near", 100)])?.riderId).toBe("near");
    expect(strategy.choose(job, [rider("near", 100, 295_000), rider("far", 900)])?.riderId).toBe(
      "far",
    );
    expect(strategy.choose(job, [])).toBeNull();
  });
});

describe("DistancePayRule", () => {
  it("pays the base within the free kilometres and per started kilometre after", () => {
    const rule = new DistancePayRule();
    const job = (dropoff: { lat: number; lng: number }) =>
      ({ pickup: { lat: 14.55, lng: 121.02 }, dropoff }) as Parameters<typeof rule.payFor>[0];
    expect(rule.payFor(job({ lat: 14.551, lng: 121.02 }), DEFAULT_DISPATCH_SETTINGS)).toBe(3500);
    // ~3.3 km in a straight line → ~4.3 km by road → 3 km past the free 2 → ₱35 + ₱30.
    expect(rule.payFor(job({ lat: 14.58, lng: 121.02 }), DEFAULT_DISPATCH_SETTINGS)).toBe(6500);
  });
});

describe("parseDispatchSettings", () => {
  it("reads the admin's snake_case values and falls back on bad ones", () => {
    expect(
      parseDispatchSettings({ offer_seconds: 45, start: "before_ready", max_attempts: -1 }),
    ).toMatchObject({
      offerSeconds: 45,
      start: "before_ready",
      maxAttempts: DEFAULT_DISPATCH_SETTINGS.maxAttempts,
    });
    expect(parseDispatchSettings(null)).toEqual(DEFAULT_DISPATCH_SETTINGS);
    expect(parseDispatchSettings({ start: "whenever", avg_speed_kph: "fast" })).toEqual(
      DEFAULT_DISPATCH_SETTINGS,
    );
  });
});

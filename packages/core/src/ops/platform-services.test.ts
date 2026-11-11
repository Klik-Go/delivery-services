import { describe, expect, it } from "vitest";
import { DEFAULT_DISPATCH_SETTINGS } from "../dispatch/ports";
import { opsWorld } from "../testing";
import { checkOutline } from "./zone-outline";

const SQUARE: [number, number][] = [
  [120.15, 14.96],
  [120.17, 14.96],
  [120.17, 14.98],
  [120.15, 14.98],
];
const BOW_TIE: [number, number][] = [
  [120.15, 14.96],
  [120.17, 14.98],
  [120.17, 14.96],
  [120.15, 14.98],
];
const DISPATCH_ROLLOUT = {
  offer_seconds: 30,
  max_attempts: 5,
  max_distance_m: 5000,
  start: "accept",
  lead_minutes: 10,
  pin_threshold_centavos: 50000,
  rider_base_centavos: 3500,
  rider_per_km_centavos: 1000,
  rider_free_km: 2,
  avg_speed_kph: 20,
};

function withFees() {
  const w = opsWorld();
  w.state.zones[0] = {
    ...(w.state.zones[0] as (typeof w.state.zones)[number]),
    feeRules: [
      {
        id: "band-1",
        zoneId: "makati",
        name: "Up to 2 km",
        kind: "delivery_distance_band",
        minDistanceM: 0,
        maxDistanceM: 2000,
        minSubtotalCentavos: null,
        feeCentavos: 3900,
        priority: 10,
        isActive: true,
      },
    ],
  };
  return w;
}

describe("checkOutline", () => {
  it("accepts a simple outline, dropping a repeated closing corner and doubled corners", () => {
    const closed = [...SQUARE, SQUARE[0] as [number, number]];
    const result = checkOutline([SQUARE[0] as [number, number], ...closed]);
    expect(result).toEqual({ ok: true, ring: SQUARE });
  });

  it("refuses outlines that cross themselves, are flat or too small", () => {
    expect(checkOutline(BOW_TIE)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/crosses/) as unknown,
    });
    expect(
      checkOutline([
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/no area/) as unknown });
    expect(
      checkOutline([
        [1, 1],
        [2, 2],
        [1, 1],
      ]),
    ).toMatchObject({ ok: false });
  });
});

describe("ZoneAdminService", () => {
  it("lets coordinators look at their zones and only admins change them", async () => {
    const w = withFees();
    const mine = await w.zones.list(w.coordinator);
    expect(mine.ok && mine.value.map((z) => z.id)).toEqual(["makati"]);
    const all = await w.zones.list(w.admin);
    expect(all.ok && all.value.length).toBe(2);
    const forbidden = await w.zones.update(w.coordinator, "makati", { baseFeeCentavos: 1 });
    expect(!forbidden.ok && forbidden.error.code).toBe("FORBIDDEN");
    expect((await w.zones.list(null)).ok).toBe(false);
  });

  it("updates fees, radius and status and audits the fields", async () => {
    const w = withFees();
    const updated = await w.zones.update(w.admin, "makati", {
      baseFeeCentavos: 4500,
      isActive: false,
      perKmCentavos: 900,
    });
    expect(updated.ok && updated.value).toMatchObject({ baseFeeCentavos: 4500, isActive: false });
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "zone.update",
      meta: { baseFeeCentavos: 4500 },
    });
    expect((await w.zones.update(w.admin, "nowhere", { name: "X" })).ok).toBe(false);
    const radius = await w.zones.update(w.admin, "makati", { maxRadiusKm: 30 });
    expect(!radius.ok && radius.error.message).toMatch(/city zone serves 8–15 km/);
    expect((await w.zones.update(w.admin, "makati", { maxRadiusKm: 12 })).ok).toBe(true);
  });

  it("redraws a zone, refusing outlines that cross themselves", async () => {
    const w = withFees();
    const drawn = await w.zones.setArea(w.admin, "makati", SQUARE);
    expect(drawn.ok && drawn.value.ring).toEqual(SQUARE);
    const bowTie = await w.zones.setArea(w.admin, "makati", BOW_TIE);
    expect(!bowTie.ok && bowTie.error.code).toBe("VALIDATION_FAILED");
    expect((await w.zones.setArea(w.admin, "nowhere", SQUARE)).ok).toBe(false);
    expect((await w.zones.setArea(w.coordinator, "makati", SQUARE)).ok).toBe(false);
  });

  it("names a coordinator only after they were invited for that zone", async () => {
    const w = withFees();
    const notInvited = await w.zones.setCoordinator(w.admin, "makati", "cora");
    expect(!notInvited.ok && notInvited.error.code).toBe("VALIDATION_FAILED");
    w.state.coordinatorZones.set("cora", ["makati"]);
    const named = await w.zones.setCoordinator(w.admin, "makati", "cora");
    expect(named.ok && named.value.coordinatorId).toBe("cora");
    expect(w.state.audit.at(-1)).toMatchObject({ action: "zone.coordinator" });
    expect((await w.zones.setCoordinator(w.admin, "nowhere", null)).ok).toBe(false);
    expect((await w.zones.setCoordinator(w.coordinator, "makati", null)).ok).toBe(false);
  });

  it("changes and adds fee rules, keeping bands in order", async () => {
    const w = withFees();
    const changed = await w.zones.updateFeeRule(w.admin, "band-1", { feeCentavos: 4500 });
    expect(changed.ok).toBe(true);
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "fee_rule.update",
      meta: { feeBefore: 3900, feeAfter: 4500 },
    });
    const backwards = await w.zones.updateFeeRule(w.admin, "band-1", { maxDistanceM: 0 });
    expect(!backwards.ok && backwards.error.code).toBe("VALIDATION_FAILED");
    expect((await w.zones.updateFeeRule(w.admin, "missing", { feeCentavos: 1 })).ok).toBe(false);
    expect((await w.zones.updateFeeRule(w.coordinator, "band-1", { feeCentavos: 1 })).ok).toBe(
      false,
    );
    const added = await w.zones.createFeeRule(w.admin, "makati", {
      name: "Service fee",
      kind: "service_fee",
      minDistanceM: null,
      maxDistanceM: null,
      minSubtotalCentavos: null,
      feeCentavos: 500,
      priority: 0,
      isActive: true,
    });
    expect(added.ok).toBe(true);
    expect(w.state.audit.at(-1)?.action).toBe("fee_rule.create");
    const nowhere = await w.zones.createFeeRule(w.admin, "nowhere", {
      name: "X",
      kind: "service_fee",
      minDistanceM: null,
      maxDistanceM: null,
      minSubtotalCentavos: null,
      feeCentavos: 1,
      priority: 0,
      isActive: true,
    });
    expect(!nowhere.ok && nowhere.error.code).toBe("NOT_FOUND");
  });
});

describe("MerchantAdminService", () => {
  function stores() {
    const w = opsWorld();
    w.state.merchants.push(
      {
        id: "silog",
        name: "Silog Express",
        slug: "silog-express",
        zoneId: "makati",
        status: "active",
        statusReason: null,
        commissionBps: 2000,
        nextCommissionBps: null,
        nextCommissionFrom: null,
        foundingCommissionUntil: null,
      },
      {
        id: "new",
        name: "New Store",
        slug: "new",
        zoneId: "pampanga",
        status: "pending",
        statusReason: null,
        commissionBps: 2000,
        nextCommissionBps: null,
        nextCommissionFrom: null,
        foundingCommissionUntil: null,
      },
    );
    return w;
  }

  it("suspends and reactivates a store with a reason", async () => {
    const w = stores();
    const suspended = await w.merchants.setStatus(w.admin, "silog", {
      status: "suspended",
      reason: "Food safety",
    });
    expect(suspended.ok && suspended.value).toMatchObject({
      status: "suspended",
      statusReason: "Food safety",
    });
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "merchant.suspend",
      meta: { reason: "Food safety" },
    });
    const twice = await w.merchants.setStatus(w.admin, "silog", {
      status: "suspended",
      reason: "Again",
    });
    expect(!twice.ok && twice.error.code).toBe("CONFLICT");
    await w.merchants.setStatus(w.admin, "silog", { status: "active" });
    expect(w.state.audit.at(-1)?.action).toBe("merchant.reactivate");
    const pending = await w.merchants.setStatus(w.admin, "new", {
      status: "suspended",
      reason: "x",
    });
    expect(!pending.ok && pending.error.message).toMatch(/application/);
    expect((await w.merchants.setStatus(w.admin, "ghost", { status: "active" })).ok).toBe(false);
    expect((await w.merchants.setStatus(w.coordinator, "silog", { status: "active" })).ok).toBe(
      false,
    );
  });

  it("schedules a commission for later or applies it now", async () => {
    const w = stores();
    const tomorrow = new Date(w.clock.now().getTime() + 86_400_000);
    const later = await w.merchants.setCommission(w.admin, "silog", {
      commissionBps: 1500,
      effectiveFrom: tomorrow,
      reason: "Partner deal",
    });
    expect(later.ok && later.value).toMatchObject({
      commissionBps: 2000,
      nextCommissionBps: 1500,
      nextCommissionFrom: tomorrow,
    });
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "merchant.commission",
      meta: { commissionBps: 1500 },
    });
    const now = await w.merchants.setCommission(w.admin, "silog", {
      commissionBps: 1800,
      effectiveFrom: w.clock.now(),
      reason: "Now",
    });
    expect(now.ok && now.value).toMatchObject({ commissionBps: 1800, nextCommissionBps: null });
    expect(
      (
        await w.merchants.setCommission(w.admin, "ghost", {
          commissionBps: 1,
          effectiveFrom: tomorrow,
          reason: "x",
        })
      ).ok,
    ).toBe(false);
  });

  it("shows coordinators their zone's stores", async () => {
    const w = stores();
    const mine = await w.merchants.list(w.coordinator);
    expect(mine.ok && mine.value.map((m) => m.id)).toEqual(["silog"]);
    expect((await w.merchants.list(w.customer)).ok).toBe(false);
  });
});

describe("SettingsService", () => {
  function flags() {
    const w = opsWorld();
    w.state.flagsList.push(
      {
        key: "dispatch",
        description: "Dispatch",
        enabled: true,
        rollout: DISPATCH_ROLLOUT,
        updatedAt: w.clock.now(),
      },
      { key: "beta", description: null, enabled: false, rollout: {}, updatedAt: w.clock.now() },
    );
    return w;
  }

  it("checks known settings before saving and audits the change", async () => {
    const w = flags();
    const saved = await w.settings.updateFlag(w.admin, "dispatch", {
      enabled: true,
      rollout: { ...DISPATCH_ROLLOUT, offer_seconds: 45 },
    });
    expect(saved.ok && saved.value.rollout).toMatchObject({ offer_seconds: 45 });
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "feature_flag.update",
      meta: { key: "dispatch" },
    });
    const tooShort = await w.settings.updateFlag(w.admin, "dispatch", {
      enabled: true,
      rollout: { ...DISPATCH_ROLLOUT, offer_seconds: 2 },
    });
    expect(!tooShort.ok && tooShort.error.code).toBe("VALIDATION_FAILED");
    expect(DEFAULT_DISPATCH_SETTINGS.offerSeconds).toBe(30);
  });

  it("lets other flags be switched freely, for admins only", async () => {
    const w = flags();
    expect(
      (await w.settings.updateFlag(w.admin, "beta", { enabled: true, rollout: { anything: 1 } }))
        .ok,
    ).toBe(true);
    expect((await w.settings.updateFlag(w.admin, "ghost", { enabled: true, rollout: {} })).ok).toBe(
      false,
    );
    const coordinator = await w.settings.updateFlag(w.coordinator, "beta", {
      enabled: false,
      rollout: {},
    });
    expect(!coordinator.ok && coordinator.error.code).toBe("FORBIDDEN");
    const list = await w.settings.flags(w.admin);
    expect(list.ok && list.value.length).toBe(2);
    expect((await w.settings.flags({ ...w.admin, aal: "aal1" })).ok).toBe(false);
  });
});

describe("StaffAdminService", () => {
  it("revokes a staff role (audited) but never the admin's own", async () => {
    const w = opsWorld();
    const grant = (id: string, userId: string, role: "admin" | "coordinator") => ({
      id,
      userId,
      name: null,
      email: null,
      role,
      merchantId: null,
      merchantName: null,
      zoneId: role === "coordinator" ? "pampanga" : null,
      zoneName: null,
      createdAt: w.clock.now(),
    });
    w.state.grants.push(
      grant("g1", "coord-pampanga", "coordinator"),
      grant("g2", "admin-1", "admin"),
    );
    const list = await w.staff.list(w.admin);
    expect(list.ok && list.value.length).toBe(2);
    const revoked = await w.staff.revoke(w.admin, "g1");
    expect(revoked).toEqual({ ok: true, value: { grantId: "g1" } });
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "role.revoke",
      meta: { role: "coordinator", zoneId: "pampanga" },
    });
    const self = await w.staff.revoke(w.admin, "g2");
    expect(!self.ok && self.error.code).toBe("CONFLICT");
    expect((await w.staff.revoke(w.admin, "g1")).ok).toBe(false);
    expect((await w.staff.revoke(w.coordinator, "g2")).ok).toBe(false);
  });
});

import type { MerchantApplicationInput } from "@klikgo/types";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import {
  FakeClock,
  FakeStaffAccountGateway,
  InMemoryMerchantApplicationRepository,
  InMemoryRateLimiter,
  InMemoryZoneLocator,
  MemoryLogger,
  sessionUser,
} from "../testing";
import { MerchantOnboardingService } from "./merchant-onboarding-service";

const NOW = new Date("2026-11-05T02:00:00.000Z");
const inPilot = { lat: 14.6, lng: 120.98 };
const outside = { lat: 10.3, lng: 123.9 };

function form(overrides: Partial<MerchantApplicationInput> = {}): MerchantApplicationInput {
  return {
    businessName: "Lugaw ni Mang Ben",
    ownerName: "Ben Santos",
    phone: "0917 123 4567",
    email: "Ben@Example.test",
    category: "food",
    barangay: "Poblacion",
    city: "Placeholder City",
    location: inPilot,
    ...overrides,
  };
}

describe("MerchantOnboardingService", () => {
  let applications: InMemoryMerchantApplicationRepository;
  let accounts: FakeStaffAccountGateway;
  let rateLimiter: InMemoryRateLimiter;
  let service: MerchantOnboardingService;
  const admin = sessionUser("admin-1", [{ role: "admin" }]);
  const coordinator = sessionUser("coord-1", [{ role: "coordinator", zoneId: "zone-pilot" }]);

  beforeEach(() => {
    applications = new InMemoryMerchantApplicationRepository();
    applications.zoneNames.set("zone-pilot", "Pilot Zone");
    const zones = new InMemoryZoneLocator();
    zones.zones.push({
      id: "zone-pilot",
      name: "Pilot Zone",
      south: 14.58,
      west: 120.96,
      north: 14.62,
      east: 121.0,
    });
    accounts = new FakeStaffAccountGateway();
    rateLimiter = new InMemoryRateLimiter();
    service = new MerchantOnboardingService({
      applications,
      zones,
      accounts,
      rateLimiter,
      authz: new AuthorizationService(),
      clock: new FakeClock(NOW),
      logger: new MemoryLogger(),
    });
  });

  async function applied(overrides: Partial<MerchantApplicationInput> = {}): Promise<string> {
    const receipt = await service.apply(form(overrides), { clientIp: "203.0.113.5" });
    if (!receipt.ok || !receipt.value.applicationId) throw new Error("apply failed");
    return receipt.value.applicationId;
  }

  it("stores an application with a normalised phone and email and finds its zone", async () => {
    const receipt = await service.apply(form(), { clientIp: "203.0.113.5" });

    expect(receipt).toMatchObject({ ok: true, value: { inArea: true, zoneName: "Pilot Zone" } });
    const [stored] = [...applications.applications.values()];
    expect(stored).toMatchObject({
      phone: "+639171234567",
      email: "ben@example.test",
      zoneId: "zone-pilot",
      addressLine: null,
    });
  });

  it("keeps an application outside every zone but tells the applicant we are not there yet", async () => {
    const receipt = await service.apply(form({ location: outside }), { clientIp: "203.0.113.5" });

    expect(receipt).toMatchObject({ ok: true, value: { inArea: false, zoneName: null } });
    expect(applications.applications.size).toBe(1);
  });

  it("refuses a landline or foreign number", async () => {
    const receipt = await service.apply(form({ phone: "02 8123 4567" }), {
      clientIp: "203.0.113.5",
    });
    expect(!receipt.ok && receipt.error.code).toBe("VALIDATION_FAILED");
  });

  it("silently drops a form a bot filled in, storing nothing", async () => {
    const receipt = await service.apply(form({ website: "http://spam.example" }), {
      clientIp: "203.0.113.5",
    });
    expect(receipt).toMatchObject({ ok: true, value: { applicationId: null } });
    expect(applications.applications.size).toBe(0);
  });

  it("refuses the sixth application from one network within an hour", async () => {
    for (let i = 0; i < 5; i += 1) await applied();
    const sixth = await service.apply(form(), { clientIp: "203.0.113.5" });
    expect(!sixth.ok && sixth.error.code).toBe("RATE_LIMITED");
    const otherNetwork = await service.apply(form(), { clientIp: "203.0.113.6" });
    expect(otherNetwork.ok).toBe(true);
  });

  it("shows admins every pending application and coordinators only their zone's", async () => {
    await applied();
    await applied({ businessName: "Far Away", location: outside });

    const forAdmin = await service.listApplications(admin);
    const forCoordinator = await service.listApplications(coordinator);
    const forCustomer = await service.listApplications(sessionUser("c", [{ role: "customer" }]));

    expect(forAdmin.ok && forAdmin.value.map((a) => a.businessName)).toEqual([
      "Lugaw ni Mang Ben",
      "Far Away",
    ]);
    expect(forCoordinator.ok && forCoordinator.value.map((a) => a.businessName)).toEqual([
      "Lugaw ni Mang Ben",
    ]);
    expect(!forCustomer.ok && forCustomer.error.code).toBe("FORBIDDEN");
  });

  it("approves a founding partner: owner account, 20% after a 90-day 0% period, invite link", async () => {
    const id = await applied();

    const approved = await service.approve(admin, id, {
      commissionBps: 2000,
      foundingPartner: true,
    });

    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.slug).toBe("lugaw-ni-mang-ben");
    expect(approved.value.invitePath).toMatch(
      /^\/auth\/confirm\?token_hash=.+&type=invite&next=%2Fauth%2Fset-password$/,
    );
    expect(accounts.invited).toEqual(["ben@example.test"]);
    const [approval] = applications.approvals;
    expect(approval).toMatchObject({
      reviewerId: "admin-1",
      commissionBps: 2000,
      foundingCommissionUntil: new Date("2027-02-03T02:00:00.000Z"),
      invite: { email: "ben@example.test", expiresAt: new Date("2026-11-12T02:00:00.000Z") },
    });
  });

  it("approves a regular partner without a founding period", async () => {
    const id = await applied();
    await service.approve(admin, id, { commissionBps: 1500, foundingPartner: false });
    expect(applications.approvals[0]).toMatchObject({
      commissionBps: 1500,
      foundingCommissionUntil: null,
    });
  });

  it("cannot approve a store outside every zone, or twice", async () => {
    const far = await applied({ location: outside });
    const near = await applied();

    const outOfArea = await service.approve(admin, far, {
      commissionBps: 2000,
      foundingPartner: false,
    });
    await service.approve(admin, near, { commissionBps: 2000, foundingPartner: false });
    const again = await service.approve(admin, near, {
      commissionBps: 2000,
      foundingPartner: false,
    });

    expect(!outOfArea.ok && outOfArea.error.message).toMatch(/not in this store's area yet/);
    expect(!again.ok && again.error.code).toBe("CONFLICT");
    expect(accounts.invited).toHaveLength(1);
  });

  it("only lets admins with their second factor approve or reject", async () => {
    const id = await applied();
    const terms = { commissionBps: 2000, foundingPartner: false };

    const byCoordinator = await service.approve(coordinator, id, terms);
    const withoutTotp = await service.approve(
      sessionUser("admin-2", [{ role: "admin" }], "aal1"),
      id,
      terms,
    );
    const anonymous = await service.reject(null, id, "No");

    expect(!byCoordinator.ok && byCoordinator.error.code).toBe("FORBIDDEN");
    expect(!withoutTotp.ok && withoutTotp.error.code).toBe("FORBIDDEN");
    expect(!anonymous.ok && anonymous.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an application with a reason, once", async () => {
    const id = await applied();

    const first = await service.reject(admin, id, "Mobile cart, no fixed address");
    const second = await service.reject(admin, id, "Again");
    const missing = await service.reject(admin, "nope", "x");

    expect(first.ok).toBe(true);
    expect(applications.applications.get(id)).toMatchObject({
      status: "rejected",
      rejectionReason: "Mobile cart, no fixed address",
    });
    expect(!second.ok && second.error.code).toBe("CONFLICT");
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
  });

  it("reports a missing application and passes on account errors", async () => {
    const missing = await service.approve(admin, "nope", {
      commissionBps: 2000,
      foundingPartner: false,
    });
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");

    const id = await applied();
    accounts.existingEmails.add("ben@example.test");
    const taken = await service.approve(admin, id, {
      commissionBps: 2000,
      foundingPartner: false,
    });
    expect(!taken.ok && taken.error.code).toBe("CONFLICT");
  });
});

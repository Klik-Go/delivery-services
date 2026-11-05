import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeClock,
  FakeStaffAccountGateway,
  InMemoryInviteRepository,
  InMemoryUserRoleRepository,
  MemoryLogger,
} from "../testing";
import { AuthorizationService } from "./authorization-service";
import { InviteService } from "./invite-service";
import type { SessionUser } from "./session-user";

const admin: SessionUser = {
  id: "admin-1",
  phone: null,
  email: "ada@example.test",
  aal: "aal2",
  roles: [{ role: "admin", merchantId: null, zoneId: null }],
};

describe("InviteService", () => {
  let accounts: FakeStaffAccountGateway;
  let roles: InMemoryUserRoleRepository;
  let invites: InMemoryInviteRepository;
  let service: InviteService;

  beforeEach(() => {
    accounts = new FakeStaffAccountGateway();
    roles = new InMemoryUserRoleRepository();
    invites = new InMemoryInviteRepository();
    service = new InviteService({
      accounts,
      roles,
      invites,
      authz: new AuthorizationService(),
      clock: new FakeClock(new Date("2026-11-05T00:00:00.000Z")),
      logger: new MemoryLogger(),
    });
  });

  it("invites a merchant owner: creates the account, grants the scoped role and returns the invite link", async () => {
    const result = await service.inviteStaff(admin, {
      email: "Nena@Example.test",
      role: "merchant_owner",
      merchantId: "m-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invitePath).toMatch(
      /^\/auth\/confirm\?token_hash=[^&]+&type=invite&next=%2Fauth%2Fset-password$/,
    );
    expect(accounts.invited).toEqual(["nena@example.test"]);
    expect(roles.grants).toEqual([
      {
        userId: result.value.userId,
        grant: { role: "merchant_owner", merchantId: "m-1", zoneId: null },
        grantedBy: "admin-1",
      },
    ]);
    expect(invites.records[0]).toMatchObject({
      email: "nena@example.test",
      role: "merchant_owner",
      merchantId: "m-1",
      invitedBy: "admin-1",
      expiresAt: new Date("2026-11-12T00:00:00.000Z"),
    });
  });

  it("refuses anyone who is not an admin with the second factor", async () => {
    const customer: SessionUser = {
      ...admin,
      roles: [{ role: "customer", merchantId: null, zoneId: null }],
    };
    expect(
      (await service.inviteStaff(customer, { email: "x@example.test", role: "admin" })).ok,
    ).toBe(false);
    const noMfa = await service.inviteStaff(
      { ...admin, aal: "aal1" },
      { email: "x@example.test", role: "admin" },
    );
    expect(!noMfa.ok && noMfa.error.code).toBe("FORBIDDEN");
    const anonymous = await service.inviteStaff(null, { email: "x@example.test", role: "admin" });
    expect(!anonymous.ok && anonymous.error.code).toBe("UNAUTHORIZED");
    expect(accounts.invited).toEqual([]);
  });

  it("requires a merchant for merchant roles and a zone for coordinators", async () => {
    const noMerchant = await service.inviteStaff(admin, {
      email: "s@example.test",
      role: "merchant_staff",
    });
    expect(!noMerchant.ok && noMerchant.error.code).toBe("VALIDATION_FAILED");
    const noZone = await service.inviteStaff(admin, {
      email: "c@example.test",
      role: "coordinator",
    });
    expect(!noZone.ok && noZone.error.code).toBe("VALIDATION_FAILED");
    const strayScope = await service.inviteStaff(admin, {
      email: "a@example.test",
      role: "admin",
      merchantId: "m-1",
    });
    expect(!strayScope.ok && strayScope.error.code).toBe("VALIDATION_FAILED");
  });

  it("reports an email that already has an account as a conflict", async () => {
    accounts.existingEmails.add("taken@example.test");
    const result = await service.inviteStaff(admin, { email: "taken@example.test", role: "admin" });
    expect(!result.ok && result.error.code).toBe("CONFLICT");
  });
});

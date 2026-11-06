import { describe, expect, it } from "vitest";
import { AuthorizationService } from "./authorization-service";
import type { RoleGrant, SessionUser } from "./session-user";

const authz = new AuthorizationService();

function user(roles: RoleGrant[], aal: "aal1" | "aal2" = "aal1", id = "u-1"): SessionUser {
  return { id, phone: null, email: null, roles, aal };
}
const customer: RoleGrant = { role: "customer", merchantId: null, zoneId: null };
const rider: RoleGrant = { role: "rider", merchantId: null, zoneId: null };
const owner: RoleGrant = { role: "merchant_owner", merchantId: "m-1", zoneId: null };
const staff: RoleGrant = { role: "merchant_staff", merchantId: "m-1", zoneId: null };
const coordinator: RoleGrant = { role: "coordinator", merchantId: null, zoneId: "z-1" };
const admin: RoleGrant = { role: "admin", merchantId: null, zoneId: null };

describe("AuthorizationService", () => {
  it("asks visitors who are not signed in to sign in", () => {
    expect(authz.decide(null, { type: "surface.open", surface: "customer" })).toEqual({
      allowed: false,
      reason: "unauthenticated",
    });
  });

  it("lets each role open its own surface", () => {
    expect(authz.can(user([customer]), { type: "surface.open", surface: "customer" })).toBe(true);
    expect(authz.can(user([customer, rider]), { type: "surface.open", surface: "rider" })).toBe(
      true,
    );
    expect(
      authz.can(user([customer, owner], "aal2"), { type: "surface.open", surface: "merchant" }),
    ).toBe(true);
    expect(
      authz.can(user([customer, staff], "aal2"), { type: "surface.open", surface: "merchant" }),
    ).toBe(true);
    expect(
      authz.can(user([customer, admin], "aal2"), { type: "surface.open", surface: "admin" }),
    ).toBe(true);
    expect(
      authz.can(user([customer, coordinator], "aal2"), { type: "surface.open", surface: "admin" }),
    ).toBe(true);
  });

  it("forbids a rider from the merchant dashboard and the admin console", () => {
    for (const surface of ["merchant", "admin"] as const) {
      expect(
        authz.decide(user([customer, rider], "aal2"), { type: "surface.open", surface }),
      ).toEqual({
        allowed: false,
        reason: "forbidden",
      });
    }
  });

  it("requires the second factor (AAL2) on staff surfaces, even for the right role", () => {
    expect(
      authz.decide(user([customer, owner], "aal1"), { type: "surface.open", surface: "merchant" }),
    ).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(authz.decide(user([admin], "aal1"), { type: "surface.open", surface: "admin" })).toEqual(
      {
        allowed: false,
        reason: "mfa_required",
      },
    );
  });

  it("lets a merchant owner who also orders use the customer app without the second factor", () => {
    expect(
      authz.can(user([customer, owner], "aal1"), { type: "surface.open", surface: "customer" }),
    ).toBe(true);
  });

  it("lets customers place orders, without the second factor", () => {
    expect(authz.can(user([customer]), { type: "order.place" })).toBe(true);
    expect(authz.decide(user([rider]), { type: "order.place" })).toEqual({
      allowed: false,
      reason: "forbidden",
    });
  });

  it("lets admins refund any order and coordinators only their zone's, both with AAL2", () => {
    const refund = (zoneId: string) => ({ type: "order.refund", zoneId }) as const;
    expect(authz.can(user([admin], "aal2"), refund("z-9"))).toBe(true);
    expect(authz.can(user([coordinator], "aal2"), refund("z-1"))).toBe(true);
    expect(authz.can(user([coordinator], "aal2"), refund("z-9"))).toBe(false);
    expect(authz.decide(user([admin]), refund("z-1"))).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(authz.can(user([customer, owner], "aal2"), refund("z-1"))).toBe(false);
  });

  it("shows an order to its customer, its store's staff, its zone's coordinator and admins", () => {
    const view = {
      type: "order.view",
      customerId: "u-1",
      merchantId: "m-1",
      zoneId: "z-1",
    } as const;
    expect(authz.can(user([customer]), view)).toBe(true);
    expect(authz.can(user([customer], "aal1", "u-2"), view)).toBe(false);
    expect(authz.can(user([admin], "aal2", "u-2"), view)).toBe(true);
    expect(authz.can(user([coordinator], "aal2", "u-2"), view)).toBe(true);
    expect(authz.can(user([owner], "aal2", "u-2"), view)).toBe(true);
    expect(authz.decide(user([owner], "aal1", "u-2"), view)).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(authz.can(user([owner], "aal2", "u-2"), { ...view, merchantId: "m-9" })).toBe(false);
    expect(authz.can(user([coordinator], "aal2", "u-2"), { ...view, zoneId: "z-9" })).toBe(false);
  });

  it("only lets admins (with AAL2) invite staff", () => {
    expect(authz.can(user([admin], "aal2"), { type: "staff.invite" })).toBe(true);
    expect(authz.decide(user([admin], "aal1"), { type: "staff.invite" })).toEqual({
      allowed: false,
      reason: "mfa_required",
    });
    expect(authz.decide(user([coordinator], "aal2"), { type: "staff.invite" })).toEqual({
      allowed: false,
      reason: "forbidden",
    });
    expect(authz.decide(user([customer]), { type: "staff.invite" })).toEqual({
      allowed: false,
      reason: "forbidden",
    });
  });

  it("scopes merchant management to the merchant's own team (and admins)", () => {
    expect(authz.can(user([owner], "aal2"), { type: "merchant.manage", merchantId: "m-1" })).toBe(
      true,
    );
    expect(authz.can(user([owner], "aal2"), { type: "merchant.manage", merchantId: "m-2" })).toBe(
      false,
    );
    expect(authz.can(user([admin], "aal2"), { type: "merchant.manage", merchantId: "m-2" })).toBe(
      true,
    );
  });

  it("sends people to their main surface after sign-in", () => {
    expect(authz.landingPath(user([customer]))).toBe("/");
    expect(authz.landingPath(user([customer, rider]))).toBe("/rider");
    expect(authz.landingPath(user([customer, staff]))).toBe("/merchant");
    expect(authz.landingPath(user([coordinator]))).toBe("/admin");
    expect(authz.landingPath(user([owner, admin]))).toBe("/admin");
  });

  it("treats merchant, coordinator and admin roles as staff (they need TOTP)", () => {
    expect(authz.isStaff(user([customer, rider]))).toBe(false);
    expect(authz.isStaff(user([customer, staff]))).toBe(true);
    expect(authz.isStaff(user([coordinator]))).toBe(true);
  });
});

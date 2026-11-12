import type { AppRole } from "@klikgo/types";
import { STAFF_ROLES, type SessionUser } from "./session-user";

/** The four app surfaces (route groups) of docs/ARCHITECTURE.md §5. */
export type Surface = "customer" | "rider" | "merchant" | "admin";

/** Something a user may try to do. */
export type Action =
  | { readonly type: "surface.open"; readonly surface: Surface }
  | { readonly type: "staff.invite" }
  | { readonly type: "merchant.manage"; readonly merchantId: string }
  | { readonly type: "merchant.settings"; readonly merchantId: string }
  | { readonly type: "merchant.applications.view" }
  | { readonly type: "merchant.applications.review" }
  | { readonly type: "order.place" }
  | { readonly type: "order.refund"; readonly zoneId: string }
  /** Run a zone's operations: orders, riders and KYC (admins, or that zone's coordinator). */
  | { readonly type: "ops.zone"; readonly zoneId: string }
  /** Platform-wide settings, zones, stores and staff (admins only). */
  | { readonly type: "ops.platform" }
  | {
      readonly type: "order.view";
      readonly customerId: string;
      readonly merchantId: string;
      readonly zoneId: string;
    };

/** Result of an authorization check, with the reason when refused. */
export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "unauthenticated" | "mfa_required" | "forbidden" };

interface Rule {
  readonly roles: readonly AppRole[];
  readonly requiresMfa: boolean;
}

const SURFACE_RULES: Readonly<Record<Surface, Rule>> = {
  customer: { roles: ["customer"], requiresMfa: false },
  rider: { roles: ["rider"], requiresMfa: false },
  merchant: { roles: ["merchant_owner", "merchant_staff"], requiresMfa: true },
  admin: { roles: ["admin", "coordinator"], requiresMfa: true },
};

const ALLOWED: AuthorizationDecision = { allowed: true };

/**
 * Decides who may do what, from the roles in user_roles and the session's assurance level.
 * Pure and synchronous so route guards, API handlers and services share one rulebook.
 */
export class AuthorizationService {
  /** Full decision with the reason for a refusal (sign in / verify TOTP / forbidden). */
  decide(user: SessionUser | null, action: Action): AuthorizationDecision {
    if (!user) return { allowed: false, reason: "unauthenticated" };
    switch (action.type) {
      case "surface.open":
        return this.check(user, SURFACE_RULES[action.surface], () => true);
      case "staff.invite":
        return this.check(user, { roles: ["admin"], requiresMfa: true }, () => true);
      case "merchant.manage":
        return this.check(
          user,
          { roles: ["admin", "merchant_owner", "merchant_staff"], requiresMfa: true },
          (role, merchantId) => role === "admin" || merchantId === action.merchantId,
        );
      case "merchant.settings":
        return this.check(
          user,
          { roles: ["admin", "merchant_owner"], requiresMfa: true },
          (role, merchantId) => role === "admin" || merchantId === action.merchantId,
        );
      case "merchant.applications.view":
        return this.check(user, { roles: ["admin", "coordinator"], requiresMfa: true }, () => true);
      case "merchant.applications.review":
        return this.check(user, { roles: ["admin"], requiresMfa: true }, () => true);
      case "order.place":
        return this.check(user, { roles: ["customer"], requiresMfa: false }, () => true);
      case "order.refund":
        return this.check(
          user,
          { roles: ["admin", "coordinator"], requiresMfa: true },
          (role, _merchantId, zoneId) => role === "admin" || zoneId === action.zoneId,
        );
      case "ops.zone":
        return this.check(
          user,
          { roles: ["admin", "coordinator"], requiresMfa: true },
          (role, _merchantId, zoneId) => role === "admin" || zoneId === action.zoneId,
        );
      case "ops.platform":
        return this.check(user, { roles: ["admin"], requiresMfa: true }, () => true);
      case "order.view":
        // The customer sees their own order; staff see their store's or zone's (with TOTP).
        if (user.id === action.customerId) return ALLOWED;
        return this.check(
          user,
          {
            roles: ["admin", "coordinator", "merchant_owner", "merchant_staff"],
            requiresMfa: true,
          },
          (role, merchantId, zoneId) =>
            role === "admin" ||
            (role === "coordinator" && zoneId === action.zoneId) ||
            merchantId === action.merchantId,
        );
    }
  }

  /** True when {@link decide} allows the action. */
  can(user: SessionUser | null, action: Action): boolean {
    return this.decide(user, action).allowed;
  }

  /** Stores this person works for (owner or staff), in a stable order. */
  merchantIdsOf(user: SessionUser): string[] {
    const ids = user.roles
      .filter((grant) => grant.role === "merchant_owner" || grant.role === "merchant_staff")
      .map((grant) => grant.merchantId)
      .filter((id): id is string => id !== null);
    return [...new Set(ids)].sort();
  }

  /** Zones this person coordinates. */
  zoneIdsOf(user: SessionUser): string[] {
    return user.roles
      .filter((grant) => grant.role === "coordinator" && grant.zoneId !== null)
      .map((grant) => grant.zoneId as string);
  }

  /** True for merchant, coordinator and admin users (who must use TOTP). */
  isStaff(user: SessionUser): boolean {
    return user.roles.some((grant) => STAFF_ROLES.includes(grant.role));
  }

  /** Where to send someone after signing in: their most privileged surface. */
  landingPath(user: SessionUser): string {
    const has = (...roles: AppRole[]): boolean =>
      user.roles.some((grant) => roles.includes(grant.role));
    if (has("admin", "coordinator")) return "/admin";
    if (has("merchant_owner", "merchant_staff")) return "/merchant";
    if (has("rider")) return "/rider";
    return "/";
  }

  private check(
    user: SessionUser,
    rule: Rule,
    scopeMatches: (role: AppRole, merchantId: string | null, zoneId: string | null) => boolean,
  ): AuthorizationDecision {
    const hasRole = user.roles.some(
      (grant) =>
        rule.roles.includes(grant.role) && scopeMatches(grant.role, grant.merchantId, grant.zoneId),
    );
    if (!hasRole) return { allowed: false, reason: "forbidden" };
    if (rule.requiresMfa && user.aal !== "aal2") return { allowed: false, reason: "mfa_required" };
    return ALLOWED;
  }
}

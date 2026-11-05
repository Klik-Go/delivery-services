import type { AppRole } from "@klikgo/types";
import { STAFF_ROLES, type SessionUser } from "./session-user";

/** The four app surfaces (route groups) of docs/ARCHITECTURE.md §5. */
export type Surface = "customer" | "rider" | "merchant" | "admin";

/** Something a user may try to do. */
export type Action =
  | { readonly type: "surface.open"; readonly surface: Surface }
  | { readonly type: "staff.invite" }
  | { readonly type: "merchant.manage"; readonly merchantId: string };

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
    }
  }

  /** True when {@link decide} allows the action. */
  can(user: SessionUser | null, action: Action): boolean {
    return this.decide(user, action).allowed;
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
    scopeMatches: (role: AppRole, merchantId: string | null) => boolean,
  ): AuthorizationDecision {
    const hasRole = user.roles.some(
      (grant) => rule.roles.includes(grant.role) && scopeMatches(grant.role, grant.merchantId),
    );
    if (!hasRole) return { allowed: false, reason: "forbidden" };
    if (rule.requiresMfa && user.aal !== "aal2") return { allowed: false, reason: "mfa_required" };
    return ALLOWED;
  }
}

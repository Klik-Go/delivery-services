import type { AppRole } from "@klikgo/types";

/** A role the user holds, with the merchant or zone it is scoped to. */
export interface RoleGrant {
  readonly role: AppRole;
  readonly merchantId: string | null;
  readonly zoneId: string | null;
}

/** Supabase Auth assurance level: aal2 means the second factor (TOTP) was verified this session. */
export type AssuranceLevel = "aal1" | "aal2";

/**
 * The signed-in person as the server sees them. Roles are always read from the database
 * (user_roles), never from the browser or JWT claims.
 */
export interface SessionUser {
  readonly id: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly roles: readonly RoleGrant[];
  readonly aal: AssuranceLevel;
}

/** Roles that work in staff surfaces and therefore must use TOTP (docs/BUILD_PLAN.md §5). */
export const STAFF_ROLES: readonly AppRole[] = [
  "merchant_owner",
  "merchant_staff",
  "coordinator",
  "admin",
];

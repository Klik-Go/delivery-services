import type { RoleGrant, SessionUser } from "../auth/session-user";

/** A signed-in person with the given role grants (AAL2 unless stated) for unit tests. */
export function sessionUser(
  id: string,
  roles: readonly Partial<RoleGrant>[],
  aal: SessionUser["aal"] = "aal2",
): SessionUser {
  return {
    id,
    phone: null,
    email: `${id}@example.test`,
    aal,
    roles: roles.map((grant) => ({
      role: grant.role ?? "customer",
      merchantId: grant.merchantId ?? null,
      zoneId: grant.zoneId ?? null,
    })),
  };
}

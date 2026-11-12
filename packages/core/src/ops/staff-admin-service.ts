import type { SessionUser } from "../auth/session-user";
import { ConflictError, NotFoundError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ConsoleAccess } from "./console-access";
import type { IStaffRepository, StaffGrant } from "./ports";

/**
 * Staff access (admins): who holds which store, zone or admin role, and revoking it. New staff
 * join by invite only (Phase 2 InviteService). Revoked roles stop working on the next request,
 * because roles are always read from the database.
 */
export class StaffAdminService {
  constructor(private readonly deps: { access: ConsoleAccess; staff: IStaffRepository }) {}

  async list(user: SessionUser | null): Promise<Result<StaffGrant[], AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    return ok(await this.deps.staff.staff());
  }

  async revoke(
    user: SessionUser | null,
    grantId: string,
  ): Promise<Result<{ readonly grantId: string }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const grant = await this.deps.staff.grant(grantId);
    if (!grant) return err(new NotFoundError("Role", grantId));
    if (grant.userId === admin.value.id && grant.role === "admin") {
      return err(new ConflictError("You can't remove your own admin access. Ask another admin."));
    }
    if (!(await this.deps.staff.revoke(grantId))) return err(new NotFoundError("Role", grantId));
    await this.deps.access.record(
      admin.value,
      "role.revoke",
      { type: "user_roles", id: grantId },
      {
        userId: grant.userId,
        role: grant.role,
        zoneId: grant.zoneId,
        merchantId: grant.merchantId,
      },
    );
    return ok({ grantId });
  }
}

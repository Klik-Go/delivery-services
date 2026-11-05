import type { IUserRoleRepository, RoleGrant } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/** user_roles through Prisma (server connection; RLS is for clients). */
export class PrismaUserRoleRepository implements IUserRoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** All roles of a user, as the server's source of truth for authorization. */
  async rolesFor(userId: string): Promise<RoleGrant[]> {
    const rows = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true, merchant_id: true, zone_id: true },
      orderBy: { created_at: "asc" },
    });
    return rows.map((row) => ({
      role: row.role,
      merchantId: row.merchant_id,
      zoneId: row.zone_id,
    }));
  }

  /** Grants a role; granting the same scoped role twice is a no-op. */
  async grant(userId: string, grant: RoleGrant, grantedBy: string): Promise<void> {
    await this.prisma.user_roles.createMany({
      data: [
        {
          user_id: userId,
          role: grant.role,
          merchant_id: grant.merchantId,
          zone_id: grant.zoneId,
          granted_by: grantedBy,
        },
      ],
      skipDuplicates: true,
    });
  }
}

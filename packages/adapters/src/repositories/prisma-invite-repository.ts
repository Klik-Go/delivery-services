import { createHash } from "node:crypto";
import type { IInviteRepository, NewInvite } from "@klikgo/core";
import type { PrismaClient } from "@klikgo/db";

/** invites through Prisma. Only a SHA-256 of the one-time token hash is stored. */
export class PrismaInviteRepository implements IInviteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Records an invitation. */
  async record(invite: NewInvite): Promise<{ id: string }> {
    const row = await this.prisma.invites.create({
      data: {
        email: invite.email,
        role: invite.role,
        merchant_id: invite.merchantId,
        zone_id: invite.zoneId,
        invited_by: invite.invitedBy,
        token_hash: createHash("sha256").update(invite.tokenHash).digest("hex"),
        expires_at: invite.expiresAt,
      },
      select: { id: true },
    });
    return row;
  }

  /** Marks this account's open, unexpired invite as accepted. */
  async markAccepted(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      update public.invites set accepted_at = now(), accepted_by = ${userId}::uuid
      where accepted_at is null and expires_at > now()
        and lower(email) = (select lower(u.email) from auth.users u where u.id = ${userId}::uuid)`;
  }
}

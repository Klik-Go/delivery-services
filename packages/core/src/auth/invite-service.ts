import type { AppRole } from "@klikgo/types";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import {
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { AuthorizationService } from "./authorization-service";
import type { IInviteRepository, IStaffAccountGateway, IUserRoleRepository } from "./ports";
import type { SessionUser } from "./session-user";

/** Staff roles an admin can invite. */
export type InvitableRole = Extract<
  AppRole,
  "merchant_owner" | "merchant_staff" | "coordinator" | "admin"
>;

/** How long an invite link stays valid. */
export const INVITE_TTL_DAYS = 7;

/** Where the invite link sends the person after Supabase verifies it. */
const SET_PASSWORD_PATH = "/auth/set-password";

/** Invite-only onboarding for merchant, coordinator and admin accounts (docs/BUILD_PLAN.md §2 "Auth"). */
export class InviteService {
  constructor(
    private readonly deps: {
      accounts: IStaffAccountGateway;
      roles: IUserRoleRepository;
      invites: IInviteRepository;
      authz: AuthorizationService;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  /**
   * Creates the account, grants the scoped role and returns the one-time invite link path. The
   * admin can share the link directly (e.g. Viber) until an email provider is configured.
   */
  async inviteStaff(
    inviter: SessionUser | null,
    input: {
      email: string;
      role: InvitableRole;
      merchantId?: string | null | undefined;
      zoneId?: string | null | undefined;
    },
  ): Promise<Result<{ inviteId: string; userId: string; invitePath: string }, AppError>> {
    const decision = this.deps.authz.decide(inviter, { type: "staff.invite" });
    if (!decision.allowed || !inviter) {
      return err(
        decision.allowed || decision.reason !== "unauthenticated"
          ? new ForbiddenError()
          : new UnauthorizedError(),
      );
    }

    const merchantId = input.merchantId ?? null;
    const zoneId = input.zoneId ?? null;
    const scopeProblem = scopeError(input.role, merchantId, zoneId);
    if (scopeProblem) return err(scopeProblem);

    const email = input.email.trim().toLowerCase();
    const account = await this.deps.accounts.createInvite(email);
    if (!account.ok) return account;

    await this.deps.roles.grant(
      account.value.userId,
      { role: input.role, merchantId, zoneId },
      inviter.id,
    );
    const expiresAt = inviteExpiry(this.deps.clock.now());
    const invite = await this.deps.invites.record({
      email,
      role: input.role,
      merchantId,
      zoneId,
      invitedBy: inviter.id,
      tokenHash: account.value.tokenHash,
      expiresAt,
    });
    this.deps.logger.info("staff.invited", {
      inviteId: invite.id,
      role: input.role,
      invitedBy: inviter.id,
    });

    return ok({
      inviteId: invite.id,
      userId: account.value.userId,
      invitePath: invitePathFor(account.value.tokenHash),
    });
  }
}

/** The Klik Go link that verifies an invite token and continues to "choose your password". */
export function invitePathFor(tokenHash: string): string {
  const query = new URLSearchParams({
    token_hash: tokenHash,
    type: "invite",
    next: SET_PASSWORD_PATH,
  });
  return `/auth/confirm?${query.toString()}`;
}

/** When a new invite expires. */
export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

function scopeError(
  role: InvitableRole,
  merchantId: string | null,
  zoneId: string | null,
): ValidationError | null {
  const merchantRole = role === "merchant_owner" || role === "merchant_staff";
  if (merchantRole && !merchantId)
    return new ValidationError("Choose the store.", [{ path: "merchantId", message: "Required" }]);
  if (!merchantRole && merchantId) {
    return new ValidationError("Only merchant roles belong to a store.", [
      { path: "merchantId", message: "Not allowed" },
    ]);
  }
  if (role === "coordinator" && !zoneId)
    return new ValidationError("Choose the zone.", [{ path: "zoneId", message: "Required" }]);
  if (role !== "coordinator" && zoneId) {
    return new ValidationError("Only coordinators belong to a zone.", [
      { path: "zoneId", message: "Not allowed" },
    ]);
  }
  return null;
}

import {
  AppError,
  ConflictError,
  err,
  ok,
  type IStaffAccountGateway,
  type Logger,
  type Result,
} from "@klikgo/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates invited staff accounts with the service-role client (server only). Uses generateLink
 * so Klik Go controls the invite link (verified server-side at /auth/confirm) instead of a
 * Supabase-hosted redirect, and works before an email provider is configured.
 */
export class SupabaseStaffAccountGateway implements IStaffAccountGateway {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  /** Creates the account and returns its id and the one-time token hash. */
  async createInvite(
    email: string,
  ): Promise<Result<{ userId: string; tokenHash: string }, AppError>> {
    const { data, error } = await this.admin.auth.admin.generateLink({ type: "invite", email });
    if (error) {
      if (error.code === "email_exists" || /already been registered/i.test(error.message)) {
        return err(new ConflictError("This email already has a Klik Go account."));
      }
      this.logger.error("supabase.invite_failed", { status: error.status, code: error.code });
      return err(new AppError("INTERNAL", "Could not create the invitation."));
    }
    return ok({ userId: data.user.id, tokenHash: data.properties.hashed_token });
  }
}

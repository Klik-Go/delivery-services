import { randomBytes } from "node:crypto";
import { AppError, err, ok, type IPhoneAccountAdmin, type Logger, type Result } from "@klikgo/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Finds or creates customer accounts by phone and rotates their password, with the service-role
 * client (server only). Used by the pre-launch placeholder sign-in; the password is 256 random
 * bits, handed straight to the sign-in call and never stored or logged.
 */
export class SupabasePhoneAccountAdmin implements IPhoneAccountAdmin {
  constructor(
    private readonly admin: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async findOrCreateByPhone(phone: string): Promise<Result<{ userId: string }, AppError>> {
    const existing = await this.idForPhone(phone);
    if (!existing.ok) return existing;
    if (existing.value) return ok({ userId: existing.value });

    const { data, error } = await this.admin.auth.admin.createUser({ phone, phone_confirm: true });
    if (!error) return ok({ userId: data.user.id });
    // Created by a parallel request between the lookup and here: use that account.
    if (error.code === "phone_exists") {
      const raced = await this.idForPhone(phone);
      if (raced.ok && raced.value) return ok({ userId: raced.value });
    }
    this.logger.error("supabase.phone_account_create_failed", {
      status: error.status,
      code: error.code,
    });
    return err(new AppError("INTERNAL", "Could not sign you in. Try again in a moment."));
  }

  async rotatePassword(userId: string): Promise<Result<string, AppError>> {
    const password = randomBytes(32).toString("base64url");
    const { error } = await this.admin.auth.admin.updateUserById(userId, { password });
    if (!error) return ok(password);
    this.logger.error("supabase.phone_account_password_failed", {
      userId,
      status: error.status,
      code: error.code,
    });
    return err(new AppError("INTERNAL", "Could not sign you in. Try again in a moment."));
  }

  /** profiles.phone mirrors auth.users.phone with the leading "+" (handle_new_user trigger). */
  private async idForPhone(phone: string): Promise<Result<string | null, AppError>> {
    const { data, error } = await this.admin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle<{ id: string }>();
    if (!error) return ok(data?.id ?? null);
    this.logger.error("supabase.phone_account_lookup_failed", { code: error.code });
    return err(new AppError("INTERNAL", "Could not sign you in. Try again in a moment."));
  }
}

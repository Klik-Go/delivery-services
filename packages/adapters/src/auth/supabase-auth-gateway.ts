import {
  AppError,
  err,
  ok,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
  type IAuthGateway,
  type Logger,
  type MfaStatus,
  type Result,
  type TotpEnrollment,
} from "@klikgo/core";
import type { AuthError, SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase Auth for the current request's browser session. The client is created per request by
 * apps/web with @supabase/ssr cookie handling, so successful calls set or clear session cookies.
 */
export class SupabaseAuthGateway implements IAuthGateway {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  async sendPhoneOtp(phone: string): Promise<Result<void, AppError>> {
    const { error } = await this.client.auth.signInWithOtp({
      phone,
      options: { shouldCreateUser: true, channel: "sms" },
    });
    return error
      ? err(this.mapError(error, "Could not send the code. Try again in a moment."))
      : ok(undefined);
  }

  async verifyPhoneOtp(phone: string, code: string): Promise<Result<{ userId: string }, AppError>> {
    const { data, error } = await this.client.auth.verifyOtp({ phone, token: code, type: "sms" });
    if (error || !data.user)
      return err(new UnauthorizedError("That code is wrong or has expired."));
    return ok({ userId: data.user.id });
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<Result<{ userId: string }, AppError>> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error?.status === 429) return err(this.mapError(error, ""));
    if (error || !data.user) return err(new UnauthorizedError("Wrong email or password."));
    return ok({ userId: data.user.id });
  }

  async updatePassword(password: string): Promise<Result<void, AppError>> {
    const { error } = await this.client.auth.updateUser({ password });
    if (!error) return ok(undefined);
    if (error.code === "weak_password" || error.code === "same_password" || error.status === 422) {
      return err(
        new ValidationError(error.message, [{ path: "password", message: error.message }]),
      );
    }
    return err(this.mapError(error, "Could not save the password."));
  }

  async mfaStatus(): Promise<Result<MfaStatus, AppError>> {
    // Passing the token makes Supabase verify it (getUser) instead of trusting cookie contents.
    const { data: current } = await this.client.auth.getSession();
    if (!current.session) return err(new UnauthorizedError());
    const [level, factors] = await Promise.all([
      this.client.auth.mfa.getAuthenticatorAssuranceLevel(current.session.access_token),
      this.client.auth.mfa.listFactors(),
    ]);
    if (level.error || factors.error) return err(new UnauthorizedError());
    const verified = factors.data.totp.find((factor) => factor.status === "verified");
    return ok({
      aal: level.data.currentLevel === "aal2" ? "aal2" : "aal1",
      verifiedFactorId: verified?.id ?? null,
    });
  }

  async enrollTotp(): Promise<Result<TotpEnrollment, AppError>> {
    // Drop abandoned, never-verified factors so a person can restart enrolment cleanly.
    const factors = await this.client.auth.mfa.listFactors();
    for (const factor of factors.data?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status !== "verified") {
        await this.client.auth.mfa.unenroll({ factorId: factor.id });
      }
    }
    const { data, error } = await this.client.auth.mfa.enroll({
      factorType: "totp",
      issuer: "Klik Go",
      friendlyName: `Klik Go ${new Date().toISOString()}`,
    });
    if (error) return err(this.mapError(error, "Could not start authenticator setup."));
    return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  }

  async verifyTotp(factorId: string, code: string): Promise<Result<void, AppError>> {
    const { error } = await this.client.auth.mfa.challengeAndVerify({ factorId, code });
    return error
      ? err(new UnauthorizedError("That code is wrong. Check your authenticator app."))
      : ok(undefined);
  }

  async signOut(): Promise<Result<void, AppError>> {
    // Default scope "local": revokes this session's refresh token and clears the cookies.
    const { error } = await this.client.auth.signOut();
    return error ? err(this.mapError(error, "Could not sign out.")) : ok(undefined);
  }

  private mapError(error: AuthError, fallback: string): AppError {
    if (error.status === 429)
      return new RateLimitedError("Too many attempts. Please wait a minute and try again.", 60);
    if (error.status === 400 || error.status === 422) {
      return new ValidationError(fallback || error.message, [
        { path: "form", message: error.message },
      ]);
    }
    this.logger.error("supabase.auth_error", { status: error.status, code: error.code });
    return new AppError("INTERNAL", fallback || "Something went wrong.");
  }
}

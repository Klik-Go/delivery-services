import { UnauthorizedError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IAuthGateway, IRateLimiter, MfaStatus, RateLimitRule, TotpEnrollment } from "./ports";

/** TOTP guesses per account. */
export const TOTP_VERIFY_PER_USER: RateLimitRule = { limit: 10, windowSeconds: 900 };

/** TOTP enrolment and verification for staff (AAL2). */
export class MfaService {
  constructor(private readonly deps: { gateway: IAuthGateway; rateLimiter: IRateLimiter }) {}

  /** Whether the session already passed TOTP and which factor to challenge. */
  status(): Promise<Result<MfaStatus, AppError>> {
    return this.deps.gateway.mfaStatus();
  }

  /** Starts enrolment only for staff who have no verified authenticator yet. */
  async startEnrollment(): Promise<Result<TotpEnrollment, AppError>> {
    const status = await this.deps.gateway.mfaStatus();
    if (!status.ok) return status;
    if (status.value.verifiedFactorId) {
      return err(
        new UnauthorizedError("An authenticator app is already set up. Enter its code instead."),
      );
    }
    return this.deps.gateway.enrollTotp();
  }

  /** Verifies a code for a new or existing factor, raising the session to AAL2. */
  async verify(input: {
    userId: string;
    factorId: string | null;
    code: string;
  }): Promise<Result<void, AppError>> {
    if (!/^\d{6}$/.test(input.code.trim())) {
      return err(
        new ValidationError("Enter the 6-digit code.", [
          { path: "code", message: "Enter the 6-digit code." },
        ]),
      );
    }
    const guesses = await this.deps.rateLimiter.hit(
      `totp-verify:user:${input.userId}`,
      TOTP_VERIFY_PER_USER,
    );
    if (!guesses.allowed)
      return err(new UnauthorizedError("Too many wrong codes. Try again in a few minutes."));
    let factorId = input.factorId;
    if (!factorId) {
      const status = await this.deps.gateway.mfaStatus();
      if (!status.ok) return status;
      factorId = status.value.verifiedFactorId;
    }
    if (!factorId) return err(new UnauthorizedError("Set up an authenticator app first."));
    const verified = await this.deps.gateway.verifyTotp(factorId, input.code.trim());
    return verified.ok ? ok(undefined) : verified;
  }
}

import type { Logger } from "../ports/logger";
import { RateLimitedError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { normalizePhilippineMobile } from "./phone";
import type { IAuthGateway, IRateLimiter, RateLimitRule } from "./ports";

/** Code requests per phone (each SMS costs money). docs/BUILD_PLAN.md §6 Phase 2. */
export const OTP_PER_PHONE: RateLimitRule = { limit: 5, windowSeconds: 3600 };
/** Code requests per network (IP), across phones. */
export const OTP_PER_IP: RateLimitRule = { limit: 20, windowSeconds: 3600 };
/** Code guesses per phone, to make brute-forcing a 6-digit code impractical. */
export const OTP_VERIFY_PER_PHONE: RateLimitRule = { limit: 10, windowSeconds: 900 };

const CODE_PATTERN = /^\d{6}$/;

/** Phone one-time-code sign-in for customers and riders (docs/BUSINESS.md §9.2.1). */
export class PhoneOtpService {
  constructor(
    private readonly deps: { gateway: IAuthGateway; rateLimiter: IRateLimiter; logger: Logger },
  ) {}

  /** Texts a sign-in code to a Philippine mobile, within the per-phone and per-network limits. */
  async requestCode(input: {
    phone: string;
    clientIp: string;
  }): Promise<Result<{ phone: string }, AppError>> {
    const phone = normalizePhilippineMobile(input.phone);
    if (!phone.ok) return phone;

    const perPhone = await this.deps.rateLimiter.hit(`otp:phone:${phone.value}`, OTP_PER_PHONE);
    if (!perPhone.allowed) {
      return err(
        new RateLimitedError(
          "Too many codes requested for this number. Try again later.",
          perPhone.retryAfterSeconds,
        ),
      );
    }
    const perIp = await this.deps.rateLimiter.hit(`otp:ip:${input.clientIp}`, OTP_PER_IP);
    if (!perIp.allowed) {
      this.deps.logger.warn("otp.ip_rate_limited", { clientIp: input.clientIp });
      return err(
        new RateLimitedError(
          "Too many codes requested from this network. Try again later.",
          perIp.retryAfterSeconds,
        ),
      );
    }

    const sent = await this.deps.gateway.sendPhoneOtp(phone.value);
    if (!sent.ok) return sent;
    return ok({ phone: phone.value });
  }

  /** Checks the code and signs the person in (Supabase sets the session cookies). */
  async verifyCode(input: {
    phone: string;
    code: string;
  }): Promise<Result<{ userId: string }, AppError>> {
    const phone = normalizePhilippineMobile(input.phone);
    if (!phone.ok) return phone;
    const code = input.code.trim();
    if (!CODE_PATTERN.test(code)) {
      return err(
        new ValidationError("Enter the 6-digit code.", [
          { path: "code", message: "Enter the 6-digit code." },
        ]),
      );
    }
    const guesses = await this.deps.rateLimiter.hit(
      `otp-verify:phone:${phone.value}`,
      OTP_VERIFY_PER_PHONE,
    );
    if (!guesses.allowed) {
      return err(
        new RateLimitedError(
          "Too many wrong codes. Request a new code later.",
          guesses.retryAfterSeconds,
        ),
      );
    }
    return this.deps.gateway.verifyPhoneOtp(phone.value, code);
  }
}

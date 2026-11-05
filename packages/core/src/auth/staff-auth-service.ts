import type { Logger } from "../ports/logger";
import { RateLimitedError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IAuthGateway, IInviteRepository, IRateLimiter, RateLimitRule } from "./ports";

/** Password attempts per email and per network. */
export const STAFF_LOGIN_PER_EMAIL: RateLimitRule = { limit: 10, windowSeconds: 900 };
export const STAFF_LOGIN_PER_IP: RateLimitRule = { limit: 30, windowSeconds: 900 };

/** NIST SP 800-63B: length over complexity rules; 12+ characters, any characters. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Where staff always go after the password step: TOTP verify or enrolment. */
const MFA_STEP = "/auth/mfa";

/** Email + password sign-in for staff; the second factor is always required next. */
export class StaffAuthService {
  constructor(
    private readonly deps: {
      gateway: IAuthGateway;
      invites: IInviteRepository;
      rateLimiter: IRateLimiter;
      logger: Logger;
    },
  ) {}

  /** First factor. Always continues to `/auth/mfa`; staff screens need AAL2. */
  async signIn(input: {
    email: string;
    password: string;
    clientIp: string;
  }): Promise<Result<{ next: string }, AppError>> {
    const email = input.email.trim().toLowerCase();
    const perEmail = await this.deps.rateLimiter.hit(
      `staff-login:email:${email}`,
      STAFF_LOGIN_PER_EMAIL,
    );
    const perIp = await this.deps.rateLimiter.hit(
      `staff-login:ip:${input.clientIp}`,
      STAFF_LOGIN_PER_IP,
    );
    if (!perEmail.allowed || !perIp.allowed) {
      return err(
        new RateLimitedError(
          "Too many sign-in attempts. Try again later.",
          Math.max(perEmail.retryAfterSeconds, perIp.retryAfterSeconds),
        ),
      );
    }
    const signedIn = await this.deps.gateway.signInWithPassword(email, input.password);
    if (!signedIn.ok) return signedIn;
    return ok({ next: MFA_STEP });
  }

  /** Sets the password of an invited (or recovering) account, then continues to TOTP. */
  async setPassword(input: {
    userId: string;
    password: string;
  }): Promise<Result<{ next: string }, AppError>> {
    const problem = passwordProblem(input.password);
    if (problem) return err(new ValidationError(problem, [{ path: "password", message: problem }]));
    const updated = await this.deps.gateway.updatePassword(input.password);
    if (!updated.ok) return updated;
    await this.deps.invites.markAccepted(input.userId);
    this.deps.logger.info("staff.password_set", { userId: input.userId });
    return ok({ next: MFA_STEP });
  }
}

function passwordProblem(password: string): string | null {
  if (password.trim().length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

import type {
  IAuthGateway,
  IInviteRepository,
  IPhoneAccountAdmin,
  IRateLimiter,
  ISmsSender,
  IStaffAccountGateway,
  IUserRoleRepository,
  MfaStatus,
  NewInvite,
  RateLimitDecision,
  RateLimitRule,
  SmsMessage,
  TotpEnrollment,
} from "../auth/ports";
import type { RoleGrant } from "../auth/session-user";
import { AppError, ConflictError, UnauthorizedError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/** In-memory Supabase Auth for unit tests: remembers what was asked and answers like the real one. */
export class FakeAuthGateway implements IAuthGateway {
  readonly otpRequests: string[] = [];
  readonly validCodes = new Map<string, string>();
  readonly passwords = new Map<string, string>();
  readonly passwordUpdates: string[] = [];
  mfa: MfaStatus = { aal: "aal1", verifiedFactorId: null };
  totpCode = "123456";
  signedOut = false;

  /** Accounts created by the placeholder sign-in, shared with {@link FakePhoneAccountAdmin}. */
  constructor(private readonly phoneAccounts?: FakePhoneAccountAdmin) {}

  /** Simulates Supabase/SMS being unavailable (no SMS provider configured yet). */
  failSends = false;

  sendPhoneOtp(phone: string): Promise<Result<void, AppError>> {
    if (this.failSends)
      return Promise.resolve(err(new AppError("INTERNAL", "Could not send the code.")));
    this.otpRequests.push(phone);
    return Promise.resolve(ok(undefined));
  }

  verifyPhoneOtp(phone: string, code: string): Promise<Result<{ userId: string }, AppError>> {
    return Promise.resolve(
      this.validCodes.get(phone) === code
        ? ok({ userId: `user-${phone}` })
        : err(new UnauthorizedError("That code is wrong or has expired.")),
    );
  }

  signInWithPassword(
    email: string,
    password: string,
  ): Promise<Result<{ userId: string }, AppError>> {
    return Promise.resolve(
      this.passwords.get(email) === password
        ? ok({ userId: `user-${email}` })
        : err(new UnauthorizedError("Wrong email or password.")),
    );
  }

  signInWithPhonePassword(
    phone: string,
    password: string,
  ): Promise<Result<{ userId: string }, AppError>> {
    const account = this.phoneAccounts?.byPhone(phone);
    return Promise.resolve(
      account && account.password === password
        ? ok({ userId: account.userId })
        : err(new UnauthorizedError("That code is wrong or has expired.")),
    );
  }

  updatePassword(password: string): Promise<Result<void, AppError>> {
    this.passwordUpdates.push(password);
    return Promise.resolve(ok(undefined));
  }

  mfaStatus(): Promise<Result<MfaStatus, AppError>> {
    return Promise.resolve(ok(this.mfa));
  }

  enrollTotp(): Promise<Result<TotpEnrollment, AppError>> {
    return Promise.resolve(
      ok({
        factorId: "factor-1",
        qrCode: "data:image/svg+xml;utf-8,<svg/>",
        secret: "JBSWY3DPEHPK3PXP",
      }),
    );
  }

  verifyTotp(factorId: string, code: string): Promise<Result<void, AppError>> {
    if (code !== this.totpCode)
      return Promise.resolve(
        err(new UnauthorizedError("That code is wrong. Check your authenticator app.")),
      );
    this.mfa = { aal: "aal2", verifiedFactorId: factorId };
    return Promise.resolve(ok(undefined));
  }

  signOut(): Promise<Result<void, AppError>> {
    this.signedOut = true;
    return Promise.resolve(ok(undefined));
  }
}

/** Fixed-window counter in memory (same semantics as the Postgres limiter). */
export class InMemoryRateLimiter implements IRateLimiter {
  private readonly counts = new Map<string, number>();

  hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    const allowed = count <= rule.limit;
    return Promise.resolve({
      allowed,
      remaining: Math.max(rule.limit - count, 0),
      retryAfterSeconds: allowed ? 0 : rule.windowSeconds,
    });
  }
}

/** Records texts instead of sending them. */
export class FakeSmsSender implements ISmsSender {
  readonly sent: SmsMessage[] = [];

  send(message: SmsMessage): Promise<Result<{ providerMessageId: string | null }, AppError>> {
    this.sent.push(message);
    return Promise.resolve(ok({ providerMessageId: `fake-${this.sent.length}` }));
  }
}

/** Creates fake invited accounts; emails in `existingEmails` already have an account. */
export class FakeStaffAccountGateway implements IStaffAccountGateway {
  readonly invited: string[] = [];
  readonly existingEmails = new Set<string>();

  createInvite(email: string): Promise<Result<{ userId: string; tokenHash: string }, AppError>> {
    if (this.existingEmails.has(email)) {
      return Promise.resolve(err(new ConflictError("This email already has a Klik Go account.")));
    }
    this.invited.push(email);
    return Promise.resolve(
      ok({ userId: `user-${email}`, tokenHash: `hash-${this.invited.length}` }),
    );
  }
}

/** In-memory user_roles. */
export class InMemoryUserRoleRepository implements IUserRoleRepository {
  readonly grants: { userId: string; grant: RoleGrant; grantedBy: string }[] = [];

  rolesFor(userId: string): Promise<RoleGrant[]> {
    return Promise.resolve(this.grants.filter((g) => g.userId === userId).map((g) => g.grant));
  }

  grant(userId: string, grant: RoleGrant, grantedBy: string): Promise<void> {
    this.grants.push({ userId, grant, grantedBy });
    return Promise.resolve();
  }
}

/** In-memory invites. */
export class InMemoryInviteRepository implements IInviteRepository {
  readonly records: NewInvite[] = [];
  readonly accepted: string[] = [];

  record(invite: NewInvite): Promise<{ id: string }> {
    this.records.push(invite);
    return Promise.resolve({ id: `invite-${this.records.length}` });
  }

  markAccepted(userId: string): Promise<void> {
    this.accepted.push(userId);
    return Promise.resolve();
  }
}

/** In-memory phone accounts for the placeholder sign-in (what the service-role client does). */
export class FakePhoneAccountAdmin implements IPhoneAccountAdmin {
  private readonly accounts = new Map<string, { userId: string; password: string | null }>();
  private rotations = 0;
  readonly created: string[] = [];

  /** An existing account, e.g. a rider's, before the sign-in runs. */
  seed(phone: string, userId: string): void {
    this.accounts.set(phone, { userId, password: null });
  }

  byPhone(phone: string): { userId: string; password: string | null } | undefined {
    return this.accounts.get(phone);
  }

  findOrCreateByPhone(phone: string): Promise<Result<{ userId: string }, AppError>> {
    const existing = this.accounts.get(phone);
    if (existing) return Promise.resolve(ok({ userId: existing.userId }));
    // Opaque ids, like Supabase's UUIDs (never derived from the phone).
    this.created.push(phone);
    const userId = `phone-user-${String(this.created.length)}`;
    this.accounts.set(phone, { userId, password: null });
    return Promise.resolve(ok({ userId }));
  }

  rotatePassword(userId: string): Promise<Result<string, AppError>> {
    const account = [...this.accounts.values()].find((a) => a.userId === userId);
    if (!account) return Promise.resolve(err(new UnauthorizedError("No such account.")));
    this.rotations += 1;
    account.password = `pw-${String(this.rotations)}`;
    return Promise.resolve(ok(account.password));
  }
}

import type { AppError } from "../shared/errors";
import type { Result } from "../shared/result";
import type { AssuranceLevel, RoleGrant } from "./session-user";

/** One SMS to an E.164 number. */
export interface SmsMessage {
  readonly to: string;
  readonly body: string;
}

/** Sends SMS (Semaphore in production, a fake in tests). */
export interface ISmsSender {
  send(
    message: SmsMessage,
  ): Promise<Result<{ readonly providerMessageId: string | null }, AppError>>;
}

/** "At most `limit` hits per `windowSeconds`". */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Outcome of counting one hit against a rule. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

/** Counts attempts per key (e.g. `otp:phone:+63917…`); backed by Postgres in production. */
export interface IRateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

/** What a TOTP enrolment returns to show the user (QR code and manual key). */
export interface TotpEnrollment {
  readonly factorId: string;
  /** SVG image of the otpauth:// QR code (a data: URI). */
  readonly qrCode: string;
  /** Base32 secret for manual entry. */
  readonly secret: string;
}

/** TOTP state of the current session. */
export interface MfaStatus {
  readonly aal: AssuranceLevel;
  readonly verifiedFactorId: string | null;
}

/**
 * Supabase Auth acting for the browser session of the current request (cookies). Built per
 * request by the composition root; methods map Supabase errors to AppErrors.
 */
export interface IAuthGateway {
  sendPhoneOtp(phone: string): Promise<Result<void, AppError>>;
  verifyPhoneOtp(
    phone: string,
    code: string,
  ): Promise<Result<{ readonly userId: string }, AppError>>;
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<Result<{ readonly userId: string }, AppError>>;
  /** Placeholder sign-in only (see PlaceholderPhoneSignIn): phone + one-time random password. */
  signInWithPhonePassword(
    phone: string,
    password: string,
  ): Promise<Result<{ readonly userId: string }, AppError>>;
  updatePassword(password: string): Promise<Result<void, AppError>>;
  mfaStatus(): Promise<Result<MfaStatus, AppError>>;
  enrollTotp(): Promise<Result<TotpEnrollment, AppError>>;
  verifyTotp(factorId: string, code: string): Promise<Result<void, AppError>>;
  signOut(): Promise<Result<void, AppError>>;
}

/** Privileged account operations (service role, server only). */
export interface IStaffAccountGateway {
  /** Creates an invited account and returns the one-time token hash for the invite link. */
  createInvite(
    email: string,
  ): Promise<Result<{ readonly userId: string; readonly tokenHash: string }, AppError>>;
}

/** Reads and grants roles in user_roles. */
/**
 * Server-only account operations behind the placeholder sign-in (service role). Exists only
 * until SMS is switched on; see docs/OPEN_QUESTIONS.md Q20.
 */
export interface IPhoneAccountAdmin {
  /** The account for this phone (+63…), created and marked confirmed if it is new. */
  findOrCreateByPhone(phone: string): Promise<Result<{ readonly userId: string }, AppError>>;
  /** Replaces the account's password with a fresh random one and returns it (never stored). */
  rotatePassword(userId: string): Promise<Result<string, AppError>>;
}

export interface IUserRoleRepository {
  rolesFor(userId: string): Promise<RoleGrant[]>;
  grant(userId: string, grant: RoleGrant, grantedBy: string): Promise<void>;
}

/** A staff invitation to record. */
export interface NewInvite {
  readonly email: string;
  readonly role: RoleGrant["role"];
  readonly merchantId: string | null;
  readonly zoneId: string | null;
  readonly invitedBy: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

/** Stores invitations (invites table). */
export interface IInviteRepository {
  record(invite: NewInvite): Promise<{ readonly id: string }>;
  /** Marks the open invite of this account as accepted (password set). */
  markAccepted(userId: string): Promise<void>;
}

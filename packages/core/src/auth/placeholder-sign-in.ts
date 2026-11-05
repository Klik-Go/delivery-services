import type { Logger } from "../ports/logger";
import { ForbiddenError, type AppError } from "../shared/errors";
import { err, type Result } from "../shared/result";
import type { IAuthGateway, IPhoneAccountAdmin, IUserRoleRepository } from "./ports";

const SIX_DIGITS = /^\d{6}$/;

/** Dependencies, wired by the composition root only while SMS is not switched on. */
export interface PlaceholderPhoneSignInDeps {
  /** The shared 6-digit code (env PLACEHOLDER_OTP_CODE; never committed). */
  readonly code: string;
  readonly accounts: IPhoneAccountAdmin;
  readonly roles: Pick<IUserRoleRepository, "rolesFor">;
  readonly gateway: Pick<IAuthGateway, "signInWithPhonePassword">;
  readonly logger: Logger;
}

/**
 * Pre-launch stand-in for SMS codes (owner decision 2026-11-05, docs/OPEN_QUESTIONS.md Q20):
 * one shared code signs a customer in with any Philippine mobile. Supabase still issues a normal
 * session: the account is found or created by phone, given a fresh random password that is never
 * stored, and signed in with it. Numbers that belong to riders or staff are refused, so the
 * shared code can never open anything but a customer account.
 */
export class PlaceholderPhoneSignIn {
  constructor(private readonly deps: PlaceholderPhoneSignInDeps) {
    if (!SIX_DIGITS.test(deps.code)) throw new Error("PLACEHOLDER_OTP_CODE must be 6 digits.");
  }

  /** True when the typed code is the placeholder (compared in constant time). */
  matches(code: string): boolean {
    const expected = this.deps.code;
    if (code.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i += 1)
      difference |= code.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
  }

  /** Signs the customer with this (normalised) phone in, creating the account if new. */
  async signIn(phone: string): Promise<Result<{ userId: string }, AppError>> {
    const account = await this.deps.accounts.findOrCreateByPhone(phone);
    if (!account.ok) return account;
    const { userId } = account.value;

    const grants = await this.deps.roles.rolesFor(userId);
    if (grants.some((grant) => grant.role !== "customer")) {
      this.deps.logger.warn("auth.placeholder_refused", { userId, phoneTail: phone.slice(-4) });
      return err(
        new ForbiddenError("This number can't use the test code. Use the code we texted you."),
      );
    }

    const password = await this.deps.accounts.rotatePassword(userId);
    if (!password.ok) return password;
    const signedIn = await this.deps.gateway.signInWithPhonePassword(phone, password.value);
    if (signedIn.ok) this.deps.logger.info("auth.placeholder_sign_in", { userId });
    return signedIn;
  }
}

import type { SessionUser } from "../auth/session-user";
import { STAFF_ROLES } from "../auth/session-user";
import type { ISmsSender } from "../auth/ports";
import type { ConsoleAccess } from "../ops/console-access";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { ConflictError, UnauthorizedError, ValidationError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { safeNext } from "../hardening/consent-service";
import type {
  IInviteCodes,
  IPilotInviteRepository,
  IOrderingAccess,
  IPilotSettings,
  InviteSummary,
  RedeemOutcome,
} from "./ports";

/** Where customers type their code; `code` and `next` are optional query parameters. */
export const JOIN_PATH = "/join";

/** Shown when an un-invited customer tries to order. */
export const INVITE_ONLY_MESSAGE =
  "Klik Go is invite-only for now. Enter your invite code to order.";

const REFUSALS: Readonly<Record<Exclude<RedeemOutcome, "ok" | "already">, string>> = {
  invalid: "That code doesn't exist. Check the letters and try again.",
  used: "That code was already used. Each code works for one person.",
  expired: "That code has expired. Ask for a new one.",
  full: "The pilot is full for now. We'll text you when we open to more people.",
};

const MAX_BATCH = 200;

/**
 * The invite-only soft launch (docs/BUSINESS.md §4.2 Phase 2: the first 100 customers). While
 * invite_only is on, a customer orders only after redeeming a code; riders and staff are never
 * asked. Admins create code batches (flyers, partner stores) and text codes to the waitlist.
 */
export class PilotInviteService implements IOrderingAccess {
  constructor(
    private readonly deps: {
      invites: IPilotInviteRepository;
      settings: IPilotSettings;
      codes: IInviteCodes;
      access: ConsoleAccess;
      sms: ISmsSender;
      clock: Clock;
      logger: Logger;
      /** The app's public address for links in texts (NEXT_PUBLIC_APP_URL). */
      appUrl: string;
    },
  ) {}

  /** OrderService's gate: everyone may order unless the pilot is invite-only. */
  async canOrder(userId: string): Promise<boolean> {
    const { inviteOnly } = await this.deps.settings.current();
    return !inviteOnly || this.deps.invites.hasAccess(userId);
  }

  /** After sign-in, customers without access go to the code screen first. */
  async landingFor(user: Pick<SessionUser, "id" | "roles">, next: string): Promise<string> {
    if (!isPlainCustomer(user) || (await this.canOrder(user.id))) return next;
    return `${JOIN_PATH}?${new URLSearchParams({ next: safeNext(next) }).toString()}`;
  }

  async status(
    user: SessionUser | null,
  ): Promise<Result<{ readonly inviteOnly: boolean; readonly canOrder: boolean }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const { inviteOnly } = await this.deps.settings.current();
    return ok({
      inviteOnly,
      canOrder: !inviteOnly || (await this.deps.invites.hasAccess(user.id)),
    });
  }

  async redeem(
    user: SessionUser | null,
    code: string,
  ): Promise<Result<{ readonly canOrder: true }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const { maxCustomers } = await this.deps.settings.current();
    const outcome = await this.deps.invites.redeem(
      code.trim().toUpperCase(),
      user.id,
      maxCustomers,
      this.deps.clock.now(),
    );
    if (outcome === "ok" || outcome === "already") return ok({ canOrder: true });
    const message = REFUSALS[outcome];
    return err(
      outcome === "full"
        ? new ConflictError(message)
        : new ValidationError(message, [{ path: "code", message }]),
    );
  }

  /** A batch of codes for flyers or a partner store (admins; audited). */
  async createBatch(
    user: SessionUser | null,
    input: { readonly batch: string; readonly count: number; readonly expiresInDays?: number },
  ): Promise<Result<{ readonly codes: readonly string[] }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    if (input.count < 1 || input.count > MAX_BATCH)
      return err(new ValidationError(`Create between 1 and ${String(MAX_BATCH)} codes at a time.`));
    const expiresAt = this.expiry(input.expiresInDays);
    const codes = Array.from({ length: input.count }, () => this.deps.codes.next());
    await this.deps.invites.create(
      codes.map((code) => ({ code, batch: input.batch, waitlistId: null, expiresAt })),
      admin.value.id,
    );
    await this.deps.access.record(
      admin.value,
      "invite.create",
      { type: "pilot_invites", id: null },
      {
        batch: input.batch,
        count: input.count,
      },
    );
    return ok({ codes });
  }

  /** Texts a code to the oldest waitlist sign-ups who have none yet (admins; audited). */
  async inviteWaitlist(
    user: SessionUser | null,
    input: { readonly count: number; readonly expiresInDays?: number },
  ): Promise<Result<{ readonly invited: number; readonly notSent: number }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    if (input.count < 1 || input.count > MAX_BATCH)
      return err(
        new ValidationError(`Invite between 1 and ${String(MAX_BATCH)} people at a time.`),
      );
    const people = await this.deps.invites.waiting(input.count);
    const expiresAt = this.expiry(input.expiresInDays);
    const invites = people.map((person) => ({
      person,
      code: this.deps.codes.next(),
    }));
    await this.deps.invites.create(
      invites.map(({ person, code }) => ({
        code,
        batch: "Waitlist",
        waitlistId: person.waitlistId,
        expiresAt,
      })),
      admin.value.id,
    );
    let notSent = 0;
    for (const { person, code } of invites) {
      const sent = await this.deps.sms.send({ to: person.phone, body: this.text(code) });
      if (sent.ok) await this.deps.invites.markSent(code, this.deps.clock.now());
      else {
        notSent += 1;
        this.deps.logger.warn("invite.sms_failed", { code: sent.error.code });
      }
    }
    await this.deps.access.record(
      admin.value,
      "invite.waitlist",
      { type: "pilot_invites", id: null },
      {
        invited: invites.length,
        notSent,
      },
    );
    return ok({ invited: invites.length, notSent });
  }

  async summary(user: SessionUser | null): Promise<Result<InviteSummary, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    return ok(await this.deps.invites.summary(500));
  }

  /** One SMS (fits 160 characters with the link). */
  private text(code: string): string {
    const base = this.deps.appUrl.replace(/\/$/, "");
    return `Klik Go: you're invited! Your code is ${code}. Order at ${base}${JOIN_PATH}?code=${code}`;
  }

  private expiry(days: number | undefined): Date | null {
    return days ? new Date(this.deps.clock.now().getTime() + days * 86_400_000) : null;
  }
}

/** Customers who are not also riders or staff (those never need a code). */
function isPlainCustomer(user: Pick<SessionUser, "roles">): boolean {
  return !user.roles.some((grant) => grant.role === "rider" || STAFF_ROLES.includes(grant.role));
}

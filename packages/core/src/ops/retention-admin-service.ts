import type { PromoCreateInput, PromoType } from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import { ConflictError, NotFoundError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { ConsoleAccess } from "./console-access";
import type { ZoneScope } from "./ports";

/** A follow-up for the coordinator (low ratings). */
export interface SupportTicket {
  readonly id: string;
  readonly kind: "low_rating";
  readonly status: "open" | "resolved";
  readonly orderId: string;
  readonly orderCode: string;
  readonly zoneId: string;
  readonly summary: string;
  /** The rater's comment, for the coordinator only. */
  readonly comment: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolution: string | null;
}

export interface ITicketRepository {
  tickets(scope: ZoneScope, status: "open" | "resolved"): Promise<SupportTicket[]>;
  ticket(id: string): Promise<SupportTicket | null>;
  /** Resolves an open ticket; false if it was already resolved. */
  resolve(id: string, by: string, resolution: string): Promise<boolean>;
}

/** A campaign code as the console lists it, with how much it has been used. */
export interface PromoSummary {
  readonly id: string;
  readonly code: string;
  readonly type: PromoType;
  readonly description: string | null;
  readonly discountCentavos: Centavos | null;
  readonly discountBps: number | null;
  readonly maxDiscountCentavos: Centavos | null;
  readonly minSubtotalCentavos: Centavos;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly maxRedemptions: number | null;
  readonly budgetCentavos: Centavos | null;
  readonly perUserLimit: number;
  readonly firstOrders: number | null;
  readonly zoneId: string | null;
  readonly merchantId: string | null;
  readonly isActive: boolean;
  readonly redemptions: number;
  readonly discountGivenCentavos: Centavos;
}

export interface IPromoAdminRepository {
  /** Campaign codes (not personal vouchers), newest first. */
  campaigns(): Promise<PromoSummary[]>;
  /** Null when the code is taken. */
  create(input: PromoCreateInput): Promise<string | null>;
  setActive(id: string, isActive: boolean): Promise<boolean>;
}

/**
 * Console tools for Phase 9 (docs/BUILD_PLAN.md Phase 9): the low-rating tickets of the zones a
 * coordinator runs, and the promo campaigns admins create and switch off. Every change is audited.
 */
export class RetentionAdminService {
  constructor(
    private readonly deps: {
      access: ConsoleAccess;
      tickets: ITicketRepository;
      promos: IPromoAdminRepository;
    },
  ) {}

  async tickets(
    user: SessionUser | null,
    status: "open" | "resolved",
  ): Promise<Result<SupportTicket[], AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    return ok(await this.deps.tickets.tickets(allowed.value.scope, status));
  }

  async resolveTicket(
    user: SessionUser | null,
    ticketId: string,
    resolution: string,
  ): Promise<Result<SupportTicket, AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const ticket = await this.deps.tickets.ticket(ticketId);
    if (!ticket) return err(new NotFoundError("Ticket", ticketId));
    const inZone = this.deps.access.inZone(user, ticket.zoneId, "Ticket", ticketId);
    if (!inZone.ok) return inZone;
    if (!(await this.deps.tickets.resolve(ticketId, inZone.value.id, resolution))) {
      return err(new ConflictError("This ticket was already resolved."));
    }
    await this.deps.access.record(
      inZone.value,
      "ticket.resolve",
      { type: "support_tickets", id: ticketId },
      { orderId: ticket.orderId },
    );
    const updated = await this.deps.tickets.ticket(ticketId);
    return updated ? ok(updated) : err(new NotFoundError("Ticket", ticketId));
  }

  async promos(user: SessionUser | null): Promise<Result<PromoSummary[], AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    return ok(await this.deps.promos.campaigns());
  }

  async createPromo(
    user: SessionUser | null,
    input: PromoCreateInput,
  ): Promise<Result<{ readonly id: string }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    const id = await this.deps.promos.create(input);
    if (!id) return err(new ConflictError("That code is already taken. Pick another."));
    await this.deps.access.record(
      admin.value,
      "promo.create",
      { type: "promos", id },
      {
        code: input.code,
        type: input.type,
        ...(input.budgetCentavos === undefined ? {} : { budgetCentavos: input.budgetCentavos }),
      },
    );
    return ok({ id });
  }

  async setPromoActive(
    user: SessionUser | null,
    promoId: string,
    isActive: boolean,
  ): Promise<Result<{ readonly id: string; readonly isActive: boolean }, AppError>> {
    const admin = this.deps.access.platform(user);
    if (!admin.ok) return admin;
    if (!(await this.deps.promos.setActive(promoId, isActive))) {
      return err(new NotFoundError("Promo", promoId));
    }
    await this.deps.access.record(admin.value, isActive ? "promo.activate" : "promo.deactivate", {
      type: "promos",
      id: promoId,
    });
    return ok({ id: promoId, isActive });
  }
}

import type { MerchantCategory } from "@klikgo/types";

/** The pilot switches (admin settings), read together. */
export interface PilotSettings {
  /** invite_only: only customers who redeemed an invite may order. */
  readonly inviteOnly: boolean;
  /** How many customers the pilot takes (invite_only.max_customers). */
  readonly maxCustomers: number;
  /** pilot_scope: the store categories customers see, or null for all. */
  readonly categories: readonly MerchantCategory[] | null;
  /** scheduled_orders: off = "Now" only at checkout. */
  readonly scheduledOrders: boolean;
}

export interface IPilotSettings {
  current(): Promise<PilotSettings>;
}

/** Whether a customer may place orders (the invite gate). */
export interface IOrderingAccess {
  canOrder(userId: string): Promise<boolean>;
}

/** What redeeming a code did (private.redeem_invite). */
export type RedeemOutcome = "ok" | "already" | "invalid" | "used" | "expired" | "full";

export interface InviteView {
  readonly code: string;
  readonly batch: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly sentAt: Date | null;
  readonly redeemedAt: Date | null;
  /** Created for a waitlist sign-up. */
  readonly fromWaitlist: boolean;
}

export interface InviteSummary {
  readonly invites: readonly InviteView[];
  readonly total: number;
  readonly redeemed: number;
}

/** A waitlist sign-up who has no invite yet (oldest first). */
export interface WaitingPerson {
  readonly waitlistId: string;
  readonly name: string;
  readonly phone: string;
}

export interface IPilotInviteRepository {
  hasAccess(userId: string): Promise<boolean>;
  redeem(code: string, userId: string, maxCustomers: number, now: Date): Promise<RedeemOutcome>;
  create(
    invites: readonly {
      readonly code: string;
      readonly batch: string;
      readonly waitlistId: string | null;
      readonly expiresAt: Date | null;
    }[],
    createdBy: string,
  ): Promise<void>;
  summary(limit: number): Promise<InviteSummary>;
  waiting(limit: number): Promise<WaitingPerson[]>;
  markSent(code: string, at: Date): Promise<void>;
}

/** Makes invite codes people can type: 8 letters and digits without look-alikes (0/O, 1/I). */
export interface IInviteCodes {
  next(): string;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

/** Raw figures for one period [from, to). Money in centavos, times in seconds. */
export interface KpiFigures {
  readonly placed: number;
  readonly delivered: number;
  readonly cancelledByPlatform: number;
  readonly cancelledByCustomer: number;
  readonly codDelivered: number;
  readonly gmvCentavos: number;
  readonly platformRevenueCentavos: number;
  readonly promoCostCentavos: number;
  readonly gatewayFeesCentavos: number;
  readonly refundsCentavos: number;
  /** Average placed → accepted, of orders accepted in the period. */
  readonly avgConfirmSeconds: number | null;
  /** Average accepted → delivered, of orders delivered in the period. */
  readonly avgDeliverySeconds: number | null;
  readonly customers: number;
  readonly repeatCustomers: number;
  readonly activeMerchants: number;
  /** Riders with at least 10 deliveries in the period (BUSINESS §13.1). */
  readonly activeRiders: number;
  readonly riderEarningsCentavos: number;
  readonly riderOnlineSeconds: number;
  /** Rider took the job → delivered, summed. */
  readonly riderBusySeconds: number;
}

/** One Manila day of the trend. */
export interface KpiDay {
  readonly day: string;
  readonly placed: number;
  readonly delivered: number;
  readonly gmvCentavos: number;
  readonly avgConfirmSeconds: number | null;
}

export interface IKpiRepository {
  figures(from: Date, to: Date): Promise<KpiFigures>;
  /** Day by day (Asia/Manila) for the `days` days ending with the day of `until`. */
  daily(days: number, until: Date): Promise<KpiDay[]>;
}

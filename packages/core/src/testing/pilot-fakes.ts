import type {
  IInviteCodes,
  IKpiRepository,
  IPilotInviteRepository,
  IPilotSettings,
  InviteSummary,
  KpiDay,
  KpiFigures,
  PilotSettings,
  RedeemOutcome,
  WaitingPerson,
} from "../pilot/ports";

/** Pilot switches you set in a test. */
export class InMemoryPilotSettings implements IPilotSettings {
  value: PilotSettings = {
    inviteOnly: false,
    maxCustomers: 100,
    categories: null,
    scheduledOrders: true,
  };

  set(patch: Partial<PilotSettings>): this {
    this.value = { ...this.value, ...patch };
    return this;
  }

  current(): Promise<PilotSettings> {
    return Promise.resolve(this.value);
  }
}

interface StoredInvite {
  code: string;
  batch: string;
  waitlistId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  sentAt: Date | null;
  redeemedBy: string | null;
  redeemedAt: Date | null;
}

/** Invites in memory, with the same rules as private.redeem_invite. */
export class InMemoryPilotInvites implements IPilotInviteRepository {
  readonly invites: StoredInvite[] = [];
  readonly waitlist: WaitingPerson[] = [];

  hasAccess(userId: string): Promise<boolean> {
    return Promise.resolve(this.invites.some((i) => i.redeemedBy === userId));
  }

  redeem(code: string, userId: string, maxCustomers: number, now: Date): Promise<RedeemOutcome> {
    const outcome = ((): RedeemOutcome => {
      if (this.invites.some((i) => i.redeemedBy === userId)) return "already";
      const invite = this.invites.find((i) => i.code === code);
      if (!invite) return "invalid";
      if (invite.redeemedBy) return "used";
      if (invite.expiresAt && invite.expiresAt < now) return "expired";
      if (this.invites.filter((i) => i.redeemedBy).length >= maxCustomers) return "full";
      invite.redeemedBy = userId;
      invite.redeemedAt = now;
      return "ok";
    })();
    return Promise.resolve(outcome);
  }

  create(
    invites: readonly {
      code: string;
      batch: string;
      waitlistId: string | null;
      expiresAt: Date | null;
    }[],
  ): Promise<void> {
    for (const invite of invites) {
      this.invites.push({
        ...invite,
        createdAt: new Date(0),
        sentAt: null,
        redeemedBy: null,
        redeemedAt: null,
      });
    }
    return Promise.resolve();
  }

  summary(limit: number): Promise<InviteSummary> {
    return Promise.resolve({
      invites: this.invites.slice(0, limit).map((i) => ({
        code: i.code,
        batch: i.batch,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        sentAt: i.sentAt,
        redeemedAt: i.redeemedAt,
        fromWaitlist: i.waitlistId !== null,
      })),
      total: this.invites.length,
      redeemed: this.invites.filter((i) => i.redeemedBy).length,
    });
  }

  waiting(limit: number): Promise<WaitingPerson[]> {
    const invited = new Set(this.invites.map((i) => i.waitlistId));
    return Promise.resolve(this.waitlist.filter((p) => !invited.has(p.waitlistId)).slice(0, limit));
  }

  markSent(code: string, at: Date): Promise<void> {
    const invite = this.invites.find((i) => i.code === code);
    if (invite) invite.sentAt = at;
    return Promise.resolve();
  }
}

/** Predictable codes: CODE0001, CODE0002… */
export class SequentialInviteCodes implements IInviteCodes {
  private n = 0;
  next(): string {
    this.n += 1;
    return `CODE${String(this.n).padStart(4, "0")}`;
  }
}

/** KPI figures you set per call. */
export class InMemoryKpis implements IKpiRepository {
  readonly asked: { from: Date; to: Date }[] = [];
  constructor(
    public figuresFor: (from: Date, to: Date) => KpiFigures,
    public days: KpiDay[] = [],
  ) {}

  figures(from: Date, to: Date): Promise<KpiFigures> {
    this.asked.push({ from, to });
    return Promise.resolve(this.figuresFor(from, to));
  }

  daily(): Promise<KpiDay[]> {
    return Promise.resolve(this.days);
  }
}

/** All-zero figures, to override per test. */
export const NO_FIGURES: KpiFigures = {
  placed: 0,
  delivered: 0,
  cancelledByPlatform: 0,
  cancelledByCustomer: 0,
  codDelivered: 0,
  gmvCentavos: 0,
  platformRevenueCentavos: 0,
  promoCostCentavos: 0,
  gatewayFeesCentavos: 0,
  refundsCentavos: 0,
  avgConfirmSeconds: null,
  avgDeliverySeconds: null,
  customers: 0,
  repeatCustomers: 0,
  activeMerchants: 0,
  activeRiders: 0,
  riderEarningsCentavos: 0,
  riderOnlineSeconds: 0,
  riderBusySeconds: 0,
};

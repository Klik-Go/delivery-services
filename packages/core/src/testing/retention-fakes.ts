import type {
  HistoryOrder,
  IOrderHistoryRepository,
  IRatingRepository,
  IRewardsRepository,
  RatableOrder,
  RatingRecord,
  RatingWrite,
  ReferralStatus,
  ReorderSource,
  RewardFacts,
  RewardPlan,
  VoucherSpec,
  VoucherView,
} from "../retention/ports";
import type {
  IPromoAdminRepository,
  ITicketRepository,
  PromoSummary,
  SupportTicket,
} from "../ops/retention-admin-service";
import type { ZoneScope } from "../ops/ports";
import type { PromoCreateInput } from "@klikgo/types";

/** Ratings and low-rating tickets in memory (insert or update by order, rater and target type). */
export class InMemoryRatings implements IRatingRepository {
  readonly orders = new Map<string, RatableOrder>();
  readonly ratingsStore: RatingRecord[] = [];
  readonly tickets: { zoneId: string; summary: string; ratingId: string }[] = [];
  private sequence = 0;

  constructor(private readonly now: () => Date) {}

  order(orderId: string): Promise<RatableOrder | null> {
    return Promise.resolve(this.orders.get(orderId) ?? null);
  }

  ratings(orderId: string): Promise<RatingRecord[]> {
    return Promise.resolve(this.ratingsStore.filter((r) => r.orderId === orderId));
  }

  save(write: RatingWrite): Promise<RatingRecord> {
    const index = this.ratingsStore.findIndex(
      (r) =>
        r.orderId === write.orderId &&
        r.fromUserId === write.fromUserId &&
        r.targetType === write.targetType,
    );
    const before = this.ratingsStore[index];
    this.sequence += 1;
    const saved: RatingRecord = {
      id: before?.id ?? `rating-${String(this.sequence)}`,
      orderId: write.orderId,
      fromUserId: write.fromUserId,
      targetType: write.targetType,
      targetId: write.targetId,
      score: write.score,
      tags: write.tags,
      comment: write.comment,
      createdAt: before?.createdAt ?? this.now(),
    };
    if (index >= 0) this.ratingsStore[index] = saved;
    else this.ratingsStore.push(saved);
    if (write.ticket && !this.tickets.some((t) => t.ratingId === saved.id)) {
      this.tickets.push({ ...write.ticket, ratingId: saved.id });
    }
    return Promise.resolve(saved);
  }

  riderDeliveries(
    riderUserId: string,
    since: Date,
  ): Promise<{ order: RatableOrder; rating: RatingRecord | null }[]> {
    return Promise.resolve(
      [...this.orders.values()]
        .filter(
          (o) =>
            o.riderUserId === riderUserId &&
            o.status === "delivered" &&
            o.deliveredAt !== null &&
            o.deliveredAt >= since,
        )
        .sort((a, b) => (b.deliveredAt?.getTime() ?? 0) - (a.deliveredAt?.getTime() ?? 0))
        .map((order) => ({
          order,
          rating:
            this.ratingsStore.find(
              (r) =>
                r.orderId === order.id &&
                r.fromUserId === riderUserId &&
                r.targetType === "customer",
            ) ?? null,
        })),
    );
  }
}

/** Order history and reorder sources in memory. */
export class InMemoryOrderHistory implements IOrderHistoryRepository {
  readonly orders: (HistoryOrder & { customerId: string })[] = [];
  readonly sources = new Map<string, ReorderSource>();

  history(customerId: string, before: Date | null, limit: number): Promise<HistoryOrder[]> {
    return Promise.resolve(
      this.orders
        .filter((o) => o.customerId === customerId && (!before || o.createdAt < before))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map(({ customerId: _owner, ...order }) => order),
    );
  }

  reorderSource(orderId: string): Promise<ReorderSource | null> {
    return Promise.resolve(this.sources.get(orderId) ?? null);
  }
}

interface StoredReferral {
  id: string;
  referrerId: string;
  refereeId: string;
  code: string;
  deviceHash: string | null;
  status: ReferralStatus;
  voidReason: string | null;
}

/**
 * Referral codes, referrals, stamps and vouchers in memory. Delivered orders waiting for rewards
 * are queued in `due`; `applyRewards` processes each once, like the database's
 * rewards_processed_at.
 */
export class InMemoryRewards implements IRewardsRepository {
  readonly codes = new Map<string, string>();
  readonly referrals: StoredReferral[] = [];
  readonly stamps: { customerId: string; orderId: string; voucherCode: string | null }[] = [];
  readonly vouchersStore: (VoucherSpec & { code: string; used: boolean })[] = [];
  readonly orderCounts = new Map<string, number>();
  /** Delivered orders waiting for rewards (facts are computed from the state at call time). */
  readonly due: {
    orderId: string;
    customerId: string;
    subtotalCentavos: number;
    sameAddress?: boolean;
  }[] = [];
  private readonly processed = new Set<string>();
  private sequence = 0;

  referralCode(userId: string): Promise<string> {
    let code = this.codes.get(userId);
    if (!code) {
      this.sequence += 1;
      code = `KLIK${String(this.sequence).padStart(4, "0")}`;
      this.codes.set(userId, code);
    }
    return Promise.resolve(code);
  }

  referrerByCode(code: string): Promise<string | null> {
    const entry = [...this.codes.entries()].find(([, c]) => c === code);
    return Promise.resolve(entry?.[0] ?? null);
  }

  referralOf(refereeId: string): Promise<{ status: ReferralStatus } | null> {
    const referral = this.referrals.find((r) => r.refereeId === refereeId);
    return Promise.resolve(referral ? { status: referral.status } : null);
  }

  referralCounts(referrerId: string): Promise<Record<ReferralStatus, number>> {
    const counts: Record<ReferralStatus, number> = {
      pending: 0,
      qualified: 0,
      rewarded: 0,
      void: 0,
    };
    for (const r of this.referrals.filter((x) => x.referrerId === referrerId))
      counts[r.status] += 1;
    return Promise.resolve(counts);
  }

  orderCount(userId: string): Promise<number> {
    return Promise.resolve(this.orderCounts.get(userId) ?? 0);
  }

  createReferral(input: {
    referrerId: string;
    refereeId: string;
    code: string;
    deviceHash: string | null;
  }): Promise<boolean> {
    if (
      input.deviceHash !== null &&
      this.referrals.some((r) => r.deviceHash === input.deviceHash && r.status !== "void")
    ) {
      return Promise.resolve(false);
    }
    this.sequence += 1;
    this.referrals.push({
      ...input,
      id: `referral-${String(this.sequence)}`,
      status: "pending",
      voidReason: null,
    });
    return Promise.resolve(true);
  }

  openStamps(userId: string): Promise<number> {
    return Promise.resolve(
      this.stamps.filter((s) => s.customerId === userId && s.voucherCode === null).length,
    );
  }

  vouchers(userId: string): Promise<VoucherView[]> {
    return Promise.resolve(
      this.vouchersStore
        .filter((v) => v.ownerId === userId)
        .map((v) => ({
          code: v.code,
          type: v.type,
          source: v.source,
          description: v.description,
          discountCentavos: v.discountCentavos,
          maxDiscountCentavos: v.maxDiscountCentavos,
          endsAt: v.endsAt,
          used: v.used,
        })),
    );
  }

  rewardsDue(limit: number): Promise<RewardFacts[]> {
    return Promise.all(
      this.due
        .filter((d) => !this.processed.has(d.orderId))
        .slice(0, limit)
        .map(async (d) => {
          const referral = this.referrals.find(
            (r) => r.refereeId === d.customerId && r.status === "pending",
          );
          return {
            orderId: d.orderId,
            customerId: d.customerId,
            subtotalCentavos: d.subtotalCentavos,
            openStamps: await this.openStamps(d.customerId),
            referral: referral
              ? {
                  id: referral.id,
                  referrerId: referral.referrerId,
                  sameAddressAsReferrer: d.sameAddress ?? false,
                }
              : null,
          };
        }),
    );
  }

  applyRewards(plan: RewardPlan): Promise<boolean> {
    if (this.processed.has(plan.orderId)) return Promise.resolve(false);
    this.processed.add(plan.orderId);
    if (plan.stamp)
      this.stamps.push({ customerId: plan.customerId, orderId: plan.orderId, voucherCode: null });
    if (plan.loyaltyVoucher) {
      const code = this.addVoucher(plan.loyaltyVoucher.voucher);
      this.stamps
        .filter((s) => s.customerId === plan.customerId && s.voucherCode === null)
        .slice(0, plan.loyaltyVoucher.stamps)
        .forEach((s) => (s.voucherCode = code));
    }
    const referral = plan.referral
      ? this.referrals.find((r) => r.id === plan.referral?.id)
      : undefined;
    if (referral && plan.referral?.outcome === "rewarded") {
      referral.status = "rewarded";
      this.addVoucher(plan.referral.referrerVoucher);
      this.addVoucher(plan.referral.refereeVoucher);
    } else if (referral && plan.referral?.outcome === "void") {
      referral.status = "void";
      referral.voidReason = plan.referral.reason;
    }
    return Promise.resolve(true);
  }

  private addVoucher(spec: VoucherSpec): string {
    this.sequence += 1;
    const code = `${spec.source === "loyalty" ? "LOYAL" : "REF"}${String(this.sequence).padStart(5, "0")}`;
    this.vouchersStore.push({ ...spec, code, used: false });
    return code;
  }
}

/** Support tickets in memory, scoped like the database view of a coordinator. */
export class InMemoryTickets implements ITicketRepository {
  readonly store: SupportTicket[] = [];

  tickets(scope: ZoneScope, status: "open" | "resolved"): Promise<SupportTicket[]> {
    return Promise.resolve(
      this.store.filter(
        (t) => t.status === status && (scope === "all" || scope.includes(t.zoneId)),
      ),
    );
  }

  ticket(id: string): Promise<SupportTicket | null> {
    return Promise.resolve(this.store.find((t) => t.id === id) ?? null);
  }

  resolve(id: string, _by: string, resolution: string): Promise<boolean> {
    const index = this.store.findIndex((t) => t.id === id && t.status === "open");
    const ticket = this.store[index];
    if (!ticket) return Promise.resolve(false);
    this.store[index] = { ...ticket, status: "resolved", resolvedAt: new Date(), resolution };
    return Promise.resolve(true);
  }
}

/** Campaign promos in memory (codes unique). */
export class InMemoryPromoAdmin implements IPromoAdminRepository {
  readonly store: PromoSummary[] = [];

  campaigns(): Promise<PromoSummary[]> {
    return Promise.resolve([...this.store]);
  }

  create(input: PromoCreateInput): Promise<string | null> {
    if (this.store.some((p) => p.code === input.code)) return Promise.resolve(null);
    const id = `promo-${String(this.store.length + 1)}`;
    this.store.push({
      id,
      code: input.code,
      type: input.type,
      description: input.description ?? null,
      discountCentavos: input.discountCentavos ?? null,
      discountBps: input.discountBps ?? null,
      maxDiscountCentavos: input.maxDiscountCentavos ?? null,
      minSubtotalCentavos: input.minSubtotalCentavos,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      maxRedemptions: input.maxRedemptions ?? null,
      budgetCentavos: input.budgetCentavos ?? null,
      perUserLimit: input.perUserLimit,
      firstOrders: input.firstOrders ?? null,
      zoneId: input.zoneId ?? null,
      merchantId: input.merchantId ?? null,
      isActive: true,
      redemptions: 0,
      discountGivenCentavos: 0,
    });
    return Promise.resolve(id);
  }

  setActive(id: string, isActive: boolean): Promise<boolean> {
    const index = this.store.findIndex((p) => p.id === id);
    const promo = this.store[index];
    if (!promo) return Promise.resolve(false);
    this.store[index] = { ...promo, isActive };
    return Promise.resolve(true);
  }
}

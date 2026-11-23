import type { OrderStatus, PromoType, RatingTargetKind } from "@klikgo/types";
import type { GeoPoint } from "../merchant/ports";
import type { Centavos } from "../shared/money";

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/** A rating as stored: one per order, rater and kind of target. */
export interface RatingRecord {
  readonly id: string;
  readonly orderId: string;
  readonly fromUserId: string;
  readonly targetType: RatingTargetKind;
  readonly targetId: string;
  readonly score: number;
  readonly tags: readonly string[];
  readonly comment: string | null;
  readonly createdAt: Date;
}

/** What rating an order needs to know about it. */
export interface RatableOrder {
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  /** The store; null for a Pabili order (no store). */
  readonly merchantId: string | null;
  readonly merchantName: string;
  readonly zoneId: string;
  readonly riderId: string | null;
  readonly riderUserId: string | null;
  readonly riderName: string | null;
  readonly status: OrderStatus;
  readonly deliveredAt: Date | null;
}

/** A new or changed rating; a low one opens a ticket for the coordinator in the same save. */
export interface RatingWrite {
  readonly orderId: string;
  readonly fromUserId: string;
  readonly targetType: RatingTargetKind;
  readonly targetId: string;
  readonly score: number;
  readonly tags: readonly string[];
  readonly comment: string | null;
  /** Set when the rating is 2 or less: the ticket's one-line summary (no personal data). */
  readonly ticket: { readonly zoneId: string; readonly summary: string } | null;
}

export interface IRatingRepository {
  order(orderId: string): Promise<RatableOrder | null>;
  ratings(orderId: string): Promise<RatingRecord[]>;
  /** Inserts or updates (same order, rater, target type) and opens the ticket if asked. */
  save(rating: RatingWrite): Promise<RatingRecord>;
  /** Orders this rider delivered since `since`, newest first, with the rider's rating if any. */
  riderDeliveries(
    riderUserId: string,
    since: Date,
  ): Promise<{ readonly order: RatableOrder; readonly rating: RatingRecord | null }[]>;
}

// ---------------------------------------------------------------------------
// Order history and reorder
// ---------------------------------------------------------------------------

/** One past order in the customer's history. */
export interface HistoryOrder {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  /** The store; null for a Pabili order (no store). */
  readonly merchantId: string | null;
  readonly merchantName: string;
  /** Null for a Pabili order, which can't be reordered from a menu. */
  readonly merchantSlug: string | null;
  readonly totalCentavos: Centavos;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
  readonly itemCount: number;
  /** "2× Adobo, 1× Leche Flan" style summary from the order's snapshot. */
  readonly itemsSummary: string;
  readonly hasRider: boolean;
  /** Which targets the customer already rated on this order. */
  readonly rated: readonly ("merchant" | "rider")[];
}

/** A past order's lines as they were ordered (menu ids may be gone since). */
export interface ReorderSource {
  readonly orderId: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly merchantSlug: string;
  readonly dropoff: GeoPoint;
  readonly lines: readonly {
    readonly menuItemId: string | null;
    readonly name: string;
    readonly quantity: number;
    readonly optionIds: readonly string[];
  }[];
}

export interface IOrderHistoryRepository {
  history(customerId: string, before: Date | null, limit: number): Promise<HistoryOrder[]>;
  reorderSource(orderId: string): Promise<ReorderSource | null>;
}

// ---------------------------------------------------------------------------
// Rewards: referrals, loyalty stamps and personal vouchers
// ---------------------------------------------------------------------------

/** A personal voucher the platform gives a customer (a promo only they can use). */
export interface VoucherSpec {
  readonly ownerId: string;
  readonly source: "referral" | "loyalty";
  readonly type: Extract<PromoType, "fixed_off" | "free_delivery">;
  readonly discountCentavos: Centavos | null;
  /** Free delivery up to this much; null for no cap. */
  readonly maxDiscountCentavos: Centavos | null;
  readonly description: string;
  readonly endsAt: Date;
}

/** A voucher as the customer sees it in Rewards. */
export interface VoucherView {
  readonly code: string;
  readonly type: PromoType;
  readonly source: "referral" | "loyalty" | "campaign";
  readonly description: string | null;
  readonly discountCentavos: Centavos | null;
  readonly maxDiscountCentavos: Centavos | null;
  readonly endsAt: Date;
  readonly used: boolean;
}

export type ReferralStatus = "pending" | "qualified" | "rewarded" | "void";

/** What deciding a delivered order's rewards needs. */
export interface RewardFacts {
  readonly orderId: string;
  readonly customerId: string;
  readonly subtotalCentavos: Centavos;
  /** Stamps not yet turned into a voucher (before this order's stamp). */
  readonly openStamps: number;
  /** The customer's pending referral, if this delivery could qualify it. */
  readonly referral: {
    readonly id: string;
    readonly referrerId: string;
    /** The order went to the referrer's own address (a saved address or a past dropoff). */
    readonly sameAddressAsReferrer: boolean;
  } | null;
}

/** What to record for one delivered order, all in one transaction. */
export interface RewardPlan {
  readonly orderId: string;
  readonly customerId: string;
  readonly stamp: boolean;
  /** Turn the oldest `stamps` stamps into this voucher. */
  readonly loyaltyVoucher: { readonly stamps: number; readonly voucher: VoucherSpec } | null;
  readonly referral:
    | {
        readonly id: string;
        readonly outcome: "rewarded";
        readonly referrerVoucher: VoucherSpec;
        readonly refereeVoucher: VoucherSpec;
        readonly rewardCentavos: Centavos;
      }
    | { readonly id: string; readonly outcome: "void"; readonly reason: string }
    | null;
}

export interface IRewardsRepository {
  /** The customer's referral code, created (unique, random) the first time it is asked for. */
  referralCode(userId: string): Promise<string>;
  /** Who owns a referral code, if anyone. */
  referrerByCode(code: string): Promise<string | null>;
  referralOf(refereeId: string): Promise<{ readonly status: ReferralStatus } | null>;
  /** Friends this customer referred, by status. */
  referralCounts(referrerId: string): Promise<Readonly<Record<ReferralStatus, number>>>;
  /** Orders the customer placed that were not cancelled or rejected. */
  orderCount(userId: string): Promise<number>;
  /** False when a referral already exists for this device (one per handset). */
  createReferral(input: {
    readonly referrerId: string;
    readonly refereeId: string;
    readonly code: string;
    readonly deviceHash: string | null;
  }): Promise<boolean>;
  openStamps(userId: string): Promise<number>;
  vouchers(userId: string): Promise<VoucherView[]>;
  /** Delivered orders whose rewards were not worked out yet, oldest first. */
  rewardsDue(limit: number): Promise<RewardFacts[]>;
  /** Records the plan once (false if another run already processed the order). */
  applyRewards(plan: RewardPlan): Promise<boolean>;
}

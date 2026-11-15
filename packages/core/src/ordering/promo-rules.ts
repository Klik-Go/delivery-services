import type { PromoType } from "@klikgo/types";
import type { Centavos } from "../shared/money";
import type { PromoRecord } from "./ports";

/** The customer and cart a promo is judged against. */
export interface PromoContext {
  readonly userId: string;
  /** SHA-256 of the customer's phone and of the app's device id (abuse guards); null if unknown. */
  readonly phoneHash: string | null;
  readonly deviceHash: string | null;
  readonly zoneId: string;
  readonly merchantId: string;
  readonly subtotalCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  /** Orders this customer has had delivered before (for first-order promos). */
  readonly deliveredOrders: number;
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// Discount strategies: one per promo type (docs/BUSINESS.md §10.3 Open/Closed)
// ---------------------------------------------------------------------------

/** Works out what one kind of promo takes off a cart. */
export interface DiscountStrategy {
  readonly type: PromoType;
  discount(promo: PromoRecord, context: PromoContext): Centavos;
}

const capped = (amount: Centavos, cap: Centavos | null): Centavos =>
  cap === null ? amount : Math.min(amount, cap);

/** A percent of the subtotal, up to a cap. */
export class PercentOffStrategy implements DiscountStrategy {
  readonly type = "percent_off" as const;
  discount(promo: PromoRecord, context: PromoContext): Centavos {
    const percent = Math.floor((context.subtotalCentavos * (promo.discountBps ?? 0)) / 10_000);
    return Math.min(capped(percent, promo.maxDiscountCentavos), context.subtotalCentavos);
  }
}

/** A fixed amount, never more than the subtotal. */
export class FixedOffStrategy implements DiscountStrategy {
  readonly type = "fixed_off" as const;
  discount(promo: PromoRecord, context: PromoContext): Centavos {
    return Math.min(promo.discountCentavos ?? 0, context.subtotalCentavos);
  }
}

/** The delivery fee, up to a cap (a ₱40 cap leaves ₱19 of a ₱59 fee to pay). */
export class FreeDeliveryStrategy implements DiscountStrategy {
  readonly type = "free_delivery" as const;
  discount(promo: PromoRecord, context: PromoContext): Centavos {
    return capped(context.deliveryFeeCentavos, promo.maxDiscountCentavos);
  }
}

export const DEFAULT_DISCOUNT_STRATEGIES: readonly DiscountStrategy[] = [
  new PercentOffStrategy(),
  new FixedOffStrategy(),
  new FreeDeliveryStrategy(),
];

// ---------------------------------------------------------------------------
// Eligibility rules: each says why a promo does not apply, or null when it is fine
// ---------------------------------------------------------------------------

/** One condition a promo must meet. `discount` is what the promo would take off. */
export interface PromoRule {
  refusal(promo: PromoRecord, context: PromoContext, discount: Centavos): string | null;
}

const NOT_VALID = "That promo code is not valid right now.";

export class ActiveWindowRule implements PromoRule {
  refusal(promo: PromoRecord, { now }: PromoContext): string | null {
    return promo.isActive && now >= promo.startsAt && now < promo.endsAt ? null : NOT_VALID;
  }
}

/** Personal vouchers (referral and loyalty rewards) belong to one customer. */
export class OwnerRule implements PromoRule {
  refusal(promo: PromoRecord, context: PromoContext): string | null {
    // Someone else's voucher reads as an unknown code, so codes cannot be probed.
    return promo.ownerId === null || promo.ownerId === context.userId ? null : NOT_VALID;
  }
}

export class ZoneRule implements PromoRule {
  refusal(promo: PromoRecord, context: PromoContext): string | null {
    return promo.zoneId === null || promo.zoneId === context.zoneId
      ? null
      : "That promo code does not work in your area.";
  }
}

export class MerchantRule implements PromoRule {
  refusal(promo: PromoRecord, context: PromoContext): string | null {
    return promo.merchantId === null || promo.merchantId === context.merchantId
      ? null
      : "That promo code is for a different store.";
  }
}

export class MinSubtotalRule implements PromoRule {
  refusal(promo: PromoRecord, context: PromoContext): string | null {
    if (context.subtotalCentavos >= promo.minSubtotalCentavos) return null;
    const short = Math.ceil((promo.minSubtotalCentavos - context.subtotalCentavos) / 100);
    return `Add ₱${String(short)} more to use this code.`;
  }
}

/** First-N-orders promos (N = 1 means new customers only). */
export class FirstOrdersRule implements PromoRule {
  refusal(promo: PromoRecord, context: PromoContext): string | null {
    if (promo.firstOrders === null || context.deliveredOrders < promo.firstOrders) return null;
    return promo.firstOrders === 1
      ? "That promo code is for your first order only."
      : `That promo code is for your first ${String(promo.firstOrders)} orders only.`;
  }
}

/** The total number of uses and the peso budget. */
export class CapRule implements PromoRule {
  refusal(promo: PromoRecord, _context: PromoContext, discount: Centavos): string | null {
    const used = "That promo code has been used up.";
    if (promo.maxRedemptions !== null && promo.redemptions >= promo.maxRedemptions) return used;
    if (
      promo.budgetCentavos !== null &&
      promo.discountGivenCentavos + discount > promo.budgetCentavos
    )
      return used;
    return null;
  }
}

/** Uses per customer, counting the account, its phone number and the device together. */
export class PerCustomerRule implements PromoRule {
  refusal(promo: PromoRecord): string | null {
    return promo.redemptionsByCustomer < promo.perUserLimit
      ? null
      : "You have already used that promo code.";
  }
}

/** Checked in this order, so the customer hears the most useful reason first. */
export const DEFAULT_PROMO_RULES: readonly PromoRule[] = [
  new ActiveWindowRule(),
  new OwnerRule(),
  new ZoneRule(),
  new MerchantRule(),
  new FirstOrdersRule(),
  new MinSubtotalRule(),
  new CapRule(),
  new PerCustomerRule(),
];

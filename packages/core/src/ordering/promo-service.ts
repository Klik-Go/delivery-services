import { ValidationError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { Clock } from "../ports/clock";
import type { IPromoRepository, PromoRecord } from "./ports";

/** A promo that applies to this cart, and what it takes off. */
export interface AppliedPromo {
  readonly promoId: string;
  readonly code: string;
  readonly type: PromoRecord["type"];
  readonly discountCentavos: Centavos;
  readonly fundedBy: PromoRecord["fundedBy"];
}

/** The cart a promo is checked against. */
export interface PromoContext {
  readonly userId: string;
  readonly zoneId: string;
  readonly merchantId: string;
  readonly subtotalCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
}

const refuse = (message: string): Result<never, AppError> =>
  err(new ValidationError(message, [{ path: "promoCode", message }]));

/**
 * Checks a promo code for one customer's cart and works out the discount: percent off the
 * subtotal (capped), a fixed amount (never more than the subtotal) or free delivery.
 */
export class PromoService {
  constructor(private readonly deps: { promos: IPromoRepository; clock: Clock }) {}

  async apply(code: string, context: PromoContext): Promise<Result<AppliedPromo, AppError>> {
    const promo = await this.deps.promos.findByCode(code.trim().toUpperCase(), context.userId);
    const now = this.deps.clock.now();
    if (!promo || !promo.isActive || now < promo.startsAt || now >= promo.endsAt) {
      return refuse("That promo code is not valid right now.");
    }
    if (promo.zoneId !== null && promo.zoneId !== context.zoneId) {
      return refuse("That promo code does not work in your area.");
    }
    if (promo.merchantId !== null && promo.merchantId !== context.merchantId) {
      return refuse("That promo code is for a different store.");
    }
    if (context.subtotalCentavos < promo.minSubtotalCentavos) {
      return refuse(
        `Add ₱${String(Math.ceil((promo.minSubtotalCentavos - context.subtotalCentavos) / 100))} more to use this code.`,
      );
    }
    if (promo.maxRedemptions !== null && promo.redemptions >= promo.maxRedemptions) {
      return refuse("That promo code has been used up.");
    }
    if (promo.redemptionsByUser >= promo.perUserLimit) {
      return refuse("You have already used that promo code.");
    }
    return ok({
      promoId: promo.id,
      code: promo.code,
      type: promo.type,
      discountCentavos: discountFor(promo, context),
      fundedBy: promo.fundedBy,
    });
  }
}

function discountFor(promo: PromoRecord, context: PromoContext): Centavos {
  if (promo.type === "free_delivery") return context.deliveryFeeCentavos;
  if (promo.type === "fixed_off")
    return Math.min(promo.discountCentavos ?? 0, context.subtotalCentavos);
  const percent = Math.floor((context.subtotalCentavos * (promo.discountBps ?? 0)) / 10_000);
  return Math.min(percent, promo.maxDiscountCentavos ?? percent, context.subtotalCentavos);
}

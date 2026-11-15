import type { PromoType } from "@klikgo/types";
import { ValidationError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { Clock } from "../ports/clock";
import type { IPromoRepository, PromoRecord } from "./ports";
import {
  DEFAULT_DISCOUNT_STRATEGIES,
  DEFAULT_PROMO_RULES,
  type DiscountStrategy,
  type PromoContext,
  type PromoRule,
} from "./promo-rules";

export type { PromoContext } from "./promo-rules";

/** A promo that applies to this cart, and what it takes off. */
export interface AppliedPromo {
  readonly promoId: string;
  readonly code: string;
  readonly type: PromoRecord["type"];
  readonly discountCentavos: Centavos;
  readonly fundedBy: PromoRecord["fundedBy"];
}

/** The customer and cart, before the service adds what it looks up itself. */
export type PromoRequest = Omit<PromoContext, "deliveredOrders" | "now">;

const refuse = (message: string): Result<never, AppError> =>
  err(new ValidationError(message, [{ path: "promoCode", message }]));

/**
 * Checks a promo code for one customer's cart (docs/BUILD_PLAN.md Phase 9): every eligibility rule
 * must pass (window, owner, zone, store, first orders, minimum, caps and budget, uses per customer,
 * phone and device), then the strategy for the promo's type works out the discount. The database
 * checks caps and per-customer uses again under a lock when the order is stored.
 */
export class PromoService {
  private readonly strategies: ReadonlyMap<PromoType, DiscountStrategy>;
  private readonly rules: readonly PromoRule[];

  constructor(
    private readonly deps: {
      promos: IPromoRepository;
      clock: Clock;
      strategies?: readonly DiscountStrategy[];
      rules?: readonly PromoRule[];
    },
  ) {
    this.strategies = new Map(
      (deps.strategies ?? DEFAULT_DISCOUNT_STRATEGIES).map((s) => [s.type, s]),
    );
    this.rules = deps.rules ?? DEFAULT_PROMO_RULES;
  }

  async apply(code: string, request: PromoRequest): Promise<Result<AppliedPromo, AppError>> {
    const promo = await this.deps.promos.findByCode(code.trim().toUpperCase(), request);
    const strategy = promo ? this.strategies.get(promo.type) : undefined;
    if (!promo || !strategy) return refuse("That promo code is not valid right now.");
    const context: PromoContext = {
      ...request,
      deliveredOrders:
        promo.firstOrders === null ? 0 : await this.deps.promos.deliveredOrders(request.userId),
      now: this.deps.clock.now(),
    };
    const discount = strategy.discount(promo, context);
    for (const rule of this.rules) {
      const refusal = rule.refusal(promo, context, discount);
      if (refusal) return refuse(refusal);
    }
    return ok({
      promoId: promo.id,
      code: promo.code,
      type: promo.type,
      discountCentavos: discount,
      fundedBy: promo.fundedBy,
    });
  }
}

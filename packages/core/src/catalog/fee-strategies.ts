import type { Centavos } from "../shared/money";
import type { ZoneFees } from "./ports";

/** What a fee rule looks at. */
export interface FeeContext {
  readonly distanceM: number;
  readonly subtotalCentavos: Centavos;
  readonly fees: ZoneFees;
}

/** Decides the delivery fee, or passes (null) to the next strategy. Add rules by adding classes. */
export interface DeliveryFeeStrategy {
  deliveryFee(context: FeeContext): Centavos | null;
}

/** A fee added on top of delivery (small-order fee, service fee). */
export interface SurchargeStrategy {
  readonly kind: "small_order" | "service";
  amount(context: FeeContext): Centavos;
}

/** The zone's distance bands (fee_rules kind delivery_distance_band), highest priority first. */
export class DistanceBandFee implements DeliveryFeeStrategy {
  deliveryFee({ distanceM, fees }: FeeContext): Centavos | null {
    const band = fees.rules
      .filter((rule) => rule.kind === "delivery_distance_band")
      .sort((a, b) => a.priority - b.priority)
      .find(
        (rule) =>
          distanceM >= (rule.minDistanceM ?? 0) &&
          (rule.maxDistanceM === null || distanceM < rule.maxDistanceM),
      );
    return band ? band.feeCentavos : null;
  }
}

/** Zone base fee plus a per-km rate after the first kilometre (used when a zone has no bands). */
export class ZoneBaseFee implements DeliveryFeeStrategy {
  deliveryFee({ distanceM, fees }: FeeContext): Centavos {
    const extraKm = Math.max(0, Math.ceil(distanceM / 1000) - 1);
    return fees.baseFeeCentavos + extraKm * fees.perKmCentavos;
  }
}

/** fee_rules kind small_order_fee: charged when the subtotal is below the rule's minimum. */
export class SmallOrderFee implements SurchargeStrategy {
  readonly kind = "small_order" as const;

  amount({ subtotalCentavos, fees }: FeeContext): Centavos {
    const rule = fees.rules
      .filter((r) => r.kind === "small_order_fee" && r.minSubtotalCentavos !== null)
      .sort((a, b) => a.priority - b.priority)
      .find((r) => subtotalCentavos < (r.minSubtotalCentavos ?? 0));
    return rule ? rule.feeCentavos : 0;
  }
}

/** fee_rules kind service_fee: the highest-priority service fee, if any. */
export class ServiceFee implements SurchargeStrategy {
  readonly kind = "service" as const;

  amount({ fees }: FeeContext): Centavos {
    const rule = [...fees.rules]
      .filter((r) => r.kind === "service_fee")
      .sort((a, b) => a.priority - b.priority)[0];
    return rule ? rule.feeCentavos : 0;
  }
}

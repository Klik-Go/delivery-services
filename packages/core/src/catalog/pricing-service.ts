import type { CartQuoteRequest } from "@klikgo/types";
import { NotFoundError, type AppError } from "../shared/errors";
import { addCentavos, type Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { Clock } from "../ports/clock";
import type { DeliveryFeeStrategy, FeeContext, SurchargeStrategy } from "./fee-strategies";
import { etaRange, roadMeters } from "./geo";
import { openingStatus, type OpeningStatus } from "./hours";
import type { IPricingCatalog, IServiceArea, PricedItem, QuoteCatalog, ZoneFees } from "./ports";

/** Why a cart line could not be priced. */
export type QuoteIssueCode = "not_found" | "sold_out" | "choices_needed" | "invalid_choice";

/** One priced cart line. */
export interface QuoteLine {
  readonly itemId: string;
  readonly name: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  readonly optionNames: readonly string[];
  /** The menu price of one unit, before paid choices. */
  readonly basePriceCentavos: Centavos;
  /** Paid choices for one unit (sum of option price deltas). */
  readonly modifiersUnitCentavos: Centavos;
  readonly unitPriceCentavos: Centavos;
  readonly lineTotalCentavos: Centavos;
}

/** The server's price for a cart; the UI shows exactly these numbers. */
export interface CartQuote {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly lines: readonly QuoteLine[];
  readonly issues: readonly { readonly itemId: string; readonly code: QuoteIssueCode }[];
  readonly subtotalCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly smallOrderFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  readonly totalCentavos: Centavos;
  readonly distanceMeters: number;
  readonly eta: { readonly min: number; readonly max: number };
  /** Whether this store delivers to the pin (same zone, within the store's radius). */
  readonly deliverable: boolean;
  readonly opening: OpeningStatus;
}

/**
 * Prices carts on the server (docs/BUILD_PLAN.md Phase 4): menu prices and choices from the
 * database, a delivery fee from the first strategy that applies, then surcharges. Never trusts a
 * price from the browser.
 */
export class PricingService {
  constructor(
    private readonly deps: {
      catalog: IPricingCatalog;
      serviceArea: IServiceArea;
      delivery: readonly DeliveryFeeStrategy[];
      surcharges: readonly SurchargeStrategy[];
      clock: Clock;
    },
  ) {}

  /** The delivery fee for a trip of `distanceM` in a zone (also used for feed estimates). */
  deliveryFee(fees: ZoneFees, distanceM: number): Centavos {
    const context: FeeContext = { distanceM, subtotalCentavos: 0, fees };
    for (const strategy of this.deps.delivery) {
      const fee = strategy.deliveryFee(context);
      if (fee !== null) return fee;
    }
    return 0;
  }

  async quote(request: CartQuoteRequest): Promise<Result<CartQuote, AppError>> {
    const priced = await this.quoteWithStore(request);
    return priced.ok ? ok(priced.value.quote) : priced;
  }

  /** The quote plus the store details checkout needs (zone, cash on delivery, hours). */
  async quoteWithStore(
    request: CartQuoteRequest,
  ): Promise<Result<{ quote: CartQuote; store: QuoteCatalog["merchant"] }, AppError>> {
    const catalog = await this.deps.catalog.loadForQuote(request.merchantId, [
      ...new Set(request.items.map((line) => line.itemId)),
    ]);
    if (!catalog) return err(new NotFoundError("Store", request.merchantId));
    const { merchant, fees } = catalog;
    const items = new Map(catalog.items.map((item) => [item.id, item]));

    const lines: QuoteLine[] = [];
    const issues: { itemId: string; code: QuoteIssueCode }[] = [];
    for (const line of request.items) {
      const item = items.get(line.itemId);
      const priced = item
        ? priceLine(item, line.quantity, line.optionIds)
        : { issue: "not_found" as const };
      if ("issue" in priced) issues.push({ itemId: line.itemId, code: priced.issue });
      else lines.push(priced);
    }

    const subtotal = addCentavos(...lines.map((line) => line.lineTotalCentavos));
    const distanceM = roadMeters(merchant.location, request.dropoff);
    const zone = await this.deps.serviceArea.zoneFor(request.dropoff);
    const context: FeeContext = { distanceM, subtotalCentavos: subtotal, fees };
    const deliveryFee = this.deliveryFee(fees, distanceM);
    const surcharge = (kind: SurchargeStrategy["kind"]): Centavos =>
      addCentavos(
        ...this.deps.surcharges.filter((s) => s.kind === kind).map((s) => s.amount(context)),
      );
    const smallOrderFee = lines.length > 0 ? surcharge("small_order") : 0;
    const serviceFee = lines.length > 0 ? surcharge("service") : 0;

    const quote: CartQuote = {
      merchantId: merchant.id,
      merchantName: merchant.name,
      lines,
      issues,
      subtotalCentavos: subtotal,
      deliveryFeeCentavos: deliveryFee,
      smallOrderFeeCentavos: smallOrderFee,
      serviceFeeCentavos: serviceFee,
      totalCentavos: addCentavos(subtotal, deliveryFee, smallOrderFee, serviceFee),
      distanceMeters: distanceM,
      eta: etaRange(merchant.prepMinutes, distanceM),
      deliverable: zone?.id === merchant.zoneId && distanceM <= merchant.radiusKm * 1000,
      opening: openingStatus(merchant, this.deps.clock.now()),
    };
    return ok({ quote, store: merchant });
  }
}

function priceLine(
  item: PricedItem,
  quantity: number,
  optionIds: readonly string[],
): QuoteLine | { issue: QuoteIssueCode } {
  if (!item.isAvailable) return { issue: "sold_out" };
  const chosen = new Set(optionIds);
  const known = new Set(item.groups.flatMap((group) => group.options.map((option) => option.id)));
  if ([...chosen].some((id) => !known.has(id))) return { issue: "invalid_choice" };

  let unit = item.priceCentavos;
  const names: string[] = [];
  for (const group of item.groups) {
    const picked = group.options.filter((option) => chosen.has(option.id));
    const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;
    if (picked.length < min) return { issue: "choices_needed" };
    if (picked.length > group.maxSelect) return { issue: "invalid_choice" };
    if (picked.some((option) => !option.isAvailable)) return { issue: "sold_out" };
    for (const option of picked) {
      unit += option.priceDeltaCentavos;
      names.push(option.name);
    }
  }
  return {
    itemId: item.id,
    name: item.name,
    quantity,
    optionIds: [...chosen],
    optionNames: names,
    basePriceCentavos: item.priceCentavos,
    modifiersUnitCentavos: unit - item.priceCentavos,
    unitPriceCentavos: unit,
    lineTotalCentavos: unit * quantity,
  };
}

import type { SessionUser } from "../auth/session-user";
import type { CartQuote, PricingService, QuoteIssueCode } from "../catalog/pricing-service";
import { NotFoundError, UnauthorizedError, type AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { HistoryOrder, IOrderHistoryRepository } from "./ports";

/** Orders per page of the history. */
export const HISTORY_PAGE = 20;

/** One line of a reorder: what was ordered, and whether it can be ordered again now. */
export interface ReorderLine {
  readonly itemId: string | null;
  readonly name: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
  readonly available: boolean;
  /** Why not: gone from the menu, sold out, or its choices changed. */
  readonly issue: QuoteIssueCode | "removed" | null;
  /** Today's price for one unit (null when unavailable). */
  readonly unitPriceCentavos: Centavos | null;
}

/** A past order turned back into a cart, priced today. */
export interface ReorderPlan {
  readonly merchantId: string;
  readonly merchantSlug: string;
  readonly lines: readonly ReorderLine[];
  /** Today's quote for the available lines; null when nothing can be ordered again. */
  readonly quote: CartQuote | null;
}

/**
 * Order history and reorder (docs/BUSINESS.md §9.2.1): the customer's past orders with their
 * rating state, and "Order again", which prices the same items today and flags anything that
 * is gone, sold out or whose choices changed. Nothing is placed; the app fills the cart.
 */
export class OrderHistoryService {
  constructor(
    private readonly deps: { history: IOrderHistoryRepository; pricing: PricingService },
  ) {}

  async list(
    user: SessionUser | null,
    before: Date | null,
  ): Promise<Result<HistoryOrder[], AppError>> {
    if (!user) return err(new UnauthorizedError());
    return ok(await this.deps.history.history(user.id, before, HISTORY_PAGE));
  }

  async reorder(user: SessionUser | null, orderId: string): Promise<Result<ReorderPlan, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const source = await this.deps.history.reorderSource(orderId);
    if (!source || source.customerId !== user.id) return err(new NotFoundError("Order", orderId));

    const still = source.lines.filter((line) => line.menuItemId !== null);
    let quote: CartQuote | null = null;
    if (still.length > 0) {
      const priced = await this.deps.pricing.quote({
        merchantId: source.merchantId,
        items: still.map((line) => ({
          itemId: line.menuItemId ?? "",
          quantity: line.quantity,
          optionIds: [...line.optionIds],
        })),
        dropoff: source.dropoff,
      });
      if (!priced.ok) return priced;
      quote = priced.value;
    }

    const lines = source.lines.map((line): ReorderLine => {
      if (line.menuItemId === null || !quote) {
        return { ...base(line), available: false, issue: "removed", unitPriceCentavos: null };
      }
      // A store can have the same dish twice with different choices: match the exact line first.
      const priced = quote.lines.find(
        (l) =>
          l.itemId === line.menuItemId &&
          l.optionIds.length === line.optionIds.length &&
          l.optionIds.every((id) => line.optionIds.includes(id)),
      );
      if (priced) {
        return {
          ...base(line),
          available: true,
          issue: null,
          unitPriceCentavos: priced.unitPriceCentavos,
        };
      }
      const issue =
        quote.issues.find((i) => i.itemId === line.menuItemId)?.code ?? "invalid_choice";
      return { ...base(line), available: false, issue, unitPriceCentavos: null };
    });
    const anyAvailable = lines.some((line) => line.available);
    return ok({
      merchantId: source.merchantId,
      merchantSlug: source.merchantSlug,
      lines,
      quote: anyAvailable ? quote : null,
    });
  }
}

function base(line: {
  readonly menuItemId: string | null;
  readonly name: string;
  readonly quantity: number;
  readonly optionIds: readonly string[];
}): Pick<ReorderLine, "itemId" | "name" | "quantity" | "optionIds"> {
  return {
    itemId: line.menuItemId,
    name: line.name,
    quantity: line.quantity,
    optionIds: line.optionIds,
  };
}

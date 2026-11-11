import type {
  CheckoutQuoteRequest,
  OrderStatus,
  PaymentMethod,
  PlaceOrderRequest,
} from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import type { CartQuote, PricingService } from "../catalog/pricing-service";
import type { QuoteCatalog } from "../catalog/ports";
import type { Clock } from "../ports/clock";
import type { IOrderNotifier } from "../notifications/notification-service";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { PaymentGatewayRegistry } from "./gateway-registry";
import type {
  IContentHasher,
  IOrderRepository,
  IPaymentGateway,
  NewOrder,
  OrderRecord,
  OrderTimeline,
} from "./ports";
import type { AppliedPromo, PromoService } from "./promo-service";
import { deliverySlots } from "./schedule";

/** What checkout shows before the customer places the order (all numbers from the server). */
export interface CheckoutQuote {
  readonly quote: CartQuote;
  readonly promo: {
    readonly code: string;
    readonly type: AppliedPromo["type"];
    readonly discountCentavos: Centavos;
  } | null;
  /** Why the typed promo code does not apply (the rest of the quote still stands). */
  readonly promoError: string | null;
  readonly tipCentavos: Centavos;
  readonly totalCentavos: Centavos;
  readonly paymentMethods: readonly PaymentMethod[];
  /** Today's "Schedule" slots (ISO times), empty when the store cannot take them. */
  readonly slots: readonly string[];
}

/** The answer to "Place order": the same for a first request and for a retry. */
export interface PlacedOrder {
  readonly orderId: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly totalCentavos: Centavos;
  readonly paymentMethod: PaymentMethod;
  /** Where to pay (PayMongo hosted checkout); null for cash on delivery. */
  readonly checkoutUrl: string | null;
}

/** One order as its customer (or the store, zone or admin) sees it. */
export interface OrderView {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly paymentMethod: PaymentMethod;
  readonly paymentStatus: OrderRecord["paymentStatus"];
  readonly totalCentavos: Centavos;
  readonly refundedCentavos: Centavos;
  /** The hosted payment page while the order still awaits payment; null otherwise. */
  readonly checkoutUrl: string | null;
  readonly createdAt: string;
  readonly merchantName: string;
  readonly prepMinutes: number | null;
  /** When the store expects the food to be ready (accepted + prep time). */
  readonly readyBy: string | null;
  readonly rejectReason: string | null;
  readonly cancelReason: string | null;
  /** When each step happened (ISO times, null until it does): the tracking stepper. */
  readonly timeline: Readonly<Record<keyof OrderTimeline, string | null>>;
  /** True while the customer can still cancel (before the store accepts). */
  readonly canCancel: boolean;
  /** The PIN to tell the rider at the door: the customer only, until delivery. */
  readonly deliveryPin: string | null;
}

/** Return addresses for the hosted payment page. */
export interface PaymentReturnUrls {
  success(orderId: string): string;
  cancel(orderId: string): string;
}

interface Priced {
  readonly quote: CartQuote;
  readonly store: QuoteCatalog["merchant"];
  readonly promo: AppliedPromo | null;
  readonly promoError: string | null;
  readonly tipCentavos: Centavos;
  readonly totalCentavos: Centavos;
}

/** Statuses in which the customer may still need their delivery PIN. */
const LIVE_FOR_PIN: readonly OrderStatus[] = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
];

const invalid = (path: string, message: string): ValidationError =>
  new ValidationError(message, [{ path, message }]);

/**
 * Creates orders (docs/BUSINESS.md §5.2 step 1, docs/BUILD_PLAN.md Phase 5): re-prices the cart on
 * the server, applies the promo and tip, checks the store can take it, stores the order and starts
 * the payment. The Idempotency-Key makes "Place order" safe to tap twice or retry.
 */
export class OrderService {
  constructor(
    private readonly deps: {
      pricing: PricingService;
      promos: PromoService;
      orders: IOrderRepository;
      gateways: PaymentGatewayRegistry;
      hasher: IContentHasher;
      authz: AuthorizationService;
      clock: Clock;
      logger: Logger;
      notifier: IOrderNotifier;
    },
  ) {}

  /** Prices checkout (promo, tip, payment methods, slots) without placing anything. */
  async quoteCheckout(
    input: CheckoutQuoteRequest,
    actor: SessionUser | null,
  ): Promise<Result<CheckoutQuote, AppError>> {
    const priced = await this.price(input, actor?.id ?? null);
    if (!priced.ok) return priced;
    const { quote, store, promo, promoError, tipCentavos, totalCentavos } = priced.value;
    return ok({
      quote,
      promo: promo
        ? { code: promo.code, type: promo.type, discountCentavos: promo.discountCentavos }
        : null,
      promoError,
      tipCentavos,
      totalCentavos,
      paymentMethods: this.methodsFor(store),
      slots: deliverySlots(store, this.deps.clock.now()).map((slot) => slot.toISOString()),
    });
  }

  /**
   * One order for someone allowed to see it. Others get "not found", so order ids cannot be
   * probed for existence.
   */
  async view(orderId: string, actor: SessionUser | null): Promise<Result<OrderView, AppError>> {
    if (!actor) return err(new UnauthorizedError());
    const order = await this.deps.orders.findById(orderId);
    if (
      !order ||
      !this.deps.authz.can(actor, {
        type: "order.view",
        customerId: order.customerId,
        merchantId: order.merchantId,
        zoneId: order.zoneId,
      })
    ) {
      return err(new NotFoundError("Order", orderId));
    }
    return ok({
      id: order.id,
      code: order.code,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalCentavos: order.totalCentavos,
      refundedCentavos: order.payment?.refundedCentavos ?? 0,
      checkoutUrl:
        order.status === "awaiting_payment" ? (order.payment?.checkoutUrl ?? null) : null,
      createdAt: order.createdAt.toISOString(),
      merchantName: order.merchantName,
      prepMinutes: order.prepMinutes,
      readyBy:
        order.timeline.acceptedAt && order.prepMinutes
          ? new Date(order.timeline.acceptedAt.getTime() + order.prepMinutes * 60_000).toISOString()
          : null,
      rejectReason: order.rejectReason,
      cancelReason: order.cancelReason,
      timeline: {
        placedAt: iso(order.timeline.placedAt),
        acceptedAt: iso(order.timeline.acceptedAt),
        preparingAt: iso(order.timeline.preparingAt),
        readyAt: iso(order.timeline.readyAt),
        pickedUpAt: iso(order.timeline.pickedUpAt),
        deliveredAt: iso(order.timeline.deliveredAt),
        rejectedAt: iso(order.timeline.rejectedAt),
        cancelledAt: iso(order.timeline.cancelledAt),
      },
      canCancel:
        order.customerId === actor.id &&
        (order.status === "awaiting_payment" || order.status === "placed"),
      deliveryPin:
        order.customerId === actor.id && LIVE_FOR_PIN.includes(order.status)
          ? order.deliveryPin
          : null,
    });
  }

  /** Places the order once per Idempotency-Key and starts its payment. */
  async placeOrder(
    input: PlaceOrderRequest,
    context: {
      readonly idempotencyKey: string;
      readonly actor: SessionUser;
      readonly urls: PaymentReturnUrls;
    },
  ): Promise<Result<PlacedOrder, AppError>> {
    const { actor, idempotencyKey } = context;
    if (!this.deps.authz.can(actor, { type: "order.place" })) return err(new ForbiddenError());
    const requestHash = this.deps.hasher.sha256Hex(canonical(input));

    const existing = await this.deps.orders.findByIdempotencyKey(actor.id, idempotencyKey);
    if (existing) return this.replay(existing, requestHash, context.urls);

    const gateway = this.deps.gateways.forMethod(input.paymentMethod);
    if (!gateway) return err(invalid("paymentMethod", "That payment method is not available."));

    const priced = await this.price(input, actor.id);
    if (!priced.ok) return priced;
    const checked = this.checkOrderable(input, priced.value, gateway);
    if (!checked.ok) return checked;
    const { quote, store, promo, tipCentavos, totalCentavos } = priced.value;

    const order: NewOrder = {
      customerId: actor.id,
      merchantId: quote.merchantId,
      zoneId: store.zoneId,
      status: gateway.paysUpfront ? "awaiting_payment" : "placed",
      paymentMethod: input.paymentMethod,
      subtotalCentavos: quote.subtotalCentavos,
      deliveryFeeCentavos: quote.deliveryFeeCentavos,
      serviceFeeCentavos: quote.serviceFeeCentavos,
      smallOrderFeeCentavos: quote.smallOrderFeeCentavos,
      discountCentavos: promo?.discountCentavos ?? 0,
      tipCentavos,
      totalCentavos,
      address: input.address,
      dropoff: input.dropoff,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      prepMinutes: store.prepMinutes,
      idempotencyKey,
      requestHash,
      lines: quote.lines.map((line) => ({
        menuItemId: line.itemId,
        name: line.name,
        basePriceCentavos: line.basePriceCentavos,
        modifiersUnitCentavos: line.modifiersUnitCentavos,
        quantity: line.quantity,
        modifiers: line.optionIds.map((id, i) => ({ id, name: line.optionNames[i] ?? "" })),
        lineTotalCentavos: line.lineTotalCentavos,
      })),
      promo: promo ? { promoId: promo.promoId, discountCentavos: promo.discountCentavos } : null,
    };

    const created = await this.deps.orders.create(order);
    if (!created) {
      // A parallel request with the same key created the order first: answer with that one.
      const raced = await this.deps.orders.findByIdempotencyKey(actor.id, idempotencyKey);
      if (!raced) return err(new ConflictError("Please try placing the order again."));
      return this.replay(raced, requestHash, context.urls);
    }
    this.deps.logger.info("order.created", {
      orderId: created.id,
      merchantId: order.merchantId,
      paymentMethod: order.paymentMethod,
      totalCentavos: order.totalCentavos,
    });
    const started = await this.startPayment(
      { id: created.id, code: created.code, status: order.status, totalCentavos },
      input.paymentMethod,
      gateway,
      context.urls,
    );
    // Cash on delivery goes straight to the store; online orders are announced once paid.
    if (started.ok && order.status === "placed") {
      await this.deps.notifier.statusChanged(
        {
          id: created.id,
          code: created.code,
          customerId: actor.id,
          merchantId: order.merchantId,
          merchantName: store.name,
          totalCentavos,
        },
        "placed",
      );
    }
    return started;
  }

  /** The same Idempotency-Key again: the same order (resuming its payment if it never started). */
  private async replay(
    existing: OrderRecord,
    requestHash: string,
    urls: PaymentReturnUrls,
  ): Promise<Result<PlacedOrder, AppError>> {
    if (existing.requestHash !== requestHash) {
      return err(new ConflictError("This checkout was already used for a different order."));
    }
    if (existing.payment) return ok(placedFrom(existing, existing.payment.checkoutUrl));
    const gateway = this.deps.gateways.forMethod(existing.paymentMethod);
    if (!gateway) return err(invalid("paymentMethod", "That payment method is not available."));
    return this.startPayment(existing, existing.paymentMethod, gateway, urls);
  }

  private async startPayment(
    order: Pick<OrderRecord, "id" | "code" | "status" | "totalCentavos">,
    method: PaymentMethod,
    gateway: IPaymentGateway,
    urls: PaymentReturnUrls,
  ): Promise<Result<PlacedOrder, AppError>> {
    const started = await gateway.startCheckout({
      orderId: order.id,
      orderCode: order.code,
      method,
      amountCentavos: order.totalCentavos,
      description: `Klik Go order ${order.code}`,
      successUrl: urls.success(order.id),
      cancelUrl: urls.cancel(order.id),
    });
    if (!started.ok) {
      // The order waits (awaiting_payment) and is cancelled by the timeout if never paid; the
      // same Idempotency-Key retries the payment start.
      this.deps.logger.error("order.payment_start_failed", {
        orderId: order.id,
        gateway: gateway.name,
        code: started.error.code,
      });
      return err(new ServiceUnavailableError("We couldn't start the payment. Please try again."));
    }
    await this.deps.orders.attachPayment(order.id, {
      gateway: gateway.name,
      intentId: started.value.intentId,
      method,
      amountCentavos: order.totalCentavos,
      checkoutUrl: started.value.checkoutUrl,
    });
    return ok({
      orderId: order.id,
      code: order.code,
      status: order.status,
      totalCentavos: order.totalCentavos,
      paymentMethod: method,
      checkoutUrl: started.value.checkoutUrl,
    });
  }

  /** Re-prices the cart and applies the promo and tip. A bad promo is reported, not fatal. */
  private async price(
    input: CheckoutQuoteRequest,
    userId: string | null,
  ): Promise<Result<Priced, AppError>> {
    const priced = await this.deps.pricing.quoteWithStore(input);
    if (!priced.ok) return priced;
    const { quote, store } = priced.value;
    let promo: AppliedPromo | null = null;
    let promoError: string | null = null;
    if (input.promoCode) {
      if (!userId) promoError = "Sign in to use a promo code.";
      else {
        const applied = await this.deps.promos.apply(input.promoCode, {
          userId,
          zoneId: store.zoneId,
          merchantId: store.id,
          subtotalCentavos: quote.subtotalCentavos,
          deliveryFeeCentavos: quote.deliveryFeeCentavos,
        });
        if (applied.ok) promo = applied.value;
        else promoError = applied.error.message;
      }
    }
    const totalCentavos = quote.totalCentavos - (promo?.discountCentavos ?? 0) + input.tipCentavos;
    return ok({ quote, store, promo, promoError, tipCentavos: input.tipCentavos, totalCentavos });
  }

  /** Everything that must hold before an order is stored. */
  private checkOrderable(
    input: PlaceOrderRequest,
    priced: Priced,
    gateway: IPaymentGateway,
  ): Result<void, AppError> {
    const { quote, store, promoError } = priced;
    if (quote.issues.length > 0 || quote.lines.length === 0) {
      return err(
        new ValidationError(
          "Some items in your cart can't be ordered. Please review your cart.",
          quote.issues.map((issue) => ({ path: `items.${issue.itemId}`, message: issue.code })),
        ),
      );
    }
    if (!quote.deliverable) {
      return err(invalid("dropoff", "This store doesn't deliver to your pin."));
    }
    if (promoError) return err(invalid("promoCode", promoError));
    if (!this.methodsFor(store).includes(input.paymentMethod)) {
      return err(invalid("paymentMethod", "This store doesn't take that payment method."));
    }
    if (gateway.paysUpfront && priced.totalCentavos <= 0) {
      return err(invalid("paymentMethod", "Nothing to pay online for this order."));
    }
    if (input.scheduledFor) {
      const at = new Date(input.scheduledFor).getTime();
      const slots = deliverySlots(store, this.deps.clock.now());
      if (!slots.some((slot) => slot.getTime() === at)) {
        return err(invalid("scheduledFor", "Please pick one of today's delivery times."));
      }
    } else if (!quote.opening.open) {
      return err(new ConflictError("This store is closed right now."));
    }
    return ok(undefined);
  }

  private methodsFor(store: QuoteCatalog["merchant"]): PaymentMethod[] {
    return this.deps.gateways
      .availableMethods()
      .filter((method) => store.acceptsCod || this.deps.gateways.forMethod(method)?.paysUpfront);
  }
}

function placedFrom(order: OrderRecord, checkoutUrl: string | null): PlacedOrder {
  return {
    orderId: order.id,
    code: order.code,
    status: order.status,
    totalCentavos: order.totalCentavos,
    paymentMethod: order.paymentMethod,
    checkoutUrl,
  };
}

/** A stable text form of the request: equal carts give equal hashes whatever the order of keys. */
function canonical(input: PlaceOrderRequest): string {
  return JSON.stringify({
    merchantId: input.merchantId,
    items: [...input.items]
      .map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        optionIds: [...line.optionIds].sort(),
      }))
      .sort((a, b) =>
        `${a.itemId}:${a.optionIds.join(",")}`.localeCompare(
          `${b.itemId}:${b.optionIds.join(",")}`,
        ),
      ),
    dropoff: [input.dropoff.lat, input.dropoff.lng],
    address: Object.fromEntries(
      Object.entries(input.address).sort(([a], [b]) => a.localeCompare(b)),
    ),
    paymentMethod: input.paymentMethod,
    promoCode: input.promoCode ?? null,
    tipCentavos: input.tipCentavos,
    scheduledFor: input.scheduledFor ?? null,
  });
}

const iso = (at: Date | null): string | null => (at ? at.toISOString() : null);

import type {
  AppRole,
  CheckoutAddress,
  LedgerAccount,
  LedgerParty,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PromoType,
  RefundStatus,
} from "@klikgo/types";
import type { GeoPoint } from "../merchant/ports";
import type { AppError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import type { Result } from "../shared/result";

// ---------------------------------------------------------------------------
// Promos
// ---------------------------------------------------------------------------

/** A promo code with what the checkout needs to judge it for one customer. */
export interface PromoRecord {
  readonly id: string;
  readonly code: string;
  readonly type: PromoType;
  readonly discountBps: number | null;
  readonly discountCentavos: Centavos | null;
  readonly maxDiscountCentavos: Centavos | null;
  readonly minSubtotalCentavos: Centavos;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly maxRedemptions: number | null;
  readonly perUserLimit: number;
  readonly zoneId: string | null;
  readonly merchantId: string | null;
  readonly fundedBy: "platform" | "merchant";
  readonly isActive: boolean;
  /** Redemptions so far, by everyone and by this customer. */
  readonly redemptions: number;
  readonly redemptionsByUser: number;
}

export interface IPromoRepository {
  findByCode(code: string, userId: string): Promise<PromoRecord | null>;
}

// ---------------------------------------------------------------------------
// Orders and payments
// ---------------------------------------------------------------------------

/** One priced cart line, snapshotted onto the order. */
export interface NewOrderLine {
  readonly menuItemId: string;
  readonly name: string;
  readonly basePriceCentavos: Centavos;
  readonly modifiersUnitCentavos: Centavos;
  readonly quantity: number;
  readonly modifiers: readonly { readonly id: string; readonly name: string }[];
  readonly lineTotalCentavos: Centavos;
}

/** Everything the database stores for a new order (all amounts already priced by the server). */
export interface NewOrder {
  readonly customerId: string;
  readonly merchantId: string;
  readonly zoneId: string;
  readonly status: "awaiting_payment" | "placed";
  readonly paymentMethod: PaymentMethod;
  readonly subtotalCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  readonly smallOrderFeeCentavos: Centavos;
  readonly discountCentavos: Centavos;
  readonly tipCentavos: Centavos;
  readonly totalCentavos: Centavos;
  readonly address: CheckoutAddress;
  readonly dropoff: GeoPoint;
  readonly scheduledFor: Date | null;
  readonly prepMinutes: number;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly lines: readonly NewOrderLine[];
  readonly promo: { readonly promoId: string; readonly discountCentavos: Centavos } | null;
}

/** A payment row as checkout and webhooks see it. */
export interface PaymentRecord {
  readonly id: string;
  readonly orderId: string;
  readonly gateway: string;
  readonly intentId: string;
  readonly method: PaymentMethod;
  readonly amountCentavos: Centavos;
  readonly status: PaymentStatus;
  readonly checkoutUrl: string | null;
  readonly gatewayPaymentId: string | null;
  readonly feeCentavos: Centavos | null;
  readonly refundedCentavos: Centavos;
}

/** When an order reached each status (null until it does). */
export interface OrderTimeline {
  readonly placedAt: Date | null;
  readonly acceptedAt: Date | null;
  readonly preparingAt: Date | null;
  readonly readyAt: Date | null;
  readonly pickedUpAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly rejectedAt: Date | null;
  readonly cancelledAt: Date | null;
}

/** An order with its payment (if one was started). */
export interface OrderRecord {
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  readonly merchantId: string;
  /** The store's name, for messages to the customer. */
  readonly merchantName: string;
  readonly zoneId: string;
  /** Minutes the store said it needs (set when it accepts). */
  readonly prepMinutes: number | null;
  readonly rejectReason: string | null;
  readonly cancelReason: string | null;
  readonly timeline: OrderTimeline;
  readonly status: OrderStatus;
  readonly paymentMethod: PaymentMethod;
  readonly paymentStatus: PaymentStatus;
  readonly totalCentavos: Centavos;
  readonly requestHash: string | null;
  readonly createdAt: Date;
  readonly payment: PaymentRecord | null;
  /** The 4-digit PIN the customer tells the rider (big orders only); never shown to staff. */
  readonly deliveryPin: string | null;
}

/** A payment to record once the gateway has started a checkout. */
export interface NewPayment {
  readonly gateway: string;
  readonly intentId: string;
  readonly method: PaymentMethod;
  readonly amountCentavos: Centavos;
  readonly checkoutUrl: string | null;
}

export interface IOrderRepository {
  findById(orderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(customerId: string, key: string): Promise<OrderRecord | null>;
  /**
   * Creates the order, its lines and the promo redemption in one transaction (the database writes
   * the first order_events row). Returns null when another request with the same customer and
   * Idempotency-Key won the race; the caller then reads that order.
   */
  create(order: NewOrder): Promise<{ readonly id: string; readonly code: string } | null>;
  attachPayment(orderId: string, payment: NewPayment): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/** One ledger line: exactly one of debit or credit is above zero. */
export interface LedgerLine {
  readonly account: LedgerAccount;
  readonly partyType: LedgerParty;
  readonly partyId: string | null;
  readonly debitCentavos: Centavos;
  readonly creditCentavos: Centavos;
  readonly memo: string;
}

/** A balanced set of ledger lines for one order, written in one database transaction. */
export interface LedgerTxn {
  readonly orderId: string;
  readonly lines: readonly LedgerLine[];
}

// ---------------------------------------------------------------------------
// Payment events and refunds (each method is one database transaction)
// ---------------------------------------------------------------------------

export interface IPaymentRepository {
  findByIntent(
    gateway: string,
    intentId: string,
  ): Promise<{ readonly payment: PaymentRecord; readonly order: OrderRecord } | null>;
  /**
   * Marks the payment paid (gateway payment id, fee, time), writes the capture to the ledger and
   * moves the order from awaiting_payment to placed as the system, if it is still waiting (the
   * update is conditional, so a timeout that won the race keeps the order cancelled). Changes
   * nothing when the payment was already paid.
   */
  recordCapture(input: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly gatewayPaymentId: string;
    readonly feeCentavos: Centavos;
    readonly paidAt: Date;
    readonly ledger: LedgerTxn;
  }): Promise<{ readonly alreadyPaid: boolean; readonly orderStatus: OrderStatus }>;
  /** Marks a still-pending payment failed (the order keeps waiting until its timeout). */
  recordFailure(paymentId: string): Promise<void>;
  /** Money still held for the customer for this order (customer_deposits balance). */
  depositBalance(orderId: string): Promise<Centavos>;
  /**
   * Reserves a refund: adds the amount to payments.refunded_centavos (never past the amount paid)
   * and creates a pending refund row. Null when the refund would exceed what is left.
   */
  reserveRefund(input: {
    readonly paymentId: string;
    readonly orderId: string;
    readonly amountCentavos: Centavos;
    readonly reason: string;
    readonly requestedBy: string | null;
  }): Promise<{ readonly refundId: string } | null>;
  /** The gateway accepted the refund: store its reference and status, update statuses, ledger. */
  completeRefund(input: {
    readonly refundId: string;
    readonly paymentId: string;
    readonly gatewayRef: string;
    readonly status: Extract<RefundStatus, "pending" | "succeeded">;
    readonly ledger: LedgerTxn;
  }): Promise<void>;
  /** The gateway refused: release the reservation and mark the refund failed. */
  failRefund(input: {
    readonly refundId: string;
    readonly paymentId: string;
    readonly amountCentavos: Centavos;
  }): Promise<void>;
  /** A refund webhook: update the refund with this gateway reference. Returns false if unknown. */
  updateRefundStatus(gatewayRef: string, status: RefundStatus): Promise<boolean>;
}

/** Webhook deliveries, stored before processing so retries are idempotent (webhook_events). */
export interface IWebhookEventStore {
  /** `new` the first time; `processed` if an earlier delivery finished; `pending` otherwise. */
  record(
    gateway: string,
    eventId: string,
    type: string,
    payload: unknown,
  ): Promise<"new" | "processed" | "pending">;
  markProcessed(gateway: string, eventId: string, error: string | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// Payment gateways (strategy registry; no switch on method names in services)
// ---------------------------------------------------------------------------

export interface CheckoutStartRequest {
  readonly orderId: string;
  readonly orderCode: string;
  readonly method: PaymentMethod;
  readonly amountCentavos: Centavos;
  readonly description: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface CheckoutStart {
  readonly intentId: string;
  /** Where the customer pays (null for cash on delivery). */
  readonly checkoutUrl: string | null;
}

export type GatewayPaymentStatus = "pending" | "paid" | "expired" | "failed";

export interface IPaymentGateway {
  /** Stored in payments.gateway ("paymongo" or "cod"). */
  readonly name: string;
  readonly methods: readonly PaymentMethod[];
  /** True when the customer pays before the store sees the order; false for cash on delivery. */
  readonly paysUpfront: boolean;
  startCheckout(request: CheckoutStartRequest): Promise<Result<CheckoutStart, AppError>>;
  status(intentId: string): Promise<Result<GatewayPaymentStatus, AppError>>;
  refund(request: {
    readonly gatewayPaymentId: string;
    readonly amountCentavos: Centavos;
    readonly reason: string;
  }): Promise<Result<{ readonly ref: string; readonly status: "pending" | "succeeded" }, AppError>>;
}

/** A verified, gateway-neutral webhook event. */
export type PaymentEvent =
  | {
      readonly kind: "payment_paid";
      readonly gateway: string;
      readonly eventId: string;
      readonly type: string;
      readonly intentId: string;
      readonly gatewayPaymentId: string;
      readonly amountCentavos: Centavos;
      readonly feeCentavos: Centavos;
      readonly payload: unknown;
    }
  | {
      readonly kind: "payment_failed";
      readonly gateway: string;
      readonly eventId: string;
      readonly type: string;
      readonly intentId: string;
      readonly payload: unknown;
    }
  | {
      readonly kind: "refund_updated";
      readonly gateway: string;
      readonly eventId: string;
      readonly type: string;
      readonly gatewayRef: string;
      readonly status: RefundStatus;
      readonly payload: unknown;
    }
  | {
      readonly kind: "ignored";
      readonly gateway: string;
      readonly eventId: string;
      readonly type: string;
      readonly payload: unknown;
    };

/** Checks a webhook's signature and turns it into a {@link PaymentEvent}. */
export interface IPaymentWebhookVerifier {
  verify(rawBody: string, signature: string | null, now: Date): Result<PaymentEvent, AppError>;
}

/** SHA-256 of a string, as 64 lowercase hex characters (request fingerprints). */
export interface IContentHasher {
  sha256Hex(text: string): string;
}

// ---------------------------------------------------------------------------
// Order lifecycle (Phase 6)
// ---------------------------------------------------------------------------

/**
 * One or more status changes made together (e.g. accepted then preparing) by one actor. The
 * repository applies them in one transaction only if the order is still `from`, sets the actor
 * for the database's order_events rows, and reports false when someone else changed it first.
 */
export interface StatusChangeRequest {
  readonly orderId: string;
  readonly from: OrderStatus;
  readonly steps: readonly OrderStatus[];
  /** Null id and role for the platform itself. */
  readonly actor: { readonly id: string | null; readonly role: AppRole | null };
  readonly meta: Readonly<Record<string, string | number>>;
  readonly prepMinutes?: number;
  readonly rejectReason?: string;
  readonly cancelReason?: string;
  /** Gives a used promo back (rejected or cancelled orders). */
  readonly releasePromo?: boolean;
}

/** An order as the store's board shows it: no customer details beyond what cooking needs. */
export interface BoardOrder {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatus;
  readonly paymentMethod: PaymentMethod;
  readonly paymentStatus: PaymentStatus;
  readonly totalCentavos: Centavos;
  readonly placedAt: Date;
  readonly acceptedAt: Date | null;
  readonly prepMinutes: number | null;
  readonly scheduledFor: Date | null;
  /** Set when the platform alerted the zone coordinator about a late confirmation. */
  readonly flaggedAt: Date | null;
  readonly notes: string | null;
  readonly items: readonly {
    readonly menuItemId: string | null;
    readonly name: string;
    readonly quantity: number;
    readonly modifiers: readonly string[];
  }[];
}

export interface IOrderLifecycleRepository {
  changeStatus(request: StatusChangeRequest): Promise<boolean>;
  /** The store's live orders (placed through picked up), oldest first. */
  board(merchantId: string): Promise<BoardOrder[]>;
  /** Rejected or cancelled orders still holding an online payment (to refund). */
  refundsDue(limit: number): Promise<{ readonly orderId: string; readonly reason: string }[]>;
}

import type { OrderStatus, PaymentMethod, PaymentStatus, RefundStatus } from "@klikgo/types";
import type {
  CheckoutStart,
  CheckoutStartRequest,
  GatewayPaymentStatus,
  IContentHasher,
  IOrderRepository,
  IPaymentGateway,
  IPaymentRepository,
  IPromoRepository,
  IWebhookEventStore,
  LedgerTxn,
  NewOrder,
  NewPayment,
  OrderRecord,
  PaymentRecord,
  PromoRecord,
} from "../ordering/ports";
import { AppError, ServiceUnavailableError } from "../shared/errors";
import type { Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";

interface StoredOrder extends Omit<NewOrder, "status"> {
  readonly id: string;
  readonly code: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  readonly createdAt: Date;
}

interface StoredRefund {
  readonly id: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly amountCentavos: Centavos;
  readonly reason: string;
  readonly requestedBy: string | null;
  status: RefundStatus;
  gatewayRef: string | null;
}

/**
 * Orders, payments, refunds and the ledger in memory, with the database's rules: one order per
 * customer and Idempotency-Key, one payment per order, refunds never above the amount paid,
 * conditional placement and balanced ledger transactions.
 */
export class InMemoryOrderStore implements IOrderRepository, IPaymentRepository {
  readonly orders: StoredOrder[] = [];
  readonly payments: (Omit<
    PaymentRecord,
    "status" | "gatewayPaymentId" | "feeCentavos" | "refundedCentavos"
  > & {
    status: PaymentStatus;
    gatewayPaymentId: string | null;
    feeCentavos: Centavos | null;
    refundedCentavos: Centavos;
    paidAt: Date | null;
  })[] = [];
  readonly refunds: StoredRefund[] = [];
  readonly ledger: LedgerTxn[] = [];
  readonly redemptions: { promoId: string; orderId: string; userId: string }[] = [];
  private sequence = 0;

  findById(orderId: string): Promise<OrderRecord | null> {
    return Promise.resolve(this.record(this.orders.find((o) => o.id === orderId)));
  }

  findByIdempotencyKey(customerId: string, key: string): Promise<OrderRecord | null> {
    return Promise.resolve(
      this.record(this.orders.find((o) => o.customerId === customerId && o.idempotencyKey === key)),
    );
  }

  create(order: NewOrder): Promise<{ id: string; code: string } | null> {
    if (
      this.orders.some(
        (o) => o.customerId === order.customerId && o.idempotencyKey === order.idempotencyKey,
      )
    ) {
      return Promise.resolve(null);
    }
    this.sequence += 1;
    const id = `order-${String(this.sequence)}`;
    const code = `KG-TEST${String(this.sequence).padStart(2, "0")}`;
    this.orders.push({
      ...order,
      id,
      code,
      paymentStatus: "pending",
      createdAt: new Date(0),
    });
    if (order.promo) {
      this.redemptions.push({
        promoId: order.promo.promoId,
        orderId: id,
        userId: order.customerId,
      });
    }
    return Promise.resolve({ id, code });
  }

  attachPayment(orderId: string, payment: NewPayment): Promise<void> {
    if (this.payments.some((p) => p.orderId === orderId)) {
      throw new Error("payments_one_per_order");
    }
    this.payments.push({
      ...payment,
      id: `payment-${orderId}`,
      orderId,
      status: "pending",
      gatewayPaymentId: null,
      feeCentavos: null,
      refundedCentavos: 0,
      paidAt: null,
    });
    return Promise.resolve();
  }

  findByIntent(
    gateway: string,
    intentId: string,
  ): Promise<{ payment: PaymentRecord; order: OrderRecord } | null> {
    const payment = this.payments.find((p) => p.gateway === gateway && p.intentId === intentId);
    const order = payment ? this.record(this.orders.find((o) => o.id === payment.orderId)) : null;
    return Promise.resolve(payment && order ? { payment: { ...payment }, order } : null);
  }

  recordCapture(input: {
    paymentId: string;
    orderId: string;
    gatewayPaymentId: string;
    feeCentavos: Centavos;
    paidAt: Date;
    ledger: LedgerTxn;
  }): Promise<{ alreadyPaid: boolean; orderStatus: OrderStatus }> {
    const payment = this.paymentById(input.paymentId);
    const order = this.orderById(input.orderId);
    if (
      payment.status === "paid" ||
      payment.status === "refunded" ||
      payment.status === "partially_refunded"
    ) {
      return Promise.resolve({ alreadyPaid: true, orderStatus: order.status });
    }
    payment.status = "paid";
    payment.gatewayPaymentId = input.gatewayPaymentId;
    payment.feeCentavos = input.feeCentavos;
    payment.paidAt = input.paidAt;
    order.paymentStatus = "paid";
    if (order.status === "awaiting_payment") order.status = "placed";
    this.post(input.ledger);
    return Promise.resolve({ alreadyPaid: false, orderStatus: order.status });
  }

  recordFailure(paymentId: string): Promise<void> {
    const payment = this.paymentById(paymentId);
    payment.status = "failed";
    this.orderById(payment.orderId).paymentStatus = "failed";
    return Promise.resolve();
  }

  depositBalance(orderId: string): Promise<Centavos> {
    const balance = this.ledger
      .filter((txn) => txn.orderId === orderId)
      .flatMap((txn) => txn.lines)
      .filter((line) => line.account === "customer_deposits")
      .reduce((sum, line) => sum + line.creditCentavos - line.debitCentavos, 0);
    return Promise.resolve(balance);
  }

  reserveRefund(input: {
    paymentId: string;
    orderId: string;
    amountCentavos: Centavos;
    reason: string;
    requestedBy: string | null;
  }): Promise<{ refundId: string } | null> {
    const payment = this.paymentById(input.paymentId);
    if (payment.refundedCentavos + input.amountCentavos > payment.amountCentavos) {
      return Promise.resolve(null);
    }
    payment.refundedCentavos += input.amountCentavos;
    const refundId = `refund-${String(this.refunds.length + 1)}`;
    this.refunds.push({ ...input, id: refundId, status: "pending", gatewayRef: null });
    return Promise.resolve({ refundId });
  }

  completeRefund(input: {
    refundId: string;
    paymentId: string;
    gatewayRef: string;
    status: "pending" | "succeeded";
    ledger: LedgerTxn;
  }): Promise<void> {
    const refund = this.refunds.find((r) => r.id === input.refundId);
    if (!refund) throw new Error(`No refund ${input.refundId}`);
    refund.gatewayRef = input.gatewayRef;
    refund.status = input.status;
    const payment = this.paymentById(input.paymentId);
    payment.status =
      payment.refundedCentavos >= payment.amountCentavos ? "refunded" : "partially_refunded";
    this.orderById(payment.orderId).paymentStatus = payment.status;
    this.post(input.ledger);
    return Promise.resolve();
  }

  failRefund(input: {
    refundId: string;
    paymentId: string;
    amountCentavos: Centavos;
  }): Promise<void> {
    const refund = this.refunds.find((r) => r.id === input.refundId);
    if (refund) refund.status = "failed";
    this.paymentById(input.paymentId).refundedCentavos -= input.amountCentavos;
    return Promise.resolve();
  }

  updateRefundStatus(gatewayRef: string, status: RefundStatus): Promise<boolean> {
    const refund = this.refunds.find((r) => r.gatewayRef === gatewayRef);
    if (refund) refund.status = status;
    return Promise.resolve(refund !== undefined);
  }

  /** Test helper: what the unpaid-order timeout does. */
  cancelUnpaid(orderId: string): void {
    const order = this.orderById(orderId);
    order.status = "cancelled";
    order.paymentStatus = "failed";
  }

  /** Sum of debits minus credits over an order's ledger (0 when it balances). */
  ledgerNet(orderId: string): Centavos {
    return this.ledger
      .filter((txn) => txn.orderId === orderId)
      .flatMap((txn) => txn.lines)
      .reduce((sum, line) => sum + line.debitCentavos - line.creditCentavos, 0);
  }

  private post(txn: LedgerTxn): void {
    const net = txn.lines.reduce((sum, l) => sum + l.debitCentavos - l.creditCentavos, 0);
    if (net !== 0) throw new Error(`ledger transaction is unbalanced: ${String(net)}`);
    this.ledger.push(txn);
  }

  private orderById(id: string): StoredOrder {
    const order = this.orders.find((o) => o.id === id);
    if (!order) throw new Error(`No order ${id}`);
    return order;
  }

  private paymentById(id: string): InMemoryOrderStore["payments"][number] {
    const payment = this.payments.find((p) => p.id === id);
    if (!payment) throw new Error(`No payment ${id}`);
    return payment;
  }

  private record(order: StoredOrder | undefined): OrderRecord | null {
    if (!order) return null;
    const payment = this.payments.find((p) => p.orderId === order.id);
    return {
      id: order.id,
      code: order.code,
      customerId: order.customerId,
      merchantId: order.merchantId,
      zoneId: order.zoneId,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      totalCentavos: order.totalCentavos,
      requestHash: order.requestHash,
      createdAt: order.createdAt,
      payment: payment
        ? {
            id: payment.id,
            orderId: payment.orderId,
            gateway: payment.gateway,
            intentId: payment.intentId,
            method: payment.method,
            amountCentavos: payment.amountCentavos,
            status: payment.status,
            checkoutUrl: payment.checkoutUrl,
            gatewayPaymentId: payment.gatewayPaymentId,
            feeCentavos: payment.feeCentavos,
            refundedCentavos: payment.refundedCentavos,
          }
        : null,
    };
  }
}

/** Webhook deliveries in memory (unique per gateway + event id). */
export class InMemoryWebhookEvents implements IWebhookEventStore {
  readonly events = new Map<string, { type: string; processed: boolean; error: string | null }>();

  record(gateway: string, eventId: string, type: string): Promise<"new" | "processed" | "pending"> {
    const key = `${gateway}:${eventId}`;
    const seen = this.events.get(key);
    if (seen) return Promise.resolve(seen.processed ? "processed" : "pending");
    this.events.set(key, { type, processed: false, error: null });
    return Promise.resolve("new");
  }

  markProcessed(gateway: string, eventId: string, error: string | null): Promise<void> {
    const seen = this.events.get(`${gateway}:${eventId}`);
    if (seen) {
      seen.processed = true;
      seen.error = error;
    }
    return Promise.resolve();
  }
}

/** Promo codes in memory, counting redemptions from an {@link InMemoryOrderStore}. */
export class InMemoryPromos implements IPromoRepository {
  readonly promos: Omit<PromoRecord, "redemptions" | "redemptionsByUser">[] = [];

  constructor(private readonly store: InMemoryOrderStore) {}

  findByCode(code: string, userId: string): Promise<PromoRecord | null> {
    const promo = this.promos.find((p) => p.code === code);
    if (!promo) return Promise.resolve(null);
    const used = this.store.redemptions.filter((r) => r.promoId === promo.id);
    return Promise.resolve({
      ...promo,
      redemptions: used.length,
      redemptionsByUser: used.filter((r) => r.userId === userId).length,
    });
  }
}

/**
 * A payment gateway in memory. Online by default (stands in for PayMongo: gateway name
 * "paymongo"); can be told to fail checkouts or refunds.
 */
export class FakePaymentGateway implements IPaymentGateway {
  readonly name: string;
  readonly methods: readonly PaymentMethod[];
  readonly paysUpfront: boolean;
  readonly checkouts: CheckoutStartRequest[] = [];
  readonly refunds: { gatewayPaymentId: string; amountCentavos: Centavos; reason: string }[] = [];
  failCheckout = false;
  failRefund = false;
  private readonly checkoutBase: string;

  constructor(
    options: {
      name?: string;
      methods?: readonly PaymentMethod[];
      paysUpfront?: boolean;
      checkoutBase?: string;
    } = {},
  ) {
    this.name = options.name ?? "paymongo";
    this.methods = options.methods ?? ["gcash", "maya", "card", "qrph"];
    this.paysUpfront = options.paysUpfront ?? true;
    this.checkoutBase = options.checkoutBase ?? "https://pay.example.test/checkout";
  }

  startCheckout(request: CheckoutStartRequest): Promise<Result<CheckoutStart, AppError>> {
    if (this.failCheckout) {
      return Promise.resolve(err(new ServiceUnavailableError("Fake gateway is down.")));
    }
    this.checkouts.push(request);
    const intentId = `fake_cs_${request.orderId}_${String(this.checkouts.length)}`;
    return Promise.resolve(
      ok({
        intentId,
        checkoutUrl: this.paysUpfront ? `${this.checkoutBase}?session=${intentId}` : null,
      }),
    );
  }

  status(intentId: string): Promise<Result<GatewayPaymentStatus, AppError>> {
    return Promise.resolve(
      this.checkouts.some((c) => intentId.startsWith(`fake_cs_${c.orderId}_`))
        ? ok("pending")
        : err(new AppError("NOT_FOUND", `No checkout ${intentId}`)),
    );
  }

  refund(request: {
    gatewayPaymentId: string;
    amountCentavos: Centavos;
    reason: string;
  }): Promise<Result<{ ref: string; status: "pending" | "succeeded" }, AppError>> {
    if (this.failRefund) {
      return Promise.resolve(err(new ServiceUnavailableError("Fake gateway refused the refund.")));
    }
    this.refunds.push(request);
    return Promise.resolve(
      ok({ ref: `fake_ref_${String(this.refunds.length)}`, status: "succeeded" }),
    );
  }
}

/** Deterministic stand-in for SHA-256 (64 hex characters; equal inputs give equal outputs). */
export class FakeContentHasher implements IContentHasher {
  sha256Hex(text: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < text.length; i += 1) {
      h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + text.charCodeAt(i), 0x5bd1e995) >>> 0;
    }
    return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(4);
  }
}

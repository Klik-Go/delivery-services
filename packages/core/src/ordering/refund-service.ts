import type { AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import { formatPeso, type Centavos } from "../shared/money";
import { err, ok, type Result } from "../shared/result";
import type { PaymentGatewayRegistry } from "./gateway-registry";
import type { LedgerService } from "./ledger-service";
import type { IOrderRepository, IPaymentRepository } from "./ports";

/** A refund that the gateway accepted. */
export interface RefundResult {
  readonly refundId: string;
  readonly amountCentavos: Centavos;
  readonly status: "pending" | "succeeded";
}

/**
 * Full or partial refunds of online payments through the gateway (docs/BUILD_PLAN.md Phase 5).
 * The amount is reserved on the payment first, so two clicks can never refund more than was paid.
 * Cash payments are refunded by hand by the coordinator.
 */
export class RefundService {
  constructor(
    private readonly deps: {
      orders: IOrderRepository;
      payments: IPaymentRepository;
      gateways: PaymentGatewayRegistry;
      ledger: LedgerService;
      authz: AuthorizationService;
      logger: Logger;
    },
  ) {}

  async refund(
    input: {
      readonly orderId: string;
      readonly amountCentavos?: Centavos;
      readonly reason: string;
    },
    actor: SessionUser | "system",
  ): Promise<Result<RefundResult, AppError>> {
    const order = await this.deps.orders.findById(input.orderId);
    if (!order) return err(new NotFoundError("Order", input.orderId));
    if (
      actor !== "system" &&
      !this.deps.authz.can(actor, { type: "order.refund", zoneId: order.zoneId })
    ) {
      return err(new ForbiddenError("Only admins and the zone's coordinator can refund orders."));
    }
    const payment = order.payment;
    if (!payment || (payment.status !== "paid" && payment.status !== "partially_refunded")) {
      return err(new ConflictError("Only paid orders can be refunded."));
    }
    const gateway = this.deps.gateways.byName(payment.gateway);
    if (!gateway?.paysUpfront || !payment.gatewayPaymentId) {
      return err(new ConflictError("Cash payments are refunded by hand."));
    }
    const remaining = payment.amountCentavos - payment.refundedCentavos;
    const amount = input.amountCentavos ?? remaining;
    const tooMuch = (): Result<never, AppError> =>
      err(
        new ValidationError(`You can refund up to ${formatPeso(remaining)}.`, [
          { path: "amountCentavos", message: `At most ${formatPeso(remaining)}.` },
        ]),
      );
    if (amount <= 0 || amount > remaining) return tooMuch();

    const reserved = await this.deps.payments.reserveRefund({
      paymentId: payment.id,
      orderId: order.id,
      amountCentavos: amount,
      reason: input.reason,
      requestedBy: actor === "system" ? null : actor.id,
    });
    if (!reserved) return tooMuch();

    const sent = await gateway.refund({
      gatewayPaymentId: payment.gatewayPaymentId,
      amountCentavos: amount,
      reason: input.reason,
    });
    if (!sent.ok) {
      await this.deps.payments.failRefund({
        refundId: reserved.refundId,
        paymentId: payment.id,
        amountCentavos: amount,
      });
      this.deps.logger.error("refund.gateway_failed", { orderId: order.id, code: sent.error.code });
      return err(new ServiceUnavailableError("The refund could not be sent. Please try again."));
    }

    const deposit = await this.deps.payments.depositBalance(order.id);
    await this.deps.payments.completeRefund({
      refundId: reserved.refundId,
      paymentId: payment.id,
      gatewayRef: sent.value.ref,
      status: sent.value.status,
      ledger: this.deps.ledger.refund({
        orderId: order.id,
        customerId: order.customerId,
        amountCentavos: amount,
        fromDeposit: deposit >= amount,
      }),
    });
    this.deps.logger.info("refund.sent", {
      orderId: order.id,
      refundId: reserved.refundId,
      amountCentavos: amount,
      by: actor === "system" ? "system" : actor.id,
    });
    return ok({ refundId: reserved.refundId, amountCentavos: amount, status: sent.value.status });
  }
}

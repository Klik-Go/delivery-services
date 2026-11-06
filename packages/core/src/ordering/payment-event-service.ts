import type { IOrderNotifier } from "../notifications/notification-service";
import type { Logger } from "../ports/logger";
import type { AppError } from "../shared/errors";
import { ok, type Result } from "../shared/result";
import type { LedgerService } from "./ledger-service";
import type { OrderStateMachine } from "./order-state-machine";
import type { IPaymentRepository, IWebhookEventStore, PaymentEvent } from "./ports";
import type { RefundService } from "./refund-service";

/** What happened to a webhook delivery. */
export type WebhookOutcome = "processed" | "duplicate";

/**
 * Applies verified payment webhooks (docs/BUILD_PLAN.md Phase 5). Every event is stored once
 * (webhook_events, unique per gateway + event id) before it is processed, so retries and replays
 * never pay, credit or refund twice. Problems that a retry cannot fix (unknown payment, wrong
 * amount) are recorded on the event and answered with success; anything thrown is left unfinished
 * so the gateway's retry processes it again.
 */
export class PaymentEventService {
  constructor(
    private readonly deps: {
      events: IWebhookEventStore;
      payments: IPaymentRepository;
      ledger: LedgerService;
      states: OrderStateMachine;
      refunds: RefundService;
      notifier: IOrderNotifier;
      logger: Logger;
    },
  ) {}

  async handle(event: PaymentEvent): Promise<Result<WebhookOutcome, AppError>> {
    const seen = await this.deps.events.record(
      event.gateway,
      event.eventId,
      event.type,
      event.payload,
    );
    if (seen === "processed") {
      this.deps.logger.info("payment_event.duplicate", { eventId: event.eventId });
      return ok("duplicate");
    }
    const problem = await this.apply(event);
    await this.deps.events.markProcessed(event.gateway, event.eventId, problem);
    return ok("processed");
  }

  /** Returns a note for the event when it could not be applied (null when it was). */
  private async apply(event: PaymentEvent): Promise<string | null> {
    switch (event.kind) {
      case "ignored":
        return null;
      case "refund_updated": {
        const known = await this.deps.payments.updateRefundStatus(event.gatewayRef, event.status);
        return known ? null : "unknown refund";
      }
      case "payment_failed": {
        const found = await this.deps.payments.findByIntent(event.gateway, event.intentId);
        if (!found) return "unknown payment";
        if (found.payment.status === "pending" || found.payment.status === "processing") {
          await this.deps.payments.recordFailure(found.payment.id);
        }
        return null;
      }
      case "payment_paid":
        return this.paid(event);
    }
  }

  private async paid(
    event: Extract<PaymentEvent, { kind: "payment_paid" }>,
  ): Promise<string | null> {
    const found = await this.deps.payments.findByIntent(event.gateway, event.intentId);
    if (!found) {
      this.deps.logger.warn("payment_event.unknown_payment", { eventId: event.eventId });
      return "unknown payment";
    }
    const { payment, order } = found;
    if (event.amountCentavos !== payment.amountCentavos) {
      // Never place an order for the wrong amount; finance reviews it from the event row.
      this.deps.logger.error("payment_event.amount_mismatch", {
        eventId: event.eventId,
        orderId: order.id,
        expected: payment.amountCentavos,
        received: event.amountCentavos,
      });
      return "amount mismatch";
    }
    const placement = this.deps.states.check(order.status, "placed", "system");
    const captured = await this.deps.payments.recordCapture({
      paymentId: payment.id,
      orderId: order.id,
      gatewayPaymentId: event.gatewayPaymentId,
      feeCentavos: event.feeCentavos,
      paidAt: new Date(),
      ledger: this.deps.ledger.capture({
        orderId: order.id,
        customerId: order.customerId,
        amountCentavos: event.amountCentavos,
        feeCentavos: event.feeCentavos,
      }),
    });
    if (captured.alreadyPaid) return null;
    this.deps.logger.info("payment_event.captured", {
      orderId: order.id,
      orderStatus: captured.orderStatus,
      placementAllowed: placement.ok,
    });

    // Paid after the order timed out (or was cancelled): give the money back automatically.
    if (captured.orderStatus === "cancelled" || captured.orderStatus === "rejected") {
      const refunded = await this.deps.refunds.refund(
        { orderId: order.id, reason: "Paid after the order was cancelled" },
        "system",
      );
      if (!refunded.ok) {
        this.deps.logger.error("payment_event.late_refund_failed", {
          orderId: order.id,
          code: refunded.error.code,
        });
        return "late payment: refund failed";
      }
      return "late payment refunded";
    }
    if (captured.orderStatus === "placed") await this.deps.notifier.statusChanged(order, "placed");
    return null;
  }
}

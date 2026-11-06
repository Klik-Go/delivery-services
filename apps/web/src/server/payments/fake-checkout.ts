import "server-only";
import { payMongoSignatureHeader } from "@klikgo/adapters";
import {
  err,
  NotFoundError,
  ok,
  type AppError,
  type Centavos,
  type Clock,
  type IPaymentRepository,
  type PaymentWebhookService,
  type Result,
  type WebhookOutcome,
} from "@klikgo/core";
import type { OrderStatus, PaymentStatus } from "@klikgo/types";

/** What the local payment page shows. */
export interface FakeCheckoutSession {
  readonly orderId: string;
  readonly code: string;
  readonly amountCentavos: Centavos;
  readonly paymentStatus: PaymentStatus;
  readonly orderStatus: OrderStatus;
}

/**
 * The local stand-in for PayMongo's hosted checkout (PAYMENT_GATEWAY=fake; never on Vercel
 * production). "Pay" sends the same signed checkout_session.payment.paid webhook PayMongo would,
 * through the real verifier and event handling, so local runs and tests cover the real path.
 */
export class FakeCheckout {
  constructor(
    private readonly deps: {
      payments: IPaymentRepository;
      webhooks: PaymentWebhookService;
      webhookSecret: string;
      clock: Clock;
    },
  ) {}

  async session(intentId: string): Promise<FakeCheckoutSession | null> {
    const found = await this.deps.payments.findByIntent("paymongo", intentId);
    if (!found) return null;
    return {
      orderId: found.order.id,
      code: found.order.code,
      amountCentavos: found.payment.amountCentavos,
      paymentStatus: found.payment.status,
      orderStatus: found.order.status,
    };
  }

  async pay(intentId: string): Promise<Result<WebhookOutcome, AppError>> {
    const session = await this.session(intentId);
    if (!session) return err(new NotFoundError("Checkout session", intentId));
    // PayMongo's e-wallet fee is about 2.5%; the event id is per session, so paying twice is a replay.
    const fee = Math.round(session.amountCentavos * 0.025);
    const body = JSON.stringify({
      data: {
        id: `evt_fake_${intentId}`,
        type: "event",
        attributes: {
          type: "checkout_session.payment.paid",
          livemode: false,
          data: {
            id: intentId,
            type: "checkout_session",
            attributes: {
              reference_number: session.code,
              payments: [
                {
                  id: `pay_fake_${session.orderId.replaceAll("-", "")}`,
                  type: "payment",
                  attributes: {
                    amount: session.amountCentavos,
                    fee,
                    net_amount: session.amountCentavos - fee,
                    status: "paid",
                  },
                },
              ],
            },
          },
        },
      },
    });
    const now = Math.floor(this.deps.clock.now().getTime() / 1000);
    const signature = payMongoSignatureHeader(this.deps.webhookSecret, body, now, "test");
    const outcome = await this.deps.webhooks.receive(body, signature);
    return outcome.ok ? ok(outcome.value) : outcome;
  }
}

import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { AppError } from "../shared/errors";
import type { Result } from "../shared/result";
import type { PaymentEventService, WebhookOutcome } from "./payment-event-service";
import type { IPaymentWebhookVerifier } from "./ports";

/**
 * The webhook endpoint's one job: refuse anything not signed by the gateway, then apply the event
 * exactly once. Kept apart from {@link PaymentEventService} so other gateways can reuse the
 * event handling with their own verifier.
 */
export class PaymentWebhookService {
  constructor(
    private readonly deps: {
      verifier: IPaymentWebhookVerifier;
      events: PaymentEventService;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async receive(
    rawBody: string,
    signature: string | null,
  ): Promise<Result<WebhookOutcome, AppError>> {
    const event = this.deps.verifier.verify(rawBody, signature, this.deps.clock.now());
    if (!event.ok) {
      // Log the refusal reason only: the body may hold customer details.
      this.deps.logger.warn("payment_webhook.refused", { code: event.error.code });
      return event;
    }
    return this.deps.events.handle(event.value);
  }
}

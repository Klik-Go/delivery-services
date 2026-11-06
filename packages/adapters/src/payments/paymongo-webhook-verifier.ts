import { createHmac, timingSafeEqual } from "node:crypto";
import {
  err,
  ok,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
  type AppError,
  type IPaymentWebhookVerifier,
  type PaymentEvent,
  type Result,
} from "@klikgo/core";
import { z } from "zod";

/** Test or live: decides which signature in the header counts (te or li). */
export type PayMongoMode = "test" | "live";

/** The mode a secret key belongs to (sk_live_… is live; everything else is test). */
export function payMongoModeOf(secretKey: string | undefined): PayMongoMode {
  return secretKey?.startsWith("sk_live_") ? "live" : "test";
}

const hmac = (secret: string, timestamp: string, rawBody: string): string =>
  createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");

/**
 * Builds a Paymongo-Signature header (t=…,te=…,li=…) the way PayMongo does. Used by the local fake
 * checkout and by tests; real deliveries are signed by PayMongo.
 */
export function payMongoSignatureHeader(
  secret: string,
  rawBody: string,
  timestampSeconds: number,
  mode: PayMongoMode,
): string {
  const t = String(timestampSeconds);
  const signature = hmac(secret, t, rawBody);
  return `t=${t},te=${mode === "test" ? signature : ""},li=${mode === "live" ? signature : ""}`;
}

const Envelope = z.object({
  data: z.object({
    id: z.string().min(1),
    attributes: z.object({
      type: z.string().min(1),
      livemode: z.boolean(),
      data: z.unknown(),
    }),
  }),
});

const PaidSession = z.object({
  id: z.string().min(1),
  attributes: z.object({
    payments: z
      .array(
        z.object({
          id: z.string().min(1),
          attributes: z.object({
            amount: z.number().int().nonnegative(),
            fee: z.number().int().nonnegative().default(0),
            status: z.string(),
          }),
        }),
      )
      .min(1),
  }),
});

const RefundUpdate = z.object({
  id: z.string().min(1),
  attributes: z.object({ status: z.string() }),
});

const REFUND_STATUS = { pending: "pending", succeeded: "succeeded", failed: "failed" } as const;

/**
 * Verifies PayMongo webhooks (docs.paymongo.com, "Securing a webhook"): HMAC-SHA256 of
 * `<t>.<raw body>` with the endpoint's secret, compared in constant time with `te` (test mode) or
 * `li` (live mode), and a timestamp no older than five minutes against replays. Then maps the
 * events Klik Go handles to gateway-neutral {@link PaymentEvent}s.
 */
export class PayMongoWebhookVerifier implements IPaymentWebhookVerifier {
  constructor(
    private readonly options: {
      readonly webhookSecret: string;
      readonly mode: PayMongoMode;
      readonly toleranceSeconds?: number;
    },
  ) {}

  verify(rawBody: string, signature: string | null, now: Date): Result<PaymentEvent, AppError> {
    const refused = (): Result<never, AppError> =>
      err(new UnauthorizedError("Invalid webhook signature."));
    if (!signature) return refused();
    const parts = new Map(
      signature.split(",").map((part) => {
        const at = part.indexOf("=");
        return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
      }),
    );
    const t = parts.get("t") ?? "";
    const given = parts.get(this.options.mode === "live" ? "li" : "te") ?? "";
    if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(given)) return refused();
    const age = Math.abs(now.getTime() / 1000 - Number(t));
    if (age > (this.options.toleranceSeconds ?? 300)) return refused();
    const expected = Buffer.from(hmac(this.options.webhookSecret, t, rawBody), "hex");
    if (!timingSafeEqual(expected, Buffer.from(given, "hex"))) return refused();

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return err(new ValidationError("Webhook body is not JSON.", []));
    }
    const envelope = Envelope.safeParse(json);
    if (!envelope.success) return err(new ValidationError("Unexpected webhook body.", []));
    const { id: eventId, attributes } = envelope.data.data;
    if (attributes.livemode !== (this.options.mode === "live")) return refused();
    const base = { gateway: "paymongo", eventId, type: attributes.type, payload: json };

    if (attributes.type === "checkout_session.payment.paid") {
      const session = PaidSession.safeParse(attributes.data);
      if (!session.success) return err(new ValidationError("Unexpected checkout session.", []));
      const payments = session.data.attributes.payments;
      const payment = payments.find((p) => p.attributes.status === "paid") ?? payments[0];
      if (!payment) return err(new ValidationError("Checkout session has no payment.", []));
      return ok({
        ...base,
        kind: "payment_paid",
        intentId: session.data.id,
        gatewayPaymentId: payment.id,
        amountCentavos: payment.attributes.amount,
        feeCentavos: payment.attributes.fee,
      });
    }
    if (attributes.type === "payment.refund.updated") {
      const refund = RefundUpdate.safeParse(attributes.data);
      const status = refund.success
        ? REFUND_STATUS[refund.data.attributes.status as keyof typeof REFUND_STATUS]
        : undefined;
      if (!refund.success || !status) return ok({ ...base, kind: "ignored" });
      return ok({ ...base, kind: "refund_updated", gatewayRef: refund.data.id, status });
    }
    // payment.failed carries PayMongo's payment intent, not the checkout session Klik Go stores;
    // unpaid orders are cancelled by the timeout instead (docs/OPEN_QUESTIONS.md Q21).
    return ok({ ...base, kind: "ignored" });
  }
}

/**
 * Stands in while PAYMONGO_WEBHOOK_SECRET is missing: every delivery gets a 503, so PayMongo keeps
 * retrying until the secret is set instead of the payment being dropped.
 */
export class UnconfiguredWebhookVerifier implements IPaymentWebhookVerifier {
  verify(): Result<PaymentEvent, AppError> {
    return err(new ServiceUnavailableError("Payment webhooks are not configured yet."));
  }
}

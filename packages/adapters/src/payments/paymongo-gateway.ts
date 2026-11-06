import {
  AppError,
  err,
  ok,
  ServiceUnavailableError,
  type AppError as AppErrorType,
  type Centavos,
  type CheckoutStart,
  type CheckoutStartRequest,
  type GatewayPaymentStatus,
  type IPaymentGateway,
  type Logger,
  type Result,
} from "@klikgo/core";
import { ONLINE_PAYMENT_METHODS, type PaymentMethod } from "@klikgo/types";
import { z } from "zod";

/** PayMongo's names for Klik Go's online methods (docs.paymongo.com Hosted Checkout). */
const PAYMONGO_METHOD: Readonly<Record<(typeof ONLINE_PAYMENT_METHODS)[number], string>> = {
  gcash: "gcash",
  maya: "paymaya",
  card: "card",
  qrph: "qrph",
};

const SessionResponse = z.object({
  data: z.object({
    id: z.string().min(1),
    attributes: z.object({
      checkout_url: z.url().optional(),
      status: z.string().optional(),
      payments: z.array(z.object({ attributes: z.object({ status: z.string() }) })).optional(),
    }),
  }),
});

const RefundResponse = z.object({
  data: z.object({ id: z.string().min(1), attributes: z.object({ status: z.string() }) }),
});

const ErrorResponse = z.object({
  errors: z.array(z.object({ code: z.string().optional(), detail: z.string().optional() })),
});

export interface PayMongoGatewayOptions {
  /** sk_test_… or sk_live_… (server only). */
  readonly secretKey: string;
  readonly logger: Logger;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/**
 * GCash, Maya, cards and QR Ph through PayMongo's hosted checkout (Checkout Sessions). The
 * customer pays on PayMongo's page, so card details never reach Klik Go; the paid webhook
 * (checkout_session.payment.paid) confirms the payment.
 */
export class PayMongoGateway implements IPaymentGateway {
  readonly name = "paymongo";
  readonly methods: readonly PaymentMethod[] = ONLINE_PAYMENT_METHODS;
  readonly paysUpfront = true;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: PayMongoGatewayOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.paymongo.com";
    this.fetcher = options.fetch ?? fetch;
  }

  async startCheckout(request: CheckoutStartRequest): Promise<Result<CheckoutStart, AppErrorType>> {
    const type = PAYMONGO_METHOD[request.method as keyof typeof PAYMONGO_METHOD];
    if (!type)
      return err(new AppError("VALIDATION_FAILED", `PayMongo cannot take ${request.method}.`));
    const response = await this.call("POST", "/v2/checkout_sessions", {
      data: {
        attributes: {
          // One line for the whole order: the amount must equal Klik Go's total (fees, promo, tip).
          line_items: [
            {
              name: request.description,
              amount: request.amountCentavos,
              currency: "PHP",
              quantity: 1,
            },
          ],
          payment_method_types: [type],
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          description: request.description,
          reference_number: request.orderCode,
          metadata: { order_id: request.orderId },
          send_email_receipt: false,
          show_line_items: true,
          show_description: true,
        },
      },
    });
    if (!response.ok) return response;
    const parsed = SessionResponse.safeParse(response.value);
    if (!parsed.success || !parsed.data.data.attributes.checkout_url) {
      this.options.logger.error("paymongo.unexpected_session", { orderId: request.orderId });
      return err(new ServiceUnavailableError("PayMongo sent an unexpected answer."));
    }
    return ok({
      intentId: parsed.data.data.id,
      checkoutUrl: parsed.data.data.attributes.checkout_url,
    });
  }

  async status(intentId: string): Promise<Result<GatewayPaymentStatus, AppErrorType>> {
    const response = await this.call(
      "GET",
      `/v1/checkout_sessions/${encodeURIComponent(intentId)}`,
    );
    if (!response.ok) return response;
    const parsed = SessionResponse.safeParse(response.value);
    if (!parsed.success)
      return err(new ServiceUnavailableError("PayMongo sent an unexpected answer."));
    const { status, payments } = parsed.data.data.attributes;
    if (payments?.some((p) => p.attributes.status === "paid")) return ok("paid");
    if (status === "expired") return ok("expired");
    return ok("pending");
  }

  async refund(request: {
    gatewayPaymentId: string;
    amountCentavos: Centavos;
    reason: string;
  }): Promise<Result<{ ref: string; status: "pending" | "succeeded" }, AppErrorType>> {
    const response = await this.call("POST", "/v1/refunds", {
      data: {
        attributes: {
          amount: request.amountCentavos,
          payment_id: request.gatewayPaymentId,
          // PayMongo accepts duplicate | fraudulent | others; the reason goes in the notes.
          reason: "others",
          notes: request.reason.slice(0, 250),
        },
      },
    });
    if (!response.ok) return response;
    const parsed = RefundResponse.safeParse(response.value);
    if (!parsed.success)
      return err(new ServiceUnavailableError("PayMongo sent an unexpected answer."));
    return ok({
      ref: parsed.data.data.id,
      status: parsed.data.data.attributes.status === "succeeded" ? "succeeded" : "pending",
    });
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Result<unknown, AppErrorType>> {
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.options.secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
      const json: unknown = await response.json().catch(() => null);
      if (response.ok) return ok(json);
      const detail = ErrorResponse.safeParse(json);
      // Log PayMongo's error code only: never the key, the request body or customer data.
      this.options.logger.error("paymongo.request_failed", {
        path: path.split("/").slice(0, 3).join("/"),
        status: response.status,
        code: detail.success ? detail.data.errors[0]?.code : undefined,
      });
      return err(
        response.status === 400 || response.status === 422
          ? new AppError(
              "VALIDATION_FAILED",
              detail.success
                ? (detail.data.errors[0]?.detail ?? "PayMongo refused the request.")
                : "PayMongo refused the request.",
            )
          : new ServiceUnavailableError("PayMongo is not answering right now."),
      );
    } catch (error) {
      this.options.logger.error("paymongo.unreachable", {
        path: path.split("/").slice(0, 3).join("/"),
        err: error instanceof Error ? error.name : "unknown",
      });
      return err(new ServiceUnavailableError("PayMongo is not answering right now."));
    }
  }
}

import type { AnalyticsEventInput, ClientErrorInput } from "@klikgo/types";
import type { IRateLimiter, RateLimitRule } from "../auth/ports";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { RateLimitedError, type AppError } from "../shared/errors";
import { scrubPii, scrubText } from "../shared/pii";
import { err, ok, type Result } from "../shared/result";
import type { ErrorContext, IAnalytics, IErrorReporter } from "./ports";

/** One browser can report at most this many crashes a minute (a crash loop must not flood Sentry). */
export const CLIENT_ERRORS_PER_IP: RateLimitRule = { limit: 20, windowSeconds: 60 };

/** Who reported a browser error. */
export interface ClientErrorContext {
  readonly requestId: string;
  readonly userId: string | null;
  readonly clientIp: string;
}

/**
 * Sends errors to the error tracker with personal data removed (phone numbers, emails, addresses,
 * tokens), from the server and, through the BFF, from browsers. Reporting never throws: a tracker
 * outage must not turn a handled request into a failed one.
 */
export class ErrorReportingService {
  constructor(
    private readonly deps: { reporter: IErrorReporter; rateLimiter: IRateLimiter; logger: Logger },
  ) {}

  async reportServer(error: unknown, context: Omit<ErrorContext, "source">): Promise<void> {
    await this.send(describe(error), { ...context, source: "server" });
  }

  async reportBrowser(
    input: ClientErrorInput,
    context: ClientErrorContext,
  ): Promise<Result<{ readonly accepted: true }, AppError>> {
    const limit = await this.deps.rateLimiter.hit(
      `client-errors:ip:${context.clientIp}`,
      CLIENT_ERRORS_PER_IP,
    );
    if (!limit.allowed)
      return err(new RateLimitedError("Too many reports.", limit.retryAfterSeconds));
    await this.send(
      { name: input.kind, message: input.message, ...(input.stack ? { stack: input.stack } : {}) },
      {
        source: "browser",
        requestId: context.requestId,
        ...(input.path ? { route: input.path } : {}),
        ...(context.userId ? { userId: context.userId } : {}),
        ...(input.digest ? { tags: { digest: input.digest } } : {}),
      },
    );
    return ok({ accepted: true });
  }

  private async send(
    error: { readonly name: string; readonly message: string; readonly stack?: string },
    context: ErrorContext,
  ): Promise<void> {
    try {
      await this.deps.reporter.capture(
        {
          name: scrubText(error.name).slice(0, 100),
          message: scrubText(error.message),
          ...(error.stack ? { stack: scrubText(error.stack) } : {}),
        },
        {
          ...context,
          ...(context.extra ? { extra: scrubPii(context.extra) as Record<string, unknown> } : {}),
        },
      );
    } catch (failure) {
      this.deps.logger.warn("errors.report_failed", {
        err: failure instanceof Error ? failure.name : "unknown",
      });
    }
  }
}

function describe(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: "NonError", message: typeof error === "string" ? error : "Unknown error" };
}

/** Who is behind an analytics event: an account id or the app's random install id, never a person. */
export interface AnalyticsContext {
  readonly userId: string | null;
  readonly anonymousId: string | null;
  /** The browser asked not to be tracked (DNT or Global Privacy Control). */
  readonly optedOut: boolean;
}

/**
 * The ordering funnel (home → store → cart → checkout → placed → paid) for product analytics.
 * Events carry ids only; a browser that opts out (DNT / GPC) or has no id is simply not counted.
 */
export class AnalyticsService {
  constructor(private readonly deps: { analytics: IAnalytics; clock: Clock; logger: Logger }) {}

  async track(
    input: AnalyticsEventInput,
    context: AnalyticsContext,
  ): Promise<Result<{ readonly counted: boolean }, AppError>> {
    const distinctId = context.userId ?? context.anonymousId;
    if (context.optedOut || !distinctId) return ok({ counted: false });
    const properties: Record<string, string | boolean> = { signed_in: context.userId !== null };
    if (input.storeId) properties.store_id = input.storeId;
    if (input.orderId) properties.order_id = input.orderId;
    if (input.path) properties.path = input.path;
    try {
      await this.deps.analytics.capture({
        distinctId,
        event: input.name,
        properties,
        at: this.deps.clock.now(),
      });
    } catch (failure) {
      this.deps.logger.warn("analytics.capture_failed", {
        err: failure instanceof Error ? failure.name : "unknown",
      });
    }
    return ok({ counted: true });
  }
}

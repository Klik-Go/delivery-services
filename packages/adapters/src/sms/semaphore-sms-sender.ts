import {
  AppError,
  err,
  ok,
  type AppError as AppErrorType,
  type ISmsSender,
  type Logger,
  type Result,
  type SmsMessage,
} from "@klikgo/core";

/** Semaphore (PH SMS gateway) API endpoint for single messages. */
const SEMAPHORE_MESSAGES_URL = "https://api.semaphore.co/api/v4/messages";

/** Options for {@link SemaphoreSmsSender}. */
export interface SemaphoreOptions {
  readonly apiKey: string;
  /** Approved sender name (e.g. "KLIKGO"); Semaphore uses its default when omitted. */
  readonly senderName?: string | undefined;
  readonly logger: Logger;
  /** Injected for tests. */
  readonly fetch?: typeof fetch;
}

/** Sends SMS through Semaphore. The API key is server-only (SEMAPHORE_API_KEY). */
export class SemaphoreSmsSender implements ISmsSender {
  constructor(private readonly options: SemaphoreOptions) {}

  /** Sends one message; maps Semaphore failures to an INTERNAL AppError without leaking the key. */
  async send(
    message: SmsMessage,
  ): Promise<Result<{ providerMessageId: string | null }, AppErrorType>> {
    const form = new URLSearchParams({
      apikey: this.options.apiKey,
      // Semaphore expects local format (09XXXXXXXXX).
      number: message.to.replace(/^\+63/, "0"),
      message: message.body,
    });
    if (this.options.senderName) form.set("sendername", this.options.senderName);
    try {
      const response = await (this.options.fetch ?? fetch)(SEMAPHORE_MESSAGES_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.options.logger.error("semaphore.send_failed", { status: response.status });
        return err(new AppError("INTERNAL", "Could not send the SMS."));
      }
      const payload = (await response.json()) as
        { message_id?: number | string }[] | { message_id?: number | string };
      const first = Array.isArray(payload) ? payload[0] : payload;
      return ok({
        providerMessageId: first?.message_id === undefined ? null : String(first.message_id),
      });
    } catch (error) {
      this.options.logger.error("semaphore.unreachable", { err: error });
      return err(new AppError("INTERNAL", "Could not send the SMS."));
    }
  }
}

import {
  ok,
  type AppError,
  type ISmsSender,
  type Logger,
  type Result,
  type SmsMessage,
} from "@klikgo/core";

/**
 * Used when SEMAPHORE_API_KEY is not set (local development, CI). Logs that a text *would* have
 * been sent to a masked number; never logs the message body, which contains the code.
 */
export class DevSmsSender implements ISmsSender {
  constructor(private readonly logger: Logger) {}

  /** Pretends to send. */
  send(message: SmsMessage): Promise<Result<{ providerMessageId: string | null }, AppError>> {
    this.logger.warn("sms.not_sent_no_provider", {
      to: `${message.to.slice(0, 6)}•••${message.to.slice(-2)}`,
    });
    return Promise.resolve(ok({ providerMessageId: null }));
  }
}

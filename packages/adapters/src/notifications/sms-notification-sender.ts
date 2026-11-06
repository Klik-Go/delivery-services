import {
  err,
  NotFoundError,
  ok,
  type AppError,
  type INotificationSender,
  type ISmsSender,
  type NotificationMessage,
  type RenderedNotification,
  type Result,
} from "@klikgo/core";

/** Finds the number to text for a message (never logged). */
export interface ISmsNumberLookup {
  smsNumberFor(userId: string, orderId: string | null): Promise<string | null>;
}

/** Text messages through the configured ISmsSender (Semaphore, or the dev logger). */
export class SmsNotificationSender implements INotificationSender {
  readonly channel = "sms" as const;

  constructor(private readonly deps: { sms: ISmsSender; numbers: ISmsNumberLookup }) {}

  async send(
    message: NotificationMessage,
    rendered: RenderedNotification,
  ): Promise<Result<void, AppError>> {
    const to = await this.deps.numbers.smsNumberFor(message.userId, message.orderId);
    if (!to) return err(new NotFoundError("Phone number", message.userId));
    const sent = await this.deps.sms.send({ to, body: rendered.body });
    return sent.ok ? ok(undefined) : sent;
  }
}

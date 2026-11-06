import { ok, type AppError, type INotificationSender, type Result } from "@klikgo/core";

/**
 * In-app messages: the `notifications` row the service records is the message itself (the inbox
 * and the order page read it), so there is nothing else to deliver.
 */
export class InAppNotificationSender implements INotificationSender {
  readonly channel = "in_app" as const;

  send(): Promise<Result<void, AppError>> {
    return Promise.resolve(ok(undefined));
  }
}

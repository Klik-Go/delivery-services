import {
  err,
  NotFoundError,
  ok,
  ServiceUnavailableError,
  type AppError,
  type INotificationSender,
  type IPushSubscriptionStore,
  type Logger,
  type NotificationMessage,
  type PushSubscriptionRecord,
  type RenderedNotification,
  type Result,
} from "@klikgo/core";
import webpush from "web-push";

/** VAPID keys (`npx web-push generate-vapid-keys`); the private key is server only. */
export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  /** mailto: or https: contact for the push services. */
  readonly subject: string;
}

/** The library call, injectable for tests. Resolves with the push service's status code. */
export type PushDelivery = (
  subscription: PushSubscriptionRecord,
  payload: string,
  options: {
    readonly ttlSeconds: number;
    readonly urgency: "normal" | "high";
    readonly vapid: VapidKeys;
  },
) => Promise<{ readonly statusCode: number }>;

const defaultDelivery: PushDelivery = async (subscription, payload, options) => {
  const result = await webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: { ...subscription.keys } },
    payload,
    {
      TTL: options.ttlSeconds,
      urgency: options.urgency,
      timeout: 10_000,
      vapidDetails: { ...options.vapid },
    },
  );
  return { statusCode: result.statusCode };
};

function statusOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

/**
 * Web Push (VAPID) to every browser the person subscribed. Store alerts are urgent and expire in
 * three minutes (the confirmation deadline); a subscription the push service no longer knows
 * (404/410) is deleted. Payloads hold the title, body and link only.
 */
export class WebPushSender implements INotificationSender {
  readonly channel = "push" as const;
  private readonly deliver: PushDelivery;

  constructor(
    private readonly deps: {
      subscriptions: IPushSubscriptionStore;
      vapid: VapidKeys;
      logger: Logger;
      deliver?: PushDelivery;
    },
  ) {
    this.deliver = deps.deliver ?? defaultDelivery;
  }

  async send(
    message: NotificationMessage,
    rendered: RenderedNotification,
  ): Promise<Result<void, AppError>> {
    const subscriptions = await this.deps.subscriptions.forUser(message.userId);
    if (subscriptions.length === 0)
      return err(new NotFoundError("Push subscription", message.userId));
    const urgent = message.template === "order_new" || message.template === "order_unacknowledged";
    const payload = JSON.stringify({
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      tag: message.orderId ?? message.template,
    });
    let delivered = 0;
    for (const subscription of subscriptions) {
      try {
        await this.deliver(subscription, payload, {
          ttlSeconds: urgent ? 180 : 3600,
          urgency: urgent ? "high" : "normal",
          vapid: this.deps.vapid,
        });
        delivered += 1;
      } catch (error) {
        const status = statusOf(error);
        if (status === 404 || status === 410) {
          await this.deps.subscriptions.remove(subscription.endpoint, null);
        } else {
          // The endpoint identifies a device: log only its push service host.
          this.deps.logger.warn("push.failed", {
            status,
            host: new URL(subscription.endpoint).host,
          });
        }
      }
    }
    return delivered > 0
      ? ok(undefined)
      : err(new ServiceUnavailableError("No device accepted the notification."));
  }
}

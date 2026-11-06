import type { NotificationChannel, OrderStatus } from "@klikgo/types";
import type { Logger } from "../ports/logger";
import type { Centavos } from "../shared/money";
import type {
  INotificationLog,
  INotificationSender,
  IRecipientDirectory,
  NotificationMessage,
  NotificationParams,
  NotificationTemplate,
} from "./ports";
import { renderNotification } from "./templates";

/** Which channels carry each message. Channels without a configured sender are skipped. */
export type NotificationPolicy = Readonly<
  Record<NotificationTemplate, readonly NotificationChannel[]>
>;

export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  order_new: ["push", "in_app"],
  order_preparing: ["push", "in_app"],
  order_ready: ["push", "in_app"],
  order_rejected: ["push", "in_app"],
  order_cancelled: ["push", "in_app"],
  order_store_timeout: ["push", "in_app"],
  // Stores may have no app open: the SLA reminder is a text message.
  merchant_order_waiting: ["sms"],
  order_unacknowledged: ["push", "in_app"],
};

/** The order facts a status message needs. */
export interface NotifiableOrder {
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly totalCentavos: Centavos;
}

/** Told about every status change a service makes (after it is saved). */
export interface IOrderNotifier {
  statusChanged(
    order: NotifiableOrder,
    to: OrderStatus,
    params?: NotificationParams,
  ): Promise<void>;
}

type Audience = "customer" | "merchant";

/** Who hears about each status, with which message. */
const ON_STATUS: Readonly<
  Partial<Record<OrderStatus, readonly { audience: Audience; template: NotificationTemplate }[]>>
> = {
  placed: [{ audience: "merchant", template: "order_new" }],
  preparing: [{ audience: "customer", template: "order_preparing" }],
  ready: [{ audience: "customer", template: "order_ready" }],
  rejected: [{ audience: "customer", template: "order_rejected" }],
  cancelled: [
    { audience: "customer", template: "order_cancelled" },
    { audience: "merchant", template: "order_cancelled" },
  ],
};

/**
 * Sends Klik Go's messages (docs/BUILD_PLAN.md Phase 6). The policy picks channels per message;
 * each channel is one INotificationSender, so adding email is one more sender and one policy
 * entry. A message that cannot be sent is recorded as failed and logged, never thrown: the order
 * change that caused it has already happened.
 */
export class NotificationService implements IOrderNotifier {
  private readonly senders: ReadonlyMap<NotificationChannel, INotificationSender>;
  private readonly policy: NotificationPolicy;

  constructor(
    private readonly deps: {
      senders: readonly INotificationSender[];
      log: INotificationLog;
      recipients: IRecipientDirectory;
      logger: Logger;
      policy?: NotificationPolicy;
    },
  ) {
    this.senders = new Map(deps.senders.map((sender) => [sender.channel, sender]));
    this.policy = deps.policy ?? DEFAULT_NOTIFICATION_POLICY;
  }

  async statusChanged(
    order: NotifiableOrder,
    to: OrderStatus,
    params: NotificationParams = {},
  ): Promise<void> {
    const rules = ON_STATUS[to] ?? [];
    if (rules.length === 0) return;
    const filled: NotificationParams = {
      orderId: order.id,
      code: order.code,
      store: order.merchantName,
      totalCentavos: order.totalCentavos,
      ...params,
    };
    for (const { audience, template } of rules) {
      const userIds =
        audience === "customer"
          ? [order.customerId]
          : await this.deps.recipients.merchantTeam(order.merchantId);
      for (const userId of userIds) {
        await this.notify({ userId, template, orderId: order.id, params: filled });
      }
    }
  }

  /** Sends one message on every channel its policy names (and that is configured). */
  async notify(message: NotificationMessage): Promise<void> {
    for (const channel of this.policy[message.template]) {
      const sender = this.senders.get(channel);
      if (!sender) continue;
      const id = await this.deps.log.start(message, channel);
      await this.deliver(id, sender, message);
    }
  }

  /** Sends what the database queued (SLA texts and alerts). Returns how many were attempted. */
  async deliverQueued(limit = 50): Promise<number> {
    const queued = await this.deps.log.claimQueued(limit);
    for (const message of queued) {
      const sender = this.senders.get(message.channel);
      if (sender) await this.deliver(message.id, sender, message);
      else await this.deps.log.finish(message.id, { ok: false, error: "channel not configured" });
    }
    return queued.length;
  }

  private async deliver(
    id: string,
    sender: INotificationSender,
    message: NotificationMessage,
  ): Promise<void> {
    try {
      const sent = await sender.send(message, renderNotification(message.template, message.params));
      await this.deps.log.finish(
        id,
        sent.ok ? { ok: true } : { ok: false, error: sent.error.code },
      );
      // NOT_FOUND: nowhere to deliver (no device subscribed, no phone): expected, not a failure.
      if (!sent.ok && sent.error.code !== "NOT_FOUND") {
        this.deps.logger.warn("notification.failed", {
          notificationId: id,
          channel: sender.channel,
          template: message.template,
          code: sent.error.code,
        });
      }
    } catch (error) {
      await this.deps.log.finish(id, { ok: false, error: "exception" });
      this.deps.logger.error("notification.exception", {
        notificationId: id,
        channel: sender.channel,
        err: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

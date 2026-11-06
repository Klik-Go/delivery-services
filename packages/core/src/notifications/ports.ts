import type { NotificationChannel } from "@klikgo/types";
import type { AppError } from "../shared/errors";
import type { Result } from "../shared/result";

/** Every message Klik Go sends. The database queues some of them too (SLA escalation). */
export const NOTIFICATION_TEMPLATES = [
  "order_new",
  "order_preparing",
  "order_ready",
  "order_rejected",
  "order_cancelled",
  "order_store_timeout",
  "merchant_order_waiting",
  "order_unacknowledged",
] as const;
export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

/** Values a template fills in (order code, store name, minutes…). Never personal data. */
export type NotificationParams = Readonly<Record<string, string | number>>;

/** One message for one person, before a channel is chosen. */
export interface NotificationMessage {
  readonly userId: string;
  readonly template: NotificationTemplate;
  readonly orderId: string | null;
  readonly params: NotificationParams;
}

/** A message in words, ready for a channel. */
export interface RenderedNotification {
  readonly title: string;
  readonly body: string;
  /** Where tapping it should open (a path in the app). */
  readonly url: string;
}

/** Delivers one message on one channel (Web Push, SMS, in-app). */
export interface INotificationSender {
  readonly channel: NotificationChannel;
  send(
    message: NotificationMessage,
    rendered: RenderedNotification,
  ): Promise<Result<void, AppError>>;
}

/** A message the database queued for a channel (claimed by the background job). */
export interface QueuedNotification extends NotificationMessage {
  readonly id: string;
  readonly channel: NotificationChannel;
}

/** The `notifications` table: the in-app inbox and the record of every send. */
export interface INotificationLog {
  /** Records a message and returns its id (status "sending" until finished). */
  start(message: NotificationMessage, channel: NotificationChannel): Promise<string>;
  finish(
    id: string,
    outcome: { readonly ok: true } | { readonly ok: false; readonly error: string },
  ): Promise<void>;
  /** Takes up to `limit` queued messages so no other worker sends them too. */
  claimQueued(limit: number): Promise<QueuedNotification[]>;
}

/** Who to tell about a store's orders. */
export interface IRecipientDirectory {
  /** The store's owners and staff (user ids). */
  merchantTeam(merchantId: string): Promise<string[]>;
}

import { formatPeso } from "../shared/money";
import type { NotificationParams, NotificationTemplate, RenderedNotification } from "./ports";

const text = (params: NotificationParams, key: string): string => String(params[key] ?? "");

type Renderer = (params: NotificationParams) => RenderedNotification;

/** The words of every message. Short enough for one SMS (160 characters) where texted. */
const RENDERERS: Readonly<Record<NotificationTemplate, Renderer>> = {
  order_new: (p) => ({
    title: `New order ${text(p, "code")}`,
    body: `${formatPeso(Number(p.totalCentavos ?? 0))}. Please accept it within 3 minutes.`,
    url: "/merchant/orders",
  }),
  order_preparing: (p) => ({
    title: "Your order is being prepared",
    body: `${text(p, "store")} accepted ${text(p, "code")}. Ready in about ${text(p, "minutes")} minutes.`,
    url: `/orders/${text(p, "orderId")}`,
  }),
  order_ready: (p) => ({
    title: "Your order is ready",
    body: `${text(p, "store")} has ${text(p, "code")} ready for pickup.`,
    url: `/orders/${text(p, "orderId")}`,
  }),
  order_rejected: (p) => ({
    title: `${text(p, "store")} couldn't take your order`,
    body: `${text(p, "code")}: ${text(p, "reason")}. Any payment is refunded.`,
    url: `/orders/${text(p, "orderId")}`,
  }),
  order_cancelled: (p) => ({
    title: `Order ${text(p, "code")} was cancelled`,
    body: text(p, "reason"),
    url: `/orders/${text(p, "orderId")}`,
  }),
  order_store_timeout: (p) => ({
    title: `Order ${text(p, "code")} was cancelled`,
    body: `${text(p, "store")} didn't confirm in time. Any payment is refunded.`,
    url: `/orders/${text(p, "orderId")}`,
  }),
  merchant_order_waiting: (p) => ({
    title: "Klik Go",
    body: `Klik Go: order ${text(p, "code")} is waiting. Accept it on your dashboard within 2 minutes or it will be cancelled.`,
    url: "/merchant/orders",
  }),
  order_unacknowledged: (p) => ({
    title: `Order ${text(p, "code")} not confirmed`,
    body: `${text(p, "store")} hasn't confirmed after 2 minutes. Please call the store.`,
    url: `/admin`,
  }),
};

/** Puts a template into words. */
export function renderNotification(
  template: NotificationTemplate,
  params: NotificationParams,
): RenderedNotification {
  return RENDERERS[template](params);
}

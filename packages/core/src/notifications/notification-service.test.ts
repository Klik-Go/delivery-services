import { describe, expect, it } from "vitest";
import { MemoryLogger } from "../testing/memory-logger";
import {
  FakeNotificationSender,
  InMemoryNotificationLog,
  InMemoryRecipients,
} from "../testing/ordering-fakes";
import { NotificationService } from "./notification-service";
import { NOTIFICATION_TEMPLATES } from "./ports";
import { renderNotification } from "./templates";

const ORDER = {
  id: "order-1",
  code: "KG-ABC234",
  customerId: "customer-1",
  merchantId: "kape",
  merchantName: "Kape't Tinapay",
  totalCentavos: 17900,
};

function world(channels: ("push" | "sms" | "in_app")[] = ["push", "sms", "in_app"]) {
  const senders = channels.map((c) => new FakeNotificationSender(c));
  const log = new InMemoryNotificationLog();
  const logger = new MemoryLogger();
  const service = new NotificationService({
    senders,
    log,
    recipients: new InMemoryRecipients({ kape: ["owner-1", "staff-1"] }),
    logger,
  });
  const sender = (channel: string) => senders.find((s) => s.channel === channel);
  return { service, log, logger, sender };
}

describe("NotificationService", () => {
  it("tells the whole store team about a new order by push and in the app", async () => {
    const w = world();
    await w.service.statusChanged(ORDER, "placed");
    expect(w.log.rows.map((r) => [r.userId, r.channel, r.template, r.status])).toEqual([
      ["owner-1", "push", "order_new", "sent"],
      ["owner-1", "in_app", "order_new", "sent"],
      ["staff-1", "push", "order_new", "sent"],
      ["staff-1", "in_app", "order_new", "sent"],
    ]);
    expect(w.sender("push")?.sent[0]?.rendered).toEqual({
      title: "New order KG-ABC234",
      body: "₱179.00. Please accept it within 3 minutes.",
      url: "/merchant/orders",
    });
    expect(w.sender("sms")?.sent).toEqual([]);
  });

  it("tells the customer when cooking starts, with the store's minutes", async () => {
    const w = world();
    await w.service.statusChanged(ORDER, "preparing", { minutes: 20 });
    expect(w.sender("push")?.sent[0]).toMatchObject({
      message: { userId: "customer-1", template: "order_preparing" },
      rendered: {
        body: "Kape't Tinapay accepted KG-ABC234. Ready in about 20 minutes.",
        url: "/orders/order-1",
      },
    });
  });

  it("tells the customer and the store about a cancellation, and nobody about acceptance alone", async () => {
    const w = world();
    await w.service.statusChanged(ORDER, "accepted");
    expect(w.log.rows).toEqual([]);
    await w.service.statusChanged(ORDER, "cancelled", { reason: "Cancelled by the customer" });
    expect(new Set(w.log.rows.map((r) => r.userId))).toEqual(
      new Set(["customer-1", "owner-1", "staff-1"]),
    );
  });

  it("skips channels that are not configured", async () => {
    const w = world(["in_app"]);
    await w.service.statusChanged(ORDER, "ready");
    expect(w.log.rows.map((r) => r.channel)).toEqual(["in_app"]);
  });

  it("records a failed or crashing channel without throwing", async () => {
    const w = world(["push", "in_app"]);
    const push = w.sender("push");
    if (push) push.fail = true;
    await w.service.statusChanged(ORDER, "ready");
    expect(w.log.rows.map((r) => [r.channel, r.status, r.error])).toEqual([
      ["push", "failed", "UNAVAILABLE"],
      ["in_app", "sent", null],
    ]);
    if (push) {
      push.fail = false;
      push.throws = true;
    }
    await w.service.statusChanged(ORDER, "ready");
    expect(w.log.rows.at(-2)).toMatchObject({ status: "failed", error: "exception" });
    expect(w.logger.lines.map((l) => l.message)).toEqual([
      "notification.failed",
      "notification.exception",
    ]);
  });

  it("sends what the database queued: the store's SLA text, once", async () => {
    const w = world();
    w.log.queue(
      {
        userId: "owner-1",
        template: "merchant_order_waiting",
        orderId: "order-1",
        params: { code: "KG-ABC234" },
      },
      "sms",
    );
    w.log.queue(
      {
        userId: "coord-1",
        template: "order_unacknowledged",
        orderId: "order-1",
        params: { code: "KG-ABC234" },
      },
      "email",
    );
    expect(await w.service.deliverQueued()).toBe(2);
    expect(await w.service.deliverQueued()).toBe(0);
    expect(w.sender("sms")?.sent[0]?.rendered.body).toBe(
      "Klik Go: order KG-ABC234 is waiting. Accept it on your dashboard within 2 minutes or it will be cancelled.",
    );
    expect(w.log.rows.map((r) => [r.channel, r.status, r.error])).toEqual([
      ["sms", "sent", null],
      ["email", "failed", "channel not configured"],
    ]);
  });
});

describe("renderNotification", () => {
  it.each(NOTIFICATION_TEMPLATES)("writes %s within one text message", (template) => {
    const rendered = renderNotification(template, {
      orderId: "order-1",
      code: "KG-ABC234",
      store: "Aling Nena's Karinderya",
      minutes: 30,
      reason: "Out of rice for the day",
      totalCentavos: 125000,
    });
    expect(rendered.title.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeLessThanOrEqual(160);
    expect(rendered.url.startsWith("/")).toBe(true);
  });
});

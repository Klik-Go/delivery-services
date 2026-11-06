import { MemoryLogger } from "@klikgo/core/testing";
import { InMemoryPushSubscriptions } from "@klikgo/core/testing";
import {
  err,
  ok,
  ServiceUnavailableError,
  type ISmsSender,
  type NotificationMessage,
} from "@klikgo/core";
import { describe, expect, it, vi } from "vitest";
import { InAppNotificationSender } from "./in-app-sender";
import { SmsNotificationSender } from "./sms-notification-sender";
import { WebPushSender, type PushDelivery } from "./web-push-sender";

const MESSAGE: NotificationMessage = {
  userId: "owner-1",
  template: "order_new",
  orderId: "order-1",
  params: { code: "KG-ABC234" },
};
const RENDERED = {
  title: "New order KG-ABC234",
  body: "₱179.00. Please accept it within 3 minutes.",
  url: "/merchant/orders",
};
const VAPID = { publicKey: "BPub", privateKey: "priv", subject: "mailto:ops@klikgo.example" };
const sub = (n: number) => ({
  endpoint: `https://push.example.test/device-${String(n)}`,
  keys: { p256dh: "p".repeat(80), auth: "a".repeat(22) },
});

describe("WebPushSender", () => {
  it("pushes an urgent, short-lived alert to every device of the person", async () => {
    const subscriptions = new InMemoryPushSubscriptions();
    await subscriptions.save("owner-1", sub(1), null);
    await subscriptions.save("owner-1", sub(2), null);
    const deliver = vi.fn<PushDelivery>(() => Promise.resolve({ statusCode: 201 }));
    const sender = new WebPushSender({
      subscriptions,
      vapid: VAPID,
      logger: new MemoryLogger(),
      deliver,
    });
    expect(await sender.send(MESSAGE, RENDERED)).toEqual({ ok: true, value: undefined });
    expect(deliver).toHaveBeenCalledTimes(2);
    const [, payload, options] = deliver.mock.calls[0] ?? [];
    expect(JSON.parse(payload ?? "{}")).toEqual({ ...RENDERED, tag: "order-1" });
    expect(options).toEqual({ ttlSeconds: 180, urgency: "high", vapid: VAPID });
  });

  it("forgets devices the push service no longer knows and reports when none accepted", async () => {
    const subscriptions = new InMemoryPushSubscriptions();
    await subscriptions.save("customer-1", sub(1), null);
    await subscriptions.save("customer-1", sub(2), null);
    const logger = new MemoryLogger();
    const deliver: PushDelivery = (s) =>
      Promise.reject(
        Object.assign(new Error("gone"), { statusCode: s.endpoint.endsWith("1") ? 410 : 500 }),
      );
    const sender = new WebPushSender({ subscriptions, vapid: VAPID, logger, deliver });
    const result = await sender.send(
      { ...MESSAGE, userId: "customer-1", template: "order_ready" },
      RENDERED,
    );
    expect(!result.ok && result.error.code).toBe("UNAVAILABLE");
    expect((await subscriptions.forUser("customer-1")).map((s) => s.endpoint)).toEqual([
      sub(2).endpoint,
    ]);
    expect(logger.lines).toMatchObject([
      { message: "push.failed", context: { status: 500, host: "push.example.test" } },
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain("device-2");
  });

  it("has nothing to deliver to a person without devices", async () => {
    const sender = new WebPushSender({
      subscriptions: new InMemoryPushSubscriptions(),
      vapid: VAPID,
      logger: new MemoryLogger(),
    });
    const result = await sender.send(MESSAGE, RENDERED);
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });
});

describe("SmsNotificationSender", () => {
  it("texts the body to the looked-up number", async () => {
    const sms: ISmsSender = { send: vi.fn(() => Promise.resolve(ok({ providerMessageId: "m1" }))) };
    const sender = new SmsNotificationSender({
      sms,
      numbers: { smsNumberFor: () => Promise.resolve("+639170000001") },
    });
    expect(await sender.send(MESSAGE, RENDERED)).toEqual({ ok: true, value: undefined });
    expect(sms.send).toHaveBeenCalledWith({ to: "+639170000001", body: RENDERED.body });
  });

  it("reports a missing number and a failed text", async () => {
    const down: ISmsSender = {
      send: () => Promise.resolve(err(new ServiceUnavailableError("down"))),
    };
    const none = new SmsNotificationSender({
      sms: down,
      numbers: { smsNumberFor: () => Promise.resolve(null) },
    });
    const missing = await none.send(MESSAGE, RENDERED);
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
    const failing = new SmsNotificationSender({
      sms: down,
      numbers: { smsNumberFor: () => Promise.resolve("+639170000001") },
    });
    const failed = await failing.send(MESSAGE, RENDERED);
    expect(!failed.ok && failed.error.code).toBe("UNAVAILABLE");
  });
});

describe("InAppNotificationSender", () => {
  it("has nothing more to do: the recorded row is the in-app message", async () => {
    expect(await new InAppNotificationSender().send()).toEqual({ ok: true, value: undefined });
  });
});

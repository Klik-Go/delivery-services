import { describe, expect, it } from "vitest";
import { sessionUser } from "../testing/session-users";
import { InMemoryPushSubscriptions } from "../testing/ordering-fakes";
import { PushSubscriptionService } from "./push-subscription-service";

const SUB = {
  endpoint: "https://push.example.test/abc",
  keys: { p256dh: "p".repeat(80), auth: "a".repeat(22) },
};

describe("PushSubscriptionService", () => {
  it("saves this device for the signed-in person and removes it on request", async () => {
    const store = new InMemoryPushSubscriptions();
    const service = new PushSubscriptionService({ store, publicKey: "BPublicKey" });
    const user = sessionUser("customer-1", [{ role: "customer" }], "aal1");
    expect(service.publicKey).toBe("BPublicKey");
    expect(await service.subscribe(user, SUB, "x".repeat(400))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await store.forUser("customer-1")).toEqual([SUB]);
    expect(store.rows[0]?.userAgent).toHaveLength(300);
    // Another person signing in on the same browser takes the subscription over.
    await service.subscribe(sessionUser("customer-2", [{ role: "customer" }], "aal1"), SUB, null);
    expect(await store.forUser("customer-1")).toEqual([]);
    await service.unsubscribe(user, SUB.endpoint);
    expect(await store.forUser("customer-2")).toEqual([SUB]);
    await service.unsubscribe(
      sessionUser("customer-2", [{ role: "customer" }], "aal1"),
      SUB.endpoint,
    );
    expect(store.rows).toEqual([]);
  });

  it("asks guests to sign in", async () => {
    const service = new PushSubscriptionService({
      store: new InMemoryPushSubscriptions(),
      publicKey: null,
    });
    expect(service.publicKey).toBeNull();
    expect((await service.subscribe(null, SUB, null)).ok).toBe(false);
    const result = await service.unsubscribe(null, SUB.endpoint);
    expect(!result.ok && result.error.code).toBe("UNAUTHORIZED");
  });
});

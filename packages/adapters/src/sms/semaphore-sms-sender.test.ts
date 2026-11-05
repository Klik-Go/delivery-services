import { MemoryLogger } from "@klikgo/core/testing";
import { describe, expect, it, vi } from "vitest";
import { DevSmsSender } from "./dev-sms-sender";
import { SemaphoreSmsSender } from "./semaphore-sms-sender";

describe("SemaphoreSmsSender", () => {
  it("posts the message to Semaphore in local number format with the sender name", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json([{ message_id: 123 }])));
    const sender = new SemaphoreSmsSender({
      apiKey: "test-key",
      senderName: "KLIKGO",
      logger: new MemoryLogger(),
      fetch: fetchMock,
    });

    const result = await sender.send({ to: "+639171234567", body: "Hello" });

    expect(result).toEqual({ ok: true, value: { providerMessageId: "123" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.semaphore.co/api/v4/messages");
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get("number")).toBe("09171234567");
    expect(form.get("sendername")).toBe("KLIKGO");
    expect(form.get("message")).toBe("Hello");
  });

  it("reports a failure without leaking the API key", async () => {
    const logger = new MemoryLogger();
    const sender = new SemaphoreSmsSender({
      apiKey: "super-secret",
      logger,
      fetch: vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))),
    });
    const result = await sender.send({ to: "+639171234567", body: "Hello" });
    expect(!result.ok && result.error.message).toBe("Could not send the SMS.");
    expect(JSON.stringify(logger.lines)).not.toContain("super-secret");
  });

  it("treats a network error as a failed send", async () => {
    const sender = new SemaphoreSmsSender({
      apiKey: "k",
      logger: new MemoryLogger(),
      fetch: vi.fn(() => Promise.reject(new Error("ECONNRESET"))),
    });
    expect((await sender.send({ to: "+639171234567", body: "Hi" })).ok).toBe(false);
  });
});

describe("DevSmsSender", () => {
  it("logs a masked number and never the message (which holds the code)", async () => {
    const logger = new MemoryLogger();
    await new DevSmsSender(logger).send({
      to: "+639171234567",
      body: "Your Klik Go code is 482913.",
    });
    const logged = JSON.stringify(logger.lines);
    expect(logged).toContain("+63917•••67");
    expect(logged).not.toContain("482913");
    expect(logged).not.toContain("+639171234567");
  });
});

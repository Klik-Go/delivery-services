import type { ErrorContext } from "@klikgo/core";
import { MemoryLogger } from "@klikgo/core/testing";
import { describe, expect, it } from "vitest";
import { NoopAnalytics, PostHogAnalytics } from "./posthog-analytics";
import {
  NoopErrorReporter,
  SentryErrorReporter,
  parseSentryDsn,
  stackFrames,
} from "./sentry-error-reporter";

function recordingFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(null, { status }));
  };
  return { calls, fetch: fake as typeof fetch };
}

describe("Sentry error reporter", () => {
  it("reads https DSNs and refuses anything else", () => {
    expect(parseSentryDsn("https://abc123@o1.ingest.sentry.io/4507")).toEqual({
      envelopeUrl: "https://o1.ingest.sentry.io/api/4507/envelope/",
      publicKey: "abc123",
      dsn: "https://abc123@o1.ingest.sentry.io/4507",
    });
    for (const bad of [
      undefined,
      "",
      "not a url",
      "http://abc@host/1",
      "https://host/1",
      "https://k@host/abc",
    ]) {
      expect(parseSentryDsn(bad), String(bad)).toBeNull();
    }
  });

  it("turns V8 stacks into frames, oldest first", () => {
    const frames = stackFrames(
      "TypeError: x\n    at place (/app/order.js:10:5)\n    at /app/node_modules/next/x.js:1:2\nnot a frame",
    );
    expect(frames).toEqual([
      { filename: "/app/node_modules/next/x.js", lineno: 1, colno: 2, in_app: false },
      { function: "place", filename: "/app/order.js", lineno: 10, colno: 5, in_app: true },
    ]);
    expect(stackFrames(undefined)).toEqual([]);
  });

  it("posts one envelope with the event, tags and user id only", async () => {
    const target = parseSentryDsn("https://abc123@o1.ingest.sentry.io/4507");
    if (!target) throw new Error("dsn");
    const { calls, fetch } = recordingFetch();
    const reporter = new SentryErrorReporter(target, {
      environment: "production",
      release: "abc1234",
      logger: new MemoryLogger(),
      fetch,
    });
    const context: ErrorContext = {
      source: "browser",
      requestId: "req-1",
      route: "/checkout",
      userId: "u-1",
      tags: { digest: "d1" },
      extra: { orderId: "o-1" },
    };
    await reporter.capture(
      { name: "TypeError", message: "boom", stack: "x\n    at f (/a.js:1:1)" },
      context,
    );
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://o1.ingest.sentry.io/api/4507/envelope/");
    expect(new Headers(call?.init.headers).get("x-sentry-auth")).toContain("sentry_key=abc123");
    const [header, item, event] = String(call?.init.body)
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(header).toMatchObject({ dsn: target.dsn });
    expect(item).toEqual({ type: "event" });
    expect(event).toMatchObject({
      platform: "javascript",
      environment: "production",
      release: "abc1234",
      tags: { source: "browser", route: "/checkout", request_id: "req-1", digest: "d1" },
      user: { id: "u-1" },
      extra: { orderId: "o-1" },
      exception: { values: [{ type: "TypeError", value: "boom" }] },
    });
    expect(JSON.stringify(event)).not.toContain("ip_address");
  });

  it("logs when Sentry refuses an event", async () => {
    const target = parseSentryDsn("https://abc123@o1.ingest.sentry.io/4507");
    if (!target) throw new Error("dsn");
    const logger = new MemoryLogger();
    const { fetch } = recordingFetch(429);
    await new SentryErrorReporter(target, {
      environment: "x",
      release: "y",
      logger,
      fetch,
    }).capture({ name: "Error", message: "m" }, { source: "server" });
    expect(logger.lines.map((l) => l.message)).toEqual(["sentry.rejected"]);
    await expect(new NoopErrorReporter().capture()).resolves.toBeUndefined();
  });
});

describe("PostHog analytics", () => {
  it("captures the event by distinct id with GeoIP and person profiles off", async () => {
    const { calls, fetch } = recordingFetch();
    const analytics = new PostHogAnalytics({
      apiKey: "phc_test",
      host: "https://eu.i.posthog.com/",
      logger: new MemoryLogger(),
      fetch,
    });
    await analytics.capture({
      distinctId: "anon-1",
      event: "store_viewed",
      properties: { store_id: "s-1" },
      at: new Date("2026-11-23T04:00:00Z"),
    });
    expect(calls[0]?.url).toBe("https://eu.i.posthog.com/capture/");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      api_key: "phc_test",
      event: "store_viewed",
      distinct_id: "anon-1",
      timestamp: "2026-11-23T04:00:00.000Z",
      properties: { store_id: "s-1", $geoip_disable: true, $process_person_profile: false },
    });
  });

  it("logs a refused event, and the no-op counts nothing", async () => {
    const logger = new MemoryLogger();
    const { fetch } = recordingFetch(401);
    await new PostHogAnalytics({ apiKey: "k", host: "https://h", logger, fetch }).capture({
      distinctId: "a",
      event: "home_viewed",
      properties: {},
      at: new Date(),
    });
    expect(logger.lines.map((l) => l.message)).toEqual(["posthog.rejected"]);
    await expect(new NoopAnalytics().capture()).resolves.toBeUndefined();
  });
});

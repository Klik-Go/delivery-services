import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPinoLogger } from "./pino-logger";
import { currentRequestId, runWithRequestContext } from "./request-context";

function captureLogs(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("PinoLogger", () => {
  it("writes one structured JSON line per event with service and level names", () => {
    const { stream, lines } = captureLogs();
    const logger = createPinoLogger({ level: "info", service: "klikgo-web", destination: stream });

    logger.info("order placed", { orderId: "o-1" });

    const [line] = lines();
    expect(line).toMatchObject({
      level: "info",
      service: "klikgo-web",
      msg: "order placed",
      orderId: "o-1",
    });
    expect(typeof line?.time).toBe("string");
  });

  it("carries the request id on every line from a child logger", () => {
    const { stream, lines } = captureLogs();
    const logger = createPinoLogger({ level: "debug", service: "s", destination: stream }).child({
      requestId: "req-7",
    });

    logger.debug("a");
    logger.warn("b");

    expect(lines().map((l) => l.requestId)).toEqual(["req-7", "req-7"]);
  });

  it("redacts personal data and credentials before they reach log storage", () => {
    const { stream, lines } = captureLogs();
    const logger = createPinoLogger({ level: "info", service: "s", destination: stream });

    logger.info("signup", {
      phone: "+639171234567",
      user: { email: "juan@example.com", fullName: "Juan Dela Cruz" },
      headers: { authorization: "Bearer abc", cookie: "sb=1" },
      password: "hunter2",
    });

    const serialized = JSON.stringify(lines()[0]);
    for (const secret of [
      "+639171234567",
      "juan@example.com",
      "Juan Dela Cruz",
      "Bearer abc",
      "sb=1",
      "hunter2",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("[redacted]");
  });

  it("serialises errors with their stack instead of an empty object", () => {
    const { stream, lines } = captureLogs();
    const logger = createPinoLogger({ level: "info", service: "s", destination: stream });

    logger.error("payment failed", { err: new Error("gateway timeout") });

    const line = lines()[0] as { err?: { message?: string; stack?: string } };
    expect(line.err?.message).toBe("gateway timeout");
    expect(line.err?.stack).toContain("gateway timeout");
  });

  it("drops events below the configured level", () => {
    const { stream, lines } = captureLogs();
    const logger = createPinoLogger({ level: "warn", service: "s", destination: stream });
    logger.info("noise");
    logger.error("signal");
    expect(lines().map((l) => l.msg)).toEqual(["signal"]);
  });

  it("stamps every line written during a request with its id, even from deep in a service", async () => {
    const { stream, lines } = captureLogs();
    const logger = createPinoLogger({ level: "info", service: "klikgo-web", destination: stream });
    const service = async (): Promise<void> => {
      await Promise.resolve();
      logger.info("dispatch.offered", { orderId: "o-1", contact_phone: "+639171234567" });
    };
    await runWithRequestContext({ requestId: "req-42" }, service);
    logger.info("outside");
    expect(lines()).toEqual([
      expect.objectContaining({
        msg: "dispatch.offered",
        requestId: "req-42",
        contact_phone: "[redacted]",
      }),
      expect.not.objectContaining({ requestId: expect.anything() }),
    ]);
    expect(currentRequestId()).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiErrorSchema, HealthResponseSchema, apiEnvelope } from "./api";

describe("API schemas", () => {
  it("accepts the health endpoint's response", () => {
    const body = {
      data: { status: "ok" },
      error: null,
      meta: { requestId: "r", version: "dev", checkedAt: "2026-11-04T00:00:00.000Z" },
    };
    expect(HealthResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects a health response that is not ok", () => {
    expect(
      HealthResponseSchema.safeParse({
        data: { status: "down" },
        error: null,
        meta: { requestId: "r" },
      }).success,
    ).toBe(false);
  });

  it("builds envelopes for any payload schema", () => {
    const Envelope = apiEnvelope(z.object({ id: z.string() }));
    expect(
      Envelope.safeParse({ data: { id: "o-1" }, error: null, meta: { requestId: "r" } }).success,
    ).toBe(true);
    expect(
      Envelope.safeParse({ data: { id: 1 }, error: null, meta: { requestId: "r" } }).success,
    ).toBe(false);
  });

  it("describes errors with a code, message and optional field issues", () => {
    expect(
      ApiErrorSchema.parse({
        code: "VALIDATION_FAILED",
        message: "Bad",
        issues: [{ path: "phone", message: "Invalid" }],
      }),
    ).toBeTruthy();
    expect(ApiErrorSchema.safeParse({ message: "no code" }).success).toBe(false);
  });
});

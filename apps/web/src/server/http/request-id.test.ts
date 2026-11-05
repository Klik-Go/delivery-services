import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request id", () => {
  it("uses the x-request-id header name", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("keeps a well-formed id from an upstream proxy so logs line up end to end", () => {
    const id = "2f1c6a4e-8b7d-4c1a-9f3e-5d6b7a8c9d0e";
    expect(resolveRequestId(id)).toBe(id);
  });

  it("creates a new UUID when none is sent", () => {
    expect(resolveRequestId(null)).toMatch(UUID);
  });

  it("replaces junk or oversized ids so clients cannot inject into logs", () => {
    expect(resolveRequestId("hello\nworld")).toMatch(UUID);
    expect(resolveRequestId("x".repeat(500))).toMatch(UUID);
  });
});

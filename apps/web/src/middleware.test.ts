import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, middleware } from "./middleware";

describe("middleware", () => {
  it("runs on the Node.js runtime, not Edge", () => {
    expect(config.runtime).toBe("nodejs");
  });

  it("sets a nonce CSP and a request id on the response", () => {
    const response = middleware(new NextRequest("http://localhost/"));
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("forwards the caller's well-formed request id", () => {
    const id = "0f6e2a4b-1c3d-4e5f-9a8b-7c6d5e4f3a2b";
    const response = middleware(
      new NextRequest("http://localhost/api/health", { headers: { "x-request-id": id } }),
    );
    expect(response.headers.get("x-request-id")).toBe(id);
  });
});

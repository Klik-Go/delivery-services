import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("does not opt into the Edge runtime (Next.js 16 proxies always run on Node.js)", () => {
    expect(config).not.toHaveProperty("runtime");
  });

  it("sets a nonce CSP and a request id on the response", async () => {
    const response = await proxy(new NextRequest("http://localhost/"));
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("forwards the caller's well-formed request id", async () => {
    const id = "0f6e2a4b-1c3d-4e5f-9a8b-7c6d5e4f3a2b";
    const response = await proxy(
      new NextRequest("http://localhost/api/health", { headers: { "x-request-id": id } }),
    );
    expect(response.headers.get("x-request-id")).toBe(id);
  });

  it("skips static assets so they stay cacheable", () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher ?? ""}$`);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/api/health")).toBe(true);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(pattern.test("/brand/klik-go-logo.svg")).toBe(false);
  });
});

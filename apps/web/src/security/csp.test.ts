import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, generateNonce } from "./csp";

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = "", ...values] = part.split(/\s+/);
        return [name, values.join(" ")] as const;
      }),
  );
}

describe("Content-Security-Policy", () => {
  it("only lets scripts run that carry this request's nonce", () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: "abc123", isDev: false }));
    expect(csp.get("script-src")).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("blocks framing, plugins, base-tag hijacks and off-site form posts", () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: "n", isDev: false }));
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("base-uri")).toBe("'self'");
    expect(csp.get("form-action")).toBe("'self'");
    expect(csp.get("default-src")).toBe("'self'");
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
  });

  it("allows map tiles from OpenStreetMap by default, or from the configured provider", () => {
    const osm = directives(buildContentSecurityPolicy({ nonce: "n", isDev: false }));
    const custom = directives(
      buildContentSecurityPolicy({
        nonce: "n",
        isDev: false,
        tileOrigin: "https://api.maptiler.com",
      }),
    );
    expect(osm.get("img-src")).toContain("https://tile.openstreetmap.org");
    expect(custom.get("img-src")).toContain("https://api.maptiler.com");
    expect(custom.get("img-src")).not.toContain("openstreetmap");
  });

  it("allows eval and HMR websockets only in development", () => {
    const prod = buildContentSecurityPolicy({ nonce: "n", isDev: false });
    const dev = buildContentSecurityPolicy({ nonce: "n", isDev: true });
    expect(prod).not.toContain("'unsafe-eval'");
    expect(dev).toContain("'unsafe-eval'");
    expect(directives(dev).get("connect-src")).toContain("ws:");
    expect(directives(dev).has("upgrade-insecure-requests")).toBe(false);
  });

  it("lets the browser talk to Supabase for realtime and storage when configured", () => {
    const csp = directives(
      buildContentSecurityPolicy({
        nonce: "n",
        isDev: false,
        supabaseUrl: "https://abc.supabase.co",
      }),
    );
    expect(csp.get("connect-src")).toBe("'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(csp.get("img-src")).toContain("https://abc.supabase.co");
  });

  it("ignores a malformed Supabase URL instead of weakening the policy", () => {
    const csp = buildContentSecurityPolicy({ nonce: "n", isDev: false, supabaseUrl: "not a url" });
    expect(directives(csp).get("connect-src")).toBe("'self'");
  });

  it("generates a fresh base64 nonce of at least 128 bits per request", () => {
    const first = generateNonce();
    const second = generateNonce();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(first, "base64").length).toBeGreaterThanOrEqual(16);
  });
});

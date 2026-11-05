import { describe, expect, it } from "vitest";
import { STATIC_SECURITY_HEADERS } from "./security-headers";

describe("static security headers", () => {
  const headers = new Map(STATIC_SECURITY_HEADERS.map(({ key, value }) => [key, value]));

  it("forces HTTPS for two years, including subdomains", () => {
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("refuses to be framed and does not sniff content types", () => {
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("limits referrer leakage", () => {
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("allows location only for our own pages (pin drop, rider GPS) and disables the rest", () => {
    const policy = headers.get("Permissions-Policy") ?? "";
    expect(policy).toContain("geolocation=(self)");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("payment=()");
  });
});

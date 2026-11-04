import { expect, test } from "@playwright/test";

// Mirrors features/security-headers.feature.
for (const path of ["/", "/api/health"]) {
  test(`security headers are present on ${path}`, async ({ request }) => {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
}

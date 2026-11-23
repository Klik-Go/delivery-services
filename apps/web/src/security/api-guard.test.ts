import { describe, expect, it } from "vitest";
import {
  API_CHANGES_PER_KEY,
  API_READS_PER_IP,
  API_READS_PER_USER,
  apiRateLimit,
  isCrossSiteChange,
  isGuardedApiPath,
} from "./api-guard";

const HOST = "klikgo.example";

describe("API guard", () => {
  it("guards every public API route but not webhooks, hooks, jobs and health checks", () => {
    for (const path of ["/api/orders", "/api/auth/otp", "/api/me/delete", "/api/healthy-food"]) {
      expect(isGuardedApiPath(path), path).toBe(true);
    }
    for (const path of [
      "/api/health",
      "/api/health/ready",
      "/api/webhooks/paymongo",
      "/api/hooks/send-sms",
      "/api/internal/jobs",
      "/s/kape",
    ]) {
      expect(isGuardedApiPath(path), path).toBe(false);
    }
  });

  it("refuses changes a browser sends for another site", () => {
    const h = (entries: Record<string, string>) => new Headers(entries);
    expect(isCrossSiteChange("POST", h({ origin: "https://evil.example" }), HOST)).toBe(true);
    expect(isCrossSiteChange("DELETE", h({ origin: "null" }), HOST)).toBe(true);
    expect(isCrossSiteChange("PUT", h({ "sec-fetch-site": "cross-site" }), HOST)).toBe(true);
    expect(isCrossSiteChange("POST", h({ origin: "not a url" }), HOST)).toBe(true);
    expect(isCrossSiteChange("POST", h({ origin: "https://evil.example" }), null)).toBe(true);
  });

  it("accepts same-site changes, reads and non-browser clients", () => {
    const h = (entries: Record<string, string>) => new Headers(entries);
    expect(isCrossSiteChange("POST", h({ origin: "https://KlikGo.example" }), HOST)).toBe(false);
    expect(
      isCrossSiteChange(
        "PATCH",
        h({ "sec-fetch-site": "same-origin", origin: `https://${HOST}` }),
        HOST,
      ),
    ).toBe(false);
    expect(isCrossSiteChange("GET", h({ origin: "https://evil.example" }), HOST)).toBe(false);
    expect(isCrossSiteChange("POST", h({}), HOST)).toBe(false);
  });

  it("limits by account when signed in and by IP otherwise, with a tighter limit on changes", () => {
    expect(apiRateLimit("GET", { userId: "u-1", ip: "203.0.113.9" })).toEqual({
      key: "api:r:user:u-1",
      rule: API_READS_PER_USER,
    });
    expect(apiRateLimit("GET", { userId: null, ip: "203.0.113.9" })).toEqual({
      key: "api:r:ip:203.0.113.9",
      rule: API_READS_PER_IP,
    });
    expect(apiRateLimit("post", { userId: null, ip: "203.0.113.9" })).toEqual({
      key: "api:w:ip:203.0.113.9",
      rule: API_CHANGES_PER_KEY,
    });
  });
});

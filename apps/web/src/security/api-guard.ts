import type { RateLimitRule } from "@klikgo/core";

/** Methods that change something; only these need the same-site check (ASVS 50.1, CSRF). */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Server-to-server endpoints: they authenticate with a signature or a shared secret, are called by
 * Supabase, PayMongo or the scheduler (no browser, no cookies), and must not be slowed down by a
 * per-IP limit. Health checks are called by monitors every minute.
 */
const UNGUARDED = [
  /^\/api\/health(\/|$)/,
  /^\/api\/webhooks\//,
  /^\/api\/hooks\//,
  /^\/api\/internal\//,
];

/** Whether the proxy applies the origin check and the rate limit to this path. */
export function isGuardedApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/") && !UNGUARDED.some((pattern) => pattern.test(pathname));
}

/**
 * True when a browser sent a state-changing request on behalf of another site. Browsers always
 * send Origin (and Sec-Fetch-Site) on these requests, so a mismatch is decisive. Requests with
 * neither header come from non-browser clients (scripts, apps, tests), which cannot ride on a
 * victim's cookies, so they are not cross-site in the CSRF sense.
 */
export function isCrossSiteChange(method: string, headers: Headers, host: string | null): boolean {
  if (!UNSAFE.has(method.toUpperCase())) return false;
  if (headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = headers.get("origin");
  if (origin === null) return false;
  if (origin === "null" || !host) return true;
  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true;
  }
}

/** Reads are cheap and frequent (map polling, feed scrolls); changes are rarer and costlier. */
export const API_READS_PER_USER: RateLimitRule = { limit: 300, windowSeconds: 60 };
/** Many phones share one carrier IP (CGNAT), so the anonymous read limit is generous. */
export const API_READS_PER_IP: RateLimitRule = { limit: 600, windowSeconds: 60 };
export const API_CHANGES_PER_KEY: RateLimitRule = { limit: 60, windowSeconds: 60 };

/**
 * The global limit for one API request: by the signed-in account when there is one (so people on
 * a shared carrier IP do not limit each other), by IP otherwise. Endpoints that guess credentials
 * or send SMS keep their own, much tighter limits in the services.
 */
export function apiRateLimit(
  method: string,
  identity: { readonly userId: string | null; readonly ip: string },
): { readonly key: string; readonly rule: RateLimitRule } {
  const write = UNSAFE.has(method.toUpperCase());
  const who = identity.userId ? `user:${identity.userId}` : `ip:${identity.ip}`;
  if (write) return { key: `api:w:${who}`, rule: API_CHANGES_PER_KEY };
  return {
    key: `api:r:${who}`,
    rule: identity.userId ? API_READS_PER_USER : API_READS_PER_IP,
  };
}

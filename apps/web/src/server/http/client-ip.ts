/**
 * Best-effort client IP for rate limiting. On Vercel, `x-forwarded-for` is set by the platform
 * (clients cannot spoof the first hop there). Locally and in tests it is whatever the caller sends.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}

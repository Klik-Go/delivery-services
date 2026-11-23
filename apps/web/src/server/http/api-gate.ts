import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRateLimit, isCrossSiteChange, isGuardedApiPath } from "../../security/api-guard";
import { getContainer } from "../container";
import { clientIp } from "./client-ip";
import { REQUEST_ID_HEADER } from "./request-id";

function refusal(
  status: 403 | 429,
  code: "FORBIDDEN" | "RATE_LIMITED",
  message: string,
  requestId: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { data: null, error: { code, message }, meta: { requestId } },
    {
      status,
      headers: { "cache-control": "no-store", [REQUEST_ID_HEADER]: requestId, ...headers },
    },
  );
}

/**
 * The checks every public API request passes before its route handler (OWASP ASVS L1): changes
 * only from Klik Go's own pages (origin check against CSRF), and a per-account or per-IP rate
 * limit. Returns the refusal, or null to carry on. A limiter outage never takes the API down.
 */
export async function guardApiRequest(
  request: NextRequest,
  userId: string | null,
  requestId: string,
): Promise<NextResponse | null> {
  if (!isGuardedApiPath(request.nextUrl.pathname)) return null;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (isCrossSiteChange(request.method, request.headers, host)) {
    return refusal(
      403,
      "FORBIDDEN",
      "Changes are only accepted from Klik Go's own pages.",
      requestId,
    );
  }
  const { key, rule } = apiRateLimit(request.method, { userId, ip: clientIp(request.headers) });
  const { rateLimiter, logger } = getContainer();
  try {
    const decision = await rateLimiter.hit(key, rule);
    if (decision.allowed) return null;
    return refusal(
      429,
      "RATE_LIMITED",
      "Too many requests. Wait a moment and try again.",
      requestId,
      {
        "retry-after": String(decision.retryAfterSeconds),
      },
    );
  } catch (error) {
    logger.warn("api.rate_limit_unavailable", {
      requestId,
      err: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

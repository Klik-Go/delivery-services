import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, generateNonce } from "./security/csp";
import { REQUEST_ID_HEADER, resolveRequestId } from "./server/http/request-id";

/**
 * Next.js 16 Proxy (formerly middleware). Runs on every page and API request: assigns a request id
 * and a fresh CSP nonce. Proxies always run on the Node.js runtime (CLAUDE.md: never Edge), so
 * later auth checks can use Node-only libraries.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the CSP from the request to stamp the nonce on its own scripts.
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

// No `runtime` key: Next.js 16 proxies always use Node.js and reject the option.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|brand/).*)",
  ],
};

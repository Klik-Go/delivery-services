import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { mapTileOrigin } from "./lib/map-tiles";
import { buildContentSecurityPolicy, generateNonce } from "./security/csp";
import { REQUEST_ID_HEADER, resolveRequestId } from "./server/http/request-id";

/**
 * Next.js 16 Proxy (formerly middleware). On every page and API request it:
 *  1. refreshes the Supabase session (rotating an expired access token into fresh cookies), so
 *     Server Components and route handlers always see a valid session;
 *  2. assigns a request id and a fresh CSP nonce.
 * Proxies always run on Node.js (CLAUDE.md: never Edge). Authorization is NOT done here; layouts
 * and route handlers check roles from the database (src/server/auth/guards.ts).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const refreshedCookies = await refreshSupabaseSession(request);

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    tileOrigin: mapTileOrigin(process.env.NEXT_PUBLIC_MAP_TILE_URL),
  });
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));

  // request.headers already carries refreshed cookies (request.cookies.set updates it).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the CSP from the request to stamp the nonce on its own scripts.
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { name, value, options } of refreshedCookies)
    response.cookies.set(name, value, options ?? {});
  response.headers.set("content-security-policy", csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

type CookieToSet = {
  name: string;
  value: string;
  options: Parameters<NextResponse["cookies"]["set"]>[2];
};

/** Lets @supabase/ssr refresh the session; returns cookies to write on the response. */
async function refreshSupabaseSession(request: NextRequest): Promise<CookieToSet[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Server-to-server callers (Supabase hooks, payment webhooks) have no session to refresh.
  const path = request.nextUrl.pathname;
  if (
    !url ||
    !key ||
    path.startsWith("/api/hooks/") ||
    path.startsWith("/api/webhooks/") ||
    path.startsWith("/api/internal/")
  )
    return [];
  const hasSession = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-"));
  if (!hasSession) return [];

  let toSet: CookieToSet[] = [];
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        toSet = cookiesToSet;
      },
    },
  });
  // Verifies the JWT and refreshes it when expired (writes the new tokens through setAll).
  await supabase.auth.getClaims();
  return toSet;
}

// No `runtime` key: Next.js 16 proxies always use Node.js and reject the option.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt|brand/).*)",
  ],
};

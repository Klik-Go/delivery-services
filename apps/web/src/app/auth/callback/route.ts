import { NextResponse } from "next/server";
import { safeNextPath } from "@/server/http/safe-next";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** GET /auth/callback?code=…&next=… — PKCE code exchange (e.g. password-recovery emails). */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/auth/mfa");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin), 303);
  }
  return NextResponse.redirect(new URL("/auth/staff?error=link", url.origin), 303);
}

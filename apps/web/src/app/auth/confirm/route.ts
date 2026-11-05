import { ConfirmLinkQuerySchema } from "@klikgo/types";
import { NextResponse } from "next/server";
import { getContainer } from "@/server/container";
import { safeNextPath } from "@/server/http/safe-next";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/**
 * GET /auth/confirm?token_hash=…&type=invite&next=/auth/set-password — verifies an emailed or
 * shared one-time link on the server (token_hash flow) and starts the session in cookies.
 * Supabase's verifyOtp is the security check: a session exists only for a valid, unused token.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const linkFailed = NextResponse.redirect(new URL("/auth/staff?error=link", url.origin), 303);
  const query = ConfirmLinkQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return linkFailed;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: query.data.token_hash,
    type: query.data.type,
  });
  if (error) {
    getContainer().logger.warn("auth.link_invalid", { type: query.data.type, code: error.code });
    return linkFailed;
  }
  const next = safeNextPath(query.data.next, "/auth/mfa");
  return NextResponse.redirect(new URL(next, url.origin), 303);
}

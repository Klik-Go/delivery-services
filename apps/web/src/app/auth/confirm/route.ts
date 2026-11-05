import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getContainer } from "@/server/container";
import { safeNextPath } from "@/server/http/safe-next";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

const LINK_TYPES: readonly EmailOtpType[] = [
  "invite",
  "recovery",
  "email",
  "magiclink",
  "email_change",
];

function isLinkType(value: string | null): value is EmailOtpType {
  return LINK_TYPES.some((type) => type === value);
}

/**
 * GET /auth/confirm?token_hash=…&type=invite&next=/auth/set-password — verifies an emailed or
 * shared one-time link on the server (token_hash flow) and starts the session in cookies.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = safeNextPath(url.searchParams.get("next"), "/auth/mfa");
  if (tokenHash && isLinkType(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, url.origin), 303);
    getContainer().logger.warn("auth.link_invalid", { type, code: error.code });
  }
  return NextResponse.redirect(new URL("/auth/staff?error=link", url.origin), 303);
}

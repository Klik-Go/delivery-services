import type { AssuranceLevel } from "@klikgo/core";
import { z } from "zod";

const ClaimsSchema = z.object({ aal: z.string().optional() });

/**
 * The assurance level written into a Supabase access token. Only call this on a token that
 * Supabase has just verified (getUser(token)); decoding alone proves nothing.
 */
export function assuranceLevelOf(accessToken: string): AssuranceLevel {
  const payload = accessToken.split(".")[1];
  if (!payload) return "aal1";
  try {
    const claims = ClaimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return claims.success && claims.data.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    // A malformed token never grants the higher level.
    return "aal1";
  }
}

import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { metaFor } from "@/server/http/route-context";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** POST /api/auth/mfa/enroll — start authenticator (TOTP) setup: QR code + manual key. */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const { logger } = getContainer();
  try {
    const user = await requireUser();
    if (!user.ok) return jsonError(user.error, meta);
    const services = getContainer().forRequest(await createSupabaseServerClient());
    const result = await services.mfa.startEnrollment();
    return result.ok ? jsonOk(result.value, meta) : jsonError(result.error, meta, logger);
  } catch (error) {
    return jsonError(error, meta, logger);
  }
}

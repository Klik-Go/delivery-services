import { OtpRequestSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { clientIp } from "@/server/http/client-ip";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { metaFor } from "@/server/http/route-context";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** POST /api/auth/otp — text a sign-in code to a Philippine mobile (rate-limited). */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const { logger } = getContainer();
  try {
    const body = await parseBody(request, OtpRequestSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const services = getContainer().forRequest(await createSupabaseServerClient());
    const result = await services.phoneOtp.requestCode({
      phone: body.value.phone,
      clientIp: clientIp(request.headers),
    });
    return result.ok ? jsonOk(result.value, meta) : jsonError(result.error, meta, logger);
  } catch (error) {
    return jsonError(error, meta, logger);
  }
}

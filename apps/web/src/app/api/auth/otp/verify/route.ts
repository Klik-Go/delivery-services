import { OtpVerifySchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { metaFor } from "@/server/http/route-context";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** POST /api/auth/otp/verify — check the code, start the session, say where to go next. */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const container = getContainer();
  try {
    const body = await parseBody(request, OtpVerifySchema);
    if (!body.ok) return jsonError(body.error, meta);
    const services = container.forRequest(await createSupabaseServerClient());
    const result = await services.phoneOtp.verifyCode(body.value);
    if (!result.ok) return jsonError(result.error, meta, container.logger);
    const roles = await container.userRoles.rolesFor(result.value.userId);
    const next = container.authz.landingPath({
      id: result.value.userId,
      phone: null,
      email: null,
      roles,
      aal: "aal1",
    });
    // New accounts, and everyone after the terms change, agree to the documents first; during
    // the invite-only pilot, customers without a code enter one next.
    const afterInvite = await container.pilotInvites.landingFor(
      { id: result.value.userId, roles },
      next,
    );
    return jsonOk(
      { next: await container.consents.landingFor(result.value.userId, afterInvite) },
      meta,
    );
  } catch (error) {
    return jsonError(error, meta, container.logger);
  }
}

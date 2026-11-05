import { MfaVerifySchema } from "@klikgo/types";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { metaFor } from "@/server/http/route-context";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** POST /api/auth/mfa/verify — verify a TOTP code (raises the session to AAL2). */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const container = getContainer();
  try {
    const user = await requireUser();
    if (!user.ok) return jsonError(user.error, meta);
    const body = await parseBody(request, MfaVerifySchema);
    if (!body.ok) return jsonError(body.error, meta);
    const services = container.forRequest(await createSupabaseServerClient());
    const result = await services.mfa.verify({
      userId: user.value.id,
      factorId: body.value.factorId ?? null,
      code: body.value.code,
    });
    if (!result.ok) return jsonError(result.error, meta, container.logger);
    return jsonOk({ next: container.authz.landingPath(user.value) }, meta);
  } catch (error) {
    return jsonError(error, meta, container.logger);
  }
}

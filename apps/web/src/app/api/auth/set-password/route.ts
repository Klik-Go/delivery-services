import { SetPasswordSchema } from "@klikgo/types";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { metaFor } from "@/server/http/route-context";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** POST /api/auth/set-password — invited (or recovering) staff choose a password. */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const { logger } = getContainer();
  try {
    const user = await requireUser();
    if (!user.ok) return jsonError(user.error, meta);
    const body = await parseBody(request, SetPasswordSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const services = getContainer().forRequest(await createSupabaseServerClient());
    const result = await services.staffAuth.setPassword({
      userId: user.value.id,
      password: body.value.password,
    });
    return result.ok ? jsonOk(result.value, meta) : jsonError(result.error, meta, logger);
  } catch (error) {
    return jsonError(error, meta, logger);
  }
}

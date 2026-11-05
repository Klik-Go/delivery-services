import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { metaFor } from "@/server/http/route-context";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** POST /api/auth/sign-out — revoke this session's refresh token and clear the cookies. */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const { logger } = getContainer();
  try {
    const result = await getContainer()
      .forRequest(await createSupabaseServerClient())
      .signOut();
    return result.ok ? jsonOk({ next: "/" }, meta) : jsonError(result.error, meta, logger);
  } catch (error) {
    return jsonError(error, meta, logger);
  }
}

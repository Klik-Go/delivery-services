import { UnauthorizedError } from "@klikgo/core";
import { realtimeAccess } from "@/server/auth/realtime-access";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/realtime/token — the session token for listening to private live-update channels. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const access = await realtimeAccess();
    return access ? jsonOk(access, meta) : jsonError(new UnauthorizedError(), meta);
  });
}

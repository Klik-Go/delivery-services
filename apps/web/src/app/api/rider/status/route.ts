import { RiderOnlineSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/rider/status — go online (offers and location sharing) or offline. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, RiderOnlineSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().riders.setOnline(await getSessionUser(), body.value.online),
      meta,
    );
  });
}

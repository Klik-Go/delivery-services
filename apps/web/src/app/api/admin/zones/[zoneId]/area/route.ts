import { ZoneAreaSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** PUT /api/admin/zones/:zoneId/area — redraw the zone's outline (admins). */
export async function PUT(
  request: Request,
  context: { params: Promise<{ zoneId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, ZoneAreaSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().zoneAdmin.setArea(
        await getSessionUser(),
        ids.value.zoneId,
        body.value.ring,
      ),
      meta,
    );
  });
}

import { ZoneUpdateSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/zones/:zoneId — fees, radius, name, active (admins). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ zoneId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, ZoneUpdateSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().zoneAdmin.update(await getSessionUser(), ids.value.zoneId, body.value),
      meta,
    );
  });
}

import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** DELETE /api/admin/staff/:grantId — revoke a staff role (admins; audited). */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ grantId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    return respond(
      await getContainer().staffAdmin.revoke(await getSessionUser(), ids.value.grantId),
      meta,
    );
  });
}

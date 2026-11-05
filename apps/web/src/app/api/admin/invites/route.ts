import { InviteStaffSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { getServerEnv } from "@/server/env";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { metaFor } from "@/server/http/route-context";

/** POST /api/admin/invites — admins (AAL2) invite merchant, coordinator or admin staff. */
export async function POST(request: Request): Promise<Response> {
  const meta = metaFor(request);
  const container = getContainer();
  try {
    const body = await parseBody(request, InviteStaffSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const service = container.inviteService();
    if (!service.ok) return jsonError(service.error, meta, container.logger);
    const result = await service.value.inviteStaff(await getSessionUser(), body.value);
    if (!result.ok) return jsonError(result.error, meta, container.logger);
    const origin = getServerEnv().NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return jsonOk(
      { ...result.value, inviteUrl: new URL(result.value.invitePath, origin).toString() },
      meta,
      201,
    );
  } catch (error) {
    return jsonError(error, meta, container.logger);
  }
}

import { ApproveApplicationSchema } from "@klikgo/types";
import { requireAction } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { getServerEnv } from "@/server/env";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, runRoute } from "@/server/http/route";

/** POST /api/admin/merchant-applications/:id/approve — creates the store and the owner's invite. */
export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const user = await requireAction({ type: "merchant.applications.review" });
    if (!user.ok) return jsonError(user.error, meta);
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, ApproveApplicationSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const service = getContainer().merchantOnboarding();
    if (!service.ok) return jsonError(service.error, meta, getContainer().logger);
    const approved = await service.value.approve(user.value, ids.value.applicationId, body.value);
    if (!approved.ok) return jsonError(approved.error, meta, getContainer().logger);
    const origin = getServerEnv().NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return jsonOk(
      { ...approved.value, inviteUrl: new URL(approved.value.invitePath, origin).toString() },
      meta,
      201,
    );
  });
}

import { RejectApplicationSchema } from "@klikgo/types";
import { requireAction } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

/** POST /api/admin/merchant-applications/:id/reject — with a reason the team can read later. */
export async function POST(
  request: Request,
  context: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const user = await requireAction({ type: "merchant.applications.review" });
    if (!user.ok) return jsonError(user.error, meta);
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, RejectApplicationSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const service = getContainer().merchantOnboarding();
    if (!service.ok) return jsonError(service.error, meta, getContainer().logger);
    return respond(
      await service.value.reject(user.value, ids.value.applicationId, body.value.reason),
      meta,
    );
  });
}

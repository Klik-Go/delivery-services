import { KycDecisionSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ documentId: string }> };

/** GET /api/admin/kyc/:documentId — a 60-second link to the document (the view is audited). */
export async function GET(request: Request, context: Params): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    return respond(
      await getContainer().riderAdmin.viewDocument(await getSessionUser(), ids.value.documentId),
      meta,
    );
  });
}

/** POST /api/admin/kyc/:documentId — accept, or reject with a reason. */
export async function POST(request: Request, context: Params): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, KycDecisionSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().riderAdmin.reviewDocument(
        await getSessionUser(),
        ids.value.documentId,
        body.value,
      ),
      meta,
    );
  });
}

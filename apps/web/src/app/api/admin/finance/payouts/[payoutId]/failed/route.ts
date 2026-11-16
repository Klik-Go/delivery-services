import { PayoutFailedSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/finance/payouts/:payoutId/failed — with a reason (the money is paid next week); audited. */
export async function POST(
  request: Request,
  context: { params: Promise<{ payoutId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, PayoutFailedSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().payouts.markFailed(
        await getSessionUser(),
        ids.value.payoutId,
        body.value.reason,
      ),
      meta,
    );
  });
}

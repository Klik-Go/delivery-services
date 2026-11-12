import { OpsCancelSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/orders/:orderId/cancel — cancel with a reason (audited). */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, OpsCancelSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().adminOrders.cancel(
        await getSessionUser(),
        ids.value.orderId,
        body.value,
      ),
      meta,
    );
  });
}

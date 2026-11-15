import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:orderId/reorder — the same items priced today, with anything gone, sold out
 * or changed flagged. Places nothing: the app fills the cart from the answer.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    return respond(
      await getContainer().orderHistory.reorder(await getSessionUser(), ids.value.orderId),
      meta,
    );
  });
}

import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/merchant/:merchantId/orders — the store's live board (new, preparing, ready, picked up). */
export async function GET(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    return respond(
      await getContainer().lifecycle.board(ids.value.merchantId, await getSessionUser()),
      meta,
    );
  });
}

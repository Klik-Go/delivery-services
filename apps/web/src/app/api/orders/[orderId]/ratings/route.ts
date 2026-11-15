import { CustomerRatingSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ orderId: string }> };

/** GET /api/orders/:orderId/ratings — the customer's rating sheet (store and rider). */
export async function GET(request: Request, context: Context): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    return respond(
      await getContainer().ratings.sheet(await getSessionUser(), ids.value.orderId),
      meta,
    );
  });
}

/** POST /api/orders/:orderId/ratings — rate the store and/or the rider (changeable for 24 hours). */
export async function POST(request: Request, context: Context): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const body = await parseBody(request, CustomerRatingSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().ratings.rateOrder(await getSessionUser(), ids.value.orderId, body.value),
      meta,
    );
  });
}

import { CartQuoteRequestSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

/** POST /api/cart/quote — server-side price of a cart (ids in, prices out). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, CartQuoteRequestSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(await getContainer().pricing.quote(body.value), meta);
  });
}

import { MenuItemInputSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

/** POST /api/merchant/:merchantId/menu/items — price in pesos, stored in centavos. */
export async function POST(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, MenuItemInputSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().menu.createItem(user, ids.merchantId, body.value),
      meta,
      201,
    );
  });
}

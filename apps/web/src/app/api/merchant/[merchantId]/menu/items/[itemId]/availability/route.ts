import { ItemAvailabilitySchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

/** PUT /api/merchant/:merchantId/menu/items/:itemId/availability — the sold-out toggle. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ merchantId: string; itemId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, ItemAvailabilitySchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().menu.setAvailability(
        user,
        ids.merchantId,
        ids.itemId,
        body.value.isAvailable,
      ),
      meta,
    );
  });
}

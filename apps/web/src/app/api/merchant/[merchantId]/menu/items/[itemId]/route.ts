import { MenuItemInputSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

type Context = { params: Promise<{ merchantId: string; itemId: string }> };

/** PUT /api/merchant/:merchantId/menu/items/:itemId — replace the item and its modifiers. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, MenuItemInputSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().menu.updateItem(user, ids.merchantId, ids.itemId, body.value),
      meta,
    );
  });
}

/** DELETE /api/merchant/:merchantId/menu/items/:itemId */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) =>
    respond(await getContainer().menu.deleteItem(user, ids.merchantId, ids.itemId), meta),
  );
}

import { MenuCategoryInputSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

type Context = { params: Promise<{ merchantId: string; categoryId: string }> };

/** PATCH /api/merchant/:merchantId/menu/categories/:categoryId — rename. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, MenuCategoryInputSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().menu.renameCategory(
        user,
        ids.merchantId,
        ids.categoryId,
        body.value.name,
      ),
      meta,
    );
  });
}

/** DELETE /api/merchant/:merchantId/menu/categories/:categoryId — with its items. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) =>
    respond(await getContainer().menu.deleteCategory(user, ids.merchantId, ids.categoryId), meta),
  );
}

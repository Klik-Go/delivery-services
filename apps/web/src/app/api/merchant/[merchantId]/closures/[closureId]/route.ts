import { getContainer } from "@/server/container";
import { merchantRoute } from "@/server/http/merchant-route";
import { respond } from "@/server/http/route";

/** DELETE /api/merchant/:merchantId/closures/:closureId */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ merchantId: string; closureId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) =>
    respond(
      await getContainer().storeSettings.removeClosure(user, ids.merchantId, ids.closureId),
      meta,
    ),
  );
}

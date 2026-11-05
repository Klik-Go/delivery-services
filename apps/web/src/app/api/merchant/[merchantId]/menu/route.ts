import { getContainer } from "@/server/container";
import { merchantRoute } from "@/server/http/merchant-route";
import { respond } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/merchant/:merchantId/menu — the full menu as the store's team sees it. */
export async function GET(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) =>
    respond(await getContainer().menu.menu(user, ids.merchantId), meta),
  );
}

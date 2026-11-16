import { getContainer } from "@/server/container";
import { merchantRoute } from "@/server/http/merchant-route";
import { respond } from "@/server/http/route";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ merchantId: string }> };

/** GET /api/merchant/:merchantId/payouts — payout account, open balance, weekly statements (owner). */
export async function GET(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) =>
    respond(
      await getContainer().payouts.page(user, { kind: "merchant", merchantId: ids.merchantId }),
      meta,
    ),
  );
}

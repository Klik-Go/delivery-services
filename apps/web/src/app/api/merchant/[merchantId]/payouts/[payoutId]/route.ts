import { getContainer } from "@/server/container";
import { merchantRoute } from "@/server/http/merchant-route";
import { respond } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/merchant/:merchantId/payouts/:payoutId — one weekly statement with its lines (owner). */
export async function GET(
  request: Request,
  context: { params: Promise<{ merchantId: string; payoutId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) =>
    respond(
      await getContainer().payouts.statement(
        user,
        { kind: "merchant", merchantId: ids.merchantId },
        ids.payoutId,
      ),
      meta,
    ),
  );
}

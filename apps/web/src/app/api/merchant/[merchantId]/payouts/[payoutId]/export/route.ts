import { getContainer } from "@/server/container";
import { csvResponse } from "@/server/http/csv-response";
import { merchantRoute } from "@/server/http/merchant-route";

export const dynamic = "force-dynamic";

/** GET /api/merchant/:merchantId/payouts/:payoutId/export — the statement as CSV (owner). */
export async function GET(
  request: Request,
  context: { params: Promise<{ merchantId: string; payoutId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) =>
    csvResponse(
      await getContainer().payouts.statementCsv(
        user,
        { kind: "merchant", merchantId: ids.merchantId },
        ids.payoutId,
      ),
      meta,
    ),
  );
}

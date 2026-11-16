import { PayoutAccountSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** PUT /api/merchant/:merchantId/payouts/account — where the store is paid (owner). */
export async function PUT(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) => {
    const body = await parseBody(request, PayoutAccountSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().payouts.saveAccount(
        user,
        { kind: "merchant", merchantId: ids.merchantId },
        body.value,
      ),
      meta,
    );
  });
}

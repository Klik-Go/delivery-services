import { StoreClosureSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

/** POST /api/merchant/:merchantId/closures — owner adds a holiday closure. */
export async function POST(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) => {
    const body = await parseBody(request, StoreClosureSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().storeSettings.addClosure(user, ids.merchantId, body.value),
      meta,
      201,
    );
  });
}

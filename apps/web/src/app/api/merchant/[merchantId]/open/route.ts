import { StoreOpenSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

/** PUT /api/merchant/:merchantId/open — any team member opens or closes the store. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, StoreOpenSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().storeSettings.setOpen(user, ids.merchantId, body.value.isOpen),
      meta,
    );
  });
}

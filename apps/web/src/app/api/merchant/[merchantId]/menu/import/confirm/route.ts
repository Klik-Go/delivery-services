import { ConfirmMenuImportSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

/** POST /api/merchant/:merchantId/menu/import/confirm — saves the drafts the merchant reviewed. */
export async function POST(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, ConfirmMenuImportSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().menu.importReviewedItems(user, ids.merchantId, body.value.items),
      meta,
      201,
    );
  });
}

import { StoreSettingsSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

type Context = { params: Promise<{ merchantId: string }> };

export const dynamic = "force-dynamic";

/** GET /api/merchant/:merchantId/settings — hours, prep time, COD, radius, closures, open state. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) =>
    respond(await getContainer().storeSettings.settings(user, ids.merchantId), meta),
  );
}

/** PUT /api/merchant/:merchantId/settings — owner-only store settings. */
export async function PUT(request: Request, context: Context): Promise<Response> {
  return merchantRoute(request, context, "merchant.settings", async ({ user, ids, meta }) => {
    const body = await parseBody(request, StoreSettingsSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().storeSettings.update(user, ids.merchantId, body.value),
      meta,
    );
  });
}

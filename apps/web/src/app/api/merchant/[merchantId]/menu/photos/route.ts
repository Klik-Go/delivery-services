import { PhotoUploadRequestSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { parseBody } from "@/server/http/parse-body";
import { respond } from "@/server/http/route";

/**
 * POST /api/merchant/:merchantId/menu/photos — a one-time upload link for a WebP of at most
 * 200 KB (the browser compresses first; the bucket enforces the same limits).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const body = await parseBody(request, PhotoUploadRequestSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(await getContainer().menu.createPhotoUpload(user, ids.merchantId), meta, 201);
  });
}

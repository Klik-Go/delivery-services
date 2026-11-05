import { ValidationError } from "@klikgo/core";
import { MAX_MENU_IMPORT_BYTES } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { merchantRoute } from "@/server/http/merchant-route";
import { respond } from "@/server/http/route";

/**
 * POST /api/merchant/:merchantId/menu/import — multipart form with a `photo` of a printed menu.
 * Returns draft items only; nothing is saved until the merchant confirms (…/import/confirm).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ merchantId: string }> },
): Promise<Response> {
  return merchantRoute(request, context, "merchant.manage", async ({ user, ids, meta }) => {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_MENU_IMPORT_BYTES + 64 * 1024)
      return jsonError(new ValidationError("The photo must be smaller than 5 MB."), meta);
    const form = await request.formData().catch(() => null);
    const photo = form?.get("photo");
    if (!(photo instanceof File))
      return jsonError(new ValidationError("Choose a photo of your menu."), meta);
    return respond(
      await getContainer().menuImport.readMenuPhoto(user, ids.merchantId, {
        data: new Uint8Array(await photo.arrayBuffer()),
        mimeType: photo.type,
      }),
      meta,
    );
  });
}

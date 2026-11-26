import { ValidationError } from "@klikgo/core";
import { PabiliPurchaseSchema, ReceiptPhotoSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

const invalid = (message: string, path: string): ValidationError =>
  new ValidationError(message, [{ path, message }]);

function parseJson(text: FormDataEntryValue | null): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * POST /api/rider/jobs/:orderId/bought — multipart form: `itemCostCentavos` (the receipt total),
 * `items` (JSON: each line's position and bought/unavailable) and the `receipt` photo.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(invalid("Send the purchase as a form.", "body"), meta);
    }
    const cost = form.get("itemCostCentavos");
    const fields = PabiliPurchaseSchema.safeParse({
      itemCostCentavos: typeof cost === "string" && cost.trim() !== "" ? Number(cost) : undefined,
      items: parseJson(form.get("items")),
    });
    if (!fields.success) {
      const issue = fields.error.issues[0];
      return jsonError(
        invalid(issue?.message ?? "Invalid purchase.", String(issue?.path[0] ?? "body")),
        meta,
      );
    }
    const file = form.get("receipt");
    let photo: { bytes: Uint8Array; contentType: string } | null = null;
    if (file instanceof File && file.size > 0) {
      const checked = ReceiptPhotoSchema.safeParse({ type: file.type, size: file.size });
      if (!checked.success) {
        return jsonError(
          invalid(checked.error.issues[0]?.message ?? "Invalid photo.", "receipt"),
          meta,
        );
      }
      photo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: checked.data.type };
    }
    return respond(
      await getContainer().pabili.recordPurchase(
        await getSessionUser(),
        ids.value.orderId,
        fields.data,
        photo,
      ),
      meta,
    );
  });
}

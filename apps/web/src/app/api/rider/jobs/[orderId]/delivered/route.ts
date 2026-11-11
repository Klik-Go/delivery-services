import { ValidationError } from "@klikgo/core";
import { DeliveryPhotoSchema, DeliveryProofSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseIds, respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

const invalid = (message: string, path: string): ValidationError =>
  new ValidationError(message, [{ path, message }]);

/**
 * POST /api/rider/jobs/:orderId/delivered — multipart form with the customer's `pin` (orders
 * above the threshold) and/or a `photo` of the order at the door. Settles the order.
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
      return jsonError(invalid("Send the delivery proof as a form.", "body"), meta);
    }
    const pinField = form.get("pin");
    const fields = DeliveryProofSchema.safeParse({
      ...(typeof pinField === "string" && pinField.trim() !== "" ? { pin: pinField } : {}),
    });
    if (!fields.success) {
      return jsonError(invalid(fields.error.issues[0]?.message ?? "Invalid PIN.", "pin"), meta);
    }
    const file = form.get("photo");
    let photo: { bytes: Uint8Array; contentType: string } | undefined;
    if (file instanceof File && file.size > 0) {
      const checked = DeliveryPhotoSchema.safeParse({ type: file.type, size: file.size });
      if (!checked.success) {
        return jsonError(
          invalid(checked.error.issues[0]?.message ?? "Invalid photo.", "photo"),
          meta,
        );
      }
      photo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: checked.data.type };
    }
    return respond(
      await getContainer().riders.delivered(await getSessionUser(), ids.value.orderId, {
        pin: fields.data.pin,
        photo,
      }),
      meta,
    );
  });
}

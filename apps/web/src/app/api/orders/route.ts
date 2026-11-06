import { ValidationError } from "@klikgo/core";
import { IdempotencyKeySchema, PlaceOrderSchema } from "@klikgo/types";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { getServerEnv } from "@/server/env";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders — places the order. The `Idempotency-Key` header (one per checkout attempt)
 * makes retries and double taps return the same order instead of a second one.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const user = await requireUser();
    if (!user.ok) return jsonError(user.error, meta);
    const key = IdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) {
      return jsonError(
        new ValidationError("Send an Idempotency-Key header (16–100 letters, digits, - or _).", [
          { path: "Idempotency-Key", message: "Missing or invalid" },
        ]),
        meta,
      );
    }
    const body = await parseBody(request, PlaceOrderSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const origin = getServerEnv().NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const placed = await getContainer().orders.placeOrder(body.value, {
      idempotencyKey: key.data,
      actor: user.value,
      urls: {
        success: (id) => new URL(`/orders/${id}?paid=1`, origin).toString(),
        cancel: (id) => new URL(`/orders/${id}?cancelled=1`, origin).toString(),
      },
    });
    return respond(placed, meta, 201);
  });
}

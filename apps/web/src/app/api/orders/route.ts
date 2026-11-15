import { ValidationError } from "@klikgo/core";
import { IdempotencyKeySchema, OrderHistoryQuerySchema, PlaceOrderSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { getServerEnv } from "@/server/env";
import { jsonError } from "@/server/http/api-response";
import { deviceIdOf } from "@/server/http/device-id";
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
      deviceId: deviceIdOf(request),
      urls: {
        success: (id) => new URL(`/orders/${id}?paid=1`, origin).toString(),
        cancel: (id) => new URL(`/orders/${id}?cancelled=1`, origin).toString(),
      },
    });
    return respond(placed, meta, 201);
  });
}

/** GET /api/orders?before=ISO — the customer's orders, newest first, 20 at a time. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const query = OrderHistoryQuerySchema.safeParse({
      before: new URL(request.url).searchParams.get("before") ?? undefined,
    });
    if (!query.success) {
      return jsonError(
        new ValidationError("Invalid page.", [{ path: "before", message: "Not a time" }]),
        meta,
      );
    }
    const before = query.data.before ? new Date(query.data.before) : null;
    return respond(await getContainer().orderHistory.list(await getSessionUser(), before), meta);
  });
}

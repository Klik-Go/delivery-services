import { ValidationError } from "@klikgo/core";
import { IdempotencyKeySchema, PlacePabiliSchema } from "@klikgo/types";
import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/pabili/orders — places a Pabili order (cash on delivery). The `Idempotency-Key` header
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
    const body = await parseBody(request, PlacePabiliSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pabili.place(body.value, {
        idempotencyKey: key.data,
        actor: user.value,
      }),
      meta,
      201,
    );
  });
}

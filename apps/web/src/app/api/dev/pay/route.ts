import { NotFoundError } from "@klikgo/core";
import { z } from "zod";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

const PaySchema = z.object({ session: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/) });

/**
 * POST /api/dev/pay — "Pay" on the local fake checkout (PAYMENT_GATEWAY=fake only; 404 otherwise).
 * Sends the signed paid webhook through the real webhook handling.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const fake = getContainer().fakeCheckout;
    if (!fake) return jsonError(new NotFoundError("Route", "/api/dev/pay"), meta);
    const body = await parseBody(request, PaySchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(await fake.pay(body.value.session), meta);
  });
}

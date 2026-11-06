import { CheckoutQuoteSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/checkout/quote — the checkout total with promo and tip, payment methods and slots. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, CheckoutQuoteSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().orders.quoteCheckout(body.value, await getSessionUser()),
      meta,
    );
  });
}

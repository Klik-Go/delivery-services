import { PabiliQuoteSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/pabili/quote — the delivery and Pabili fees for a shopping list. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, PabiliQuoteSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(await getContainer().pabili.quote(body.value, await getSessionUser()), meta);
  });
}

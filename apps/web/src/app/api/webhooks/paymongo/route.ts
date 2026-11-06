import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** Webhook bodies are small JSON events; anything bigger is not PayMongo. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/paymongo — PayMongo events. The raw body is verified (HMAC signature and
 * timestamp) before anything is parsed, and each event id is applied once, so retries and replays
 * never credit twice. 2xx tells PayMongo to stop retrying; 401 for bad signatures.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }
    const outcome = await getContainer().paymentWebhooks.receive(
      rawBody,
      request.headers.get("paymongo-signature"),
    );
    if (!outcome.ok) return jsonError(outcome.error, meta, getContainer().logger);
    return jsonOk({ outcome: outcome.value }, meta);
  });
}

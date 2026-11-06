import { getContainer } from "@/server/container";
import { jsonOk } from "@/server/http/api-response";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/push/key — the VAPID public key for browsers, or null while Web Push is off. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, (meta) =>
    Promise.resolve(jsonOk({ publicKey: getContainer().pushSubscriptions.publicKey }, meta)),
  );
}

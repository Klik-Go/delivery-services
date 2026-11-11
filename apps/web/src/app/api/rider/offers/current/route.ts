import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/rider/offers/current — the open offer for this rider, or null. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().riders.currentOffer(await getSessionUser()), meta),
  );
}

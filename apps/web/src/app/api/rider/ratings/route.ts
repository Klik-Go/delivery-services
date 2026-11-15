import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/rider/ratings — the rider's deliveries of the last 7 days, to rate the customers. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().ratings.riderDeliveries(await getSessionUser()), meta),
  );
}

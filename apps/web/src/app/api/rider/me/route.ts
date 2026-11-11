import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/rider/me — the rider, online or not, their cash on hand and current job id. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().riders.status(await getSessionUser()), meta),
  );
}

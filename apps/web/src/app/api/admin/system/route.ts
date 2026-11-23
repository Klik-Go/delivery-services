import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/system — background job lag, failing webhooks and missed deadlines (admins). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().systemStatus.status(await getSessionUser()), meta),
  );
}

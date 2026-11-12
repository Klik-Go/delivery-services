import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/stores — stores with status and commission (coordinators: their zone's). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().merchantAdmin.list(await getSessionUser()), meta),
  );
}

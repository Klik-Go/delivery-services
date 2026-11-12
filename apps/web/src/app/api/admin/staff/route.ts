import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/staff — staff roles (admins). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().staffAdmin.list(await getSessionUser()), meta),
  );
}

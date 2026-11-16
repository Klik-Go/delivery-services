import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";
import { weekParam } from "../week";

export const dynamic = "force-dynamic";

/** GET /api/admin/finance/payouts?week=YYYY-MM-DD — the week's payouts (admins). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const week = weekParam(request);
    if (!week.ok) return jsonError(week.error, meta);
    return respond(await getContainer().payouts.week(await getSessionUser(), week.week), meta);
  });
}

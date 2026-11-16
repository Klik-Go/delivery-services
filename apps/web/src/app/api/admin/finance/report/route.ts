import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";
import { weekParam } from "../week";

export const dynamic = "force-dynamic";

/** GET /api/admin/finance/report?week= — GMV, take rate, contribution, refunds, promos, COD share by zone. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const week = weekParam(request);
    if (!week.ok) return jsonError(week.error, meta);
    return respond(await getContainer().reports.week(await getSessionUser(), week.week), meta);
  });
}

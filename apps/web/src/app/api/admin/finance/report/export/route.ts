import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { csvResponse } from "@/server/http/csv-response";
import { runRoute } from "@/server/http/route";
import { weekParam } from "../../week";

export const dynamic = "force-dynamic";

/** GET /api/admin/finance/report/export?week= — the week's report by zone, as CSV. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const week = weekParam(request);
    if (!week.ok) return jsonError(week.error, meta);
    return csvResponse(
      await getContainer().reports.weekCsv(await getSessionUser(), week.week),
      meta,
    );
  });
}

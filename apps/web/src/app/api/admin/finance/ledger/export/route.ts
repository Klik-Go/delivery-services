import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { csvResponse } from "@/server/http/csv-response";
import { runRoute } from "@/server/http/route";
import { weekParam } from "../../week";

export const dynamic = "force-dynamic";

/** GET /api/admin/finance/ledger/export?week= — the week's ledger with the chart of accounts (audited), as CSV. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const week = weekParam(request);
    if (!week.ok) return jsonError(week.error, meta);
    return csvResponse(
      await getContainer().reports.ledgerCsv(await getSessionUser(), week.week),
      meta,
    );
  });
}

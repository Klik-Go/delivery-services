import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { csvResponse } from "@/server/http/csv-response";
import { parseIds, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/rider/payouts/:payoutId/export — the statement as CSV. */
export async function GET(
  request: Request,
  context: { params: Promise<{ payoutId: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    return csvResponse(
      await getContainer().payouts.statementCsv(
        await getSessionUser(),
        { kind: "rider" },
        ids.value.payoutId,
      ),
      meta,
    );
  });
}

import { WeekStartSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/finance/settle — settle a finished week now (once per week; audited). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, WeekStartSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().settlement.settleWeek(await getSessionUser(), body.value.week),
      meta,
      201,
    );
  });
}

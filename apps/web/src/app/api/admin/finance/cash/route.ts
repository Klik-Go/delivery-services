import { CashHandInSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/finance/cash — riders holding cash in the person's zones. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().remittances.holders(await getSessionUser()), meta),
  );
}

/** POST /api/admin/finance/cash — cash a rider handed in (coordinator or admin; audited). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, CashHandInSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().remittances.record(await getSessionUser(), body.value),
      meta,
      201,
    );
  });
}

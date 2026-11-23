import { PabiliFloatSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** PUT /api/rider/pabili-float — the most cash the rider can spend up front (0 = no Pabili). */
export async function PUT(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, PabiliFloatSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pabili.setFloat(await getSessionUser(), body.value.floatCentavos),
      meta,
    );
  });
}

import { PromoCreateSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/promos — campaign codes with uses and pesos given away (admins). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().retentionAdmin.promos(await getSessionUser()), meta),
  );
}

/** POST /api/admin/promos — a new campaign code with its caps and eligibility (admins, audited). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, PromoCreateSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().retentionAdmin.createPromo(await getSessionUser(), body.value),
      meta,
      201,
    );
  });
}

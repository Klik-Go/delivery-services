import { RiderApplicationSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/rider/application — the signed-in person's application and document checklist, or null. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().riderOnboarding.status(await getSessionUser()), meta),
  );
}

/** POST /api/rider/application — apply to ride in a zone. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, RiderApplicationSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().riderOnboarding.apply(await getSessionUser(), body.value),
      meta,
      201,
    );
  });
}

import { ConsentAcceptSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/me/consents — the current terms and privacy versions and what this person agreed to. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().consents.status(await getSessionUser()), meta),
  );
}

/** POST /api/me/consents — agree to the versions shown ({ terms, privacy }). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, ConsentAcceptSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().consents.accept(await getSessionUser(), body.value),
      meta,
      201,
    );
  });
}

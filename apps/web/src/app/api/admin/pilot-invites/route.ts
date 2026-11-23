import { CreateInvitesSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/admin/pilot-invites — codes with their batch and use (admins). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().pilotInvites.summary(await getSessionUser()), meta),
  );
}

/** POST /api/admin/pilot-invites — a batch of codes ({ batch, count, expiresInDays? }). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, CreateInvitesSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pilotInvites.createBatch(await getSessionUser(), body.value),
      meta,
      201,
    );
  });
}

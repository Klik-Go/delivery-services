import { InviteWaitlistSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/admin/pilot-invites/waitlist — text a code to the oldest people waiting ({ count }). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, InviteWaitlistSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pilotInvites.inviteWaitlist(await getSessionUser(), body.value),
      meta,
    );
  });
}

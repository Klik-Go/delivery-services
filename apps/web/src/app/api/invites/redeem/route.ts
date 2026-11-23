import { RedeemInviteSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/invites/redeem — use an invite code ({ code }) to order during the pilot. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, RedeemInviteSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pilotInvites.redeem(
        await getSessionUser(),
        body.value.code.replace(/[\s-]/g, ""),
      ),
      meta,
    );
  });
}

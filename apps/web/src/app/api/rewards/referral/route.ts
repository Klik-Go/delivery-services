import { ReferralCodeSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { deviceIdOf } from "@/server/http/device-id";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/rewards/referral — a new customer enters a friend's code (before the first order). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, ReferralCodeSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().rewards.enterReferralCode(
        await getSessionUser(),
        body.value.code,
        deviceIdOf(request),
      ),
      meta,
      201,
    );
  });
}

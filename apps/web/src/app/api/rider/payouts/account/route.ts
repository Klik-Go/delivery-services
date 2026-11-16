import { PayoutAccountSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** PUT /api/rider/payouts/account — where the rider is paid. */
export async function PUT(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, PayoutAccountSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().payouts.saveAccount(
        await getSessionUser(),
        { kind: "rider" },
        body.value,
      ),
      meta,
    );
  });
}

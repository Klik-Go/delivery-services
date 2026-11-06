import { PushSubscriptionSchema, PushUnsubscribeSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/push/subscriptions — turn on alerts on this device for the signed-in person. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, PushSubscriptionSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pushSubscriptions.subscribe(
        await getSessionUser(),
        body.value,
        request.headers.get("user-agent"),
      ),
      meta,
      201,
    );
  });
}

/** DELETE /api/push/subscriptions — turn alerts off on this device. */
export async function DELETE(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, PushUnsubscribeSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().pushSubscriptions.unsubscribe(
        await getSessionUser(),
        body.value.endpoint,
      ),
      meta,
    );
  });
}

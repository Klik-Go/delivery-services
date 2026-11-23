import { AnalyticsEventSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { deviceIdOf } from "@/server/http/device-id";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/events — one ordering-funnel step (ids only). The app's random install id
 * (X-Device-Id) stands in before sign-in; Do Not Track and Global Privacy Control are honoured.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, AnalyticsEventSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const user = await getSessionUser();
    const optedOut = request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1";
    return respond(
      await getContainer().analytics.track(body.value, {
        userId: user?.id ?? null,
        anonymousId: deviceIdOf(request),
        optedOut,
      }),
      meta,
      202,
    );
  });
}

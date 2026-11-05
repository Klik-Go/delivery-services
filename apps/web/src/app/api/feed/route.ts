import { ValidationError } from "@klikgo/core";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { pointFrom } from "@/server/http/point-query";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/feed?lat=&lng= — the home feed in one round trip (zone data cached 60 s). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const point = await pointFrom(new URL(request.url));
    if (point instanceof ValidationError) return jsonError(point, meta);
    const user = await getSessionUser();
    return jsonOk(await getContainer().feed.feed(point, user?.id ?? null), meta);
  });
}

import { RiderLocationSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/rider/location — one GPS fix while online (the server keeps one per 4 seconds). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, RiderLocationSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const { lat, lng, heading, speedKph, accuracyM } = body.value;
    return respond(
      await getContainer().riders.updateLocation(await getSessionUser(), {
        lat,
        lng,
        ...(heading === undefined ? {} : { heading }),
        ...(speedKph === undefined ? {} : { speedKph }),
        ...(accuracyM === undefined ? {} : { accuracyM }),
      }),
      meta,
    );
  });
}

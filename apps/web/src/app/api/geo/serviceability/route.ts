import { ServiceabilitySchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { runRoute } from "@/server/http/route";

const NOT_IN_AREA = "We're not in your area yet — join the waitlist";

/** POST /api/geo/serviceability — which zone (if any) delivers to this pin. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, ServiceabilitySchema);
    if (!body.ok) return jsonError(body.error, meta);
    const zone = await getContainer().serviceability.check(body.value.location);
    return jsonOk({ zone, message: zone ? null : NOT_IN_AREA }, meta);
  });
}

import { ValidationError } from "@klikgo/core";
import { AutocompleteQuerySchema, LatLngSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { clientIp } from "@/server/http/client-ip";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/geo/autocomplete?q=&session=&lat=&lng= — address suggestions (server-side key). */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const params = new URL(request.url).searchParams;
    const query = AutocompleteQuerySchema.safeParse({
      q: params.get("q"),
      session: params.get("session"),
    });
    if (!query.success) return jsonError(new ValidationError("Type at least 2 letters."), meta);
    const near = LatLngSchema.safeParse({
      lat: Number(params.get("lat")),
      lng: Number(params.get("lng")),
    });
    return respond(
      await getContainer().places.suggest(
        query.data.q,
        query.data.session,
        params.has("lat") && near.success ? near.data : null,
        { clientIp: clientIp(request.headers) },
      ),
      meta,
    );
  });
}

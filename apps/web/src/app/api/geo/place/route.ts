import { ValidationError } from "@klikgo/core";
import { PlaceQuerySchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { clientIp } from "@/server/http/client-ip";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/geo/place?id=&session= — the pin of a chosen suggestion. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const params = new URL(request.url).searchParams;
    const query = PlaceQuerySchema.safeParse({
      id: params.get("id"),
      session: params.get("session"),
    });
    if (!query.success) return jsonError(new ValidationError("Choose a suggestion."), meta);
    return respond(
      await getContainer().places.place(query.data.id, query.data.session, {
        clientIp: clientIp(request.headers),
      }),
      meta,
    );
  });
}

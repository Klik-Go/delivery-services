import { ValidationError } from "@klikgo/core";
import { SearchQuerySchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { pointFrom } from "@/server/http/point-query";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/search?q=&category=&openNow=&sort= — stores and dishes near the delivery pin. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const url = new URL(request.url);
    const query = SearchQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!query.success)
      return jsonError(new ValidationError("Type what you are looking for."), meta);
    const point = await pointFrom(url);
    if (point instanceof ValidationError) return jsonError(point, meta);
    return jsonOk(await getContainer().search.search(point, query.data), meta);
  });
}

import { ValidationError } from "@klikgo/core";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/stores/:slug — a live store and its menu (public, read-only). */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const { slug } = await context.params;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80)
      return jsonError(new ValidationError("Invalid store link."), meta);
    return respond(await getContainer().storefront.store(slug), meta);
  });
}

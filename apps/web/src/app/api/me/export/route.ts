import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/me/export — a JSON file of everything Klik Go holds about the signed-in person. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const container = getContainer();
    const file = await container.account.exportData(await getSessionUser());
    if (!file.ok) return jsonError(file.error, meta, container.logger);
    return new Response(file.value.body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${file.value.filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": meta.requestId,
      },
    });
  });
}

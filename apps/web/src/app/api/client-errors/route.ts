import { ClientErrorSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { clientIp } from "@/server/http/client-ip";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** POST /api/client-errors — a crash in the browser, forwarded to the error tracker scrubbed. */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, ClientErrorSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const user = await getSessionUser();
    return respond(
      await getContainer().errors.reportBrowser(body.value, {
        requestId: meta.requestId,
        userId: user?.id ?? null,
        clientIp: clientIp(request.headers),
      }),
      meta,
      202,
    );
  });
}

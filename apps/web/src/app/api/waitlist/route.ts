import { WaitlistSchema } from "@klikgo/types";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { clientIp } from "@/server/http/client-ip";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

/** POST /api/waitlist — "bring Klik Go to my area" (public, rate-limited per network). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, WaitlistSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().serviceability.joinWaitlist(body.value, {
        clientIp: clientIp(request.headers),
      }),
      meta,
      201,
    );
  });
}

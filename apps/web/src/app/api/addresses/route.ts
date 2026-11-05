import { AddressInputSchema } from "@klikgo/types";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** GET /api/addresses — the signed-in customer's saved addresses. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) =>
    respond(await getContainer().addresses.list(await getSessionUser()), meta),
  );
}

/** POST /api/addresses — save an address (pin + landmark + contact number). */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const body = await parseBody(request, AddressInputSchema);
    if (!body.ok) return jsonError(body.error, meta);
    return respond(
      await getContainer().addresses.save(await getSessionUser(), body.value),
      meta,
      201,
    );
  });
}

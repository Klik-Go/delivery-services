import { AccountDeleteSchema } from "@klikgo/types";
import { cookies } from "next/headers";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { parseBody } from "@/server/http/parse-body";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/me/delete — erase the signed-in person's account ({ confirm: "DELETE" }). On success
 * the session cookies are cleared; the sign-in itself no longer exists.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const container = getContainer();
    const body = await parseBody(request, AccountDeleteSchema);
    if (!body.ok) return jsonError(body.error, meta);
    const result = await container.account.deleteAccount(await getSessionUser(), body.value);
    if (!result.ok) return jsonError(result.error, meta, container.logger);
    const jar = await cookies();
    for (const cookie of jar.getAll()) if (cookie.name.startsWith("sb-")) jar.delete(cookie.name);
    return jsonOk(result.value, meta);
  });
}

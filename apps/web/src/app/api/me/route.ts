import { requireUser } from "@/server/auth/guards";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { metaFor } from "@/server/http/route-context";

export const dynamic = "force-dynamic";

/** GET /api/me — who is signed in (roles from the database) and the session's assurance level. */
export async function GET(request: Request): Promise<Response> {
  const meta = metaFor(request);
  try {
    const user = await requireUser();
    if (!user.ok) return jsonError(user.error, meta);
    const { id, phone, email, roles, aal } = user.value;
    return jsonOk(
      { userId: id, phone, email, roles, aal, home: getContainer().authz.landingPath(user.value) },
      meta,
    );
  } catch (error) {
    return jsonError(error, meta, getContainer().logger);
  }
}

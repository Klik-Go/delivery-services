import "server-only";
import type { SessionUser } from "@klikgo/core";
import type { ApiMeta } from "@klikgo/types";
import { requireAction } from "../auth/guards";
import { jsonError } from "./api-response";
import { parseIds, runRoute } from "./route";

/**
 * Shared shape of /api/merchant/:merchantId/** handlers: validates the ids in the path, checks the
 * caller may act for that store (merchant.manage, or merchant.settings for owner-only changes) and
 * hands over to the handler. Services check the same action again (defence in depth).
 */
export async function merchantRoute<P extends { merchantId: string }>(
  request: Request,
  context: { params: Promise<P> },
  action: "merchant.manage" | "merchant.settings",
  handler: (args: { user: SessionUser; ids: P; meta: ApiMeta }) => Promise<Response>,
): Promise<Response> {
  return runRoute(request, async (meta) => {
    const ids = parseIds(await context.params);
    if (!ids.ok) return jsonError(ids.error, meta);
    const user = await requireAction({ type: action, merchantId: ids.value.merchantId });
    if (!user.ok) return jsonError(user.error, meta);
    return handler({ user: user.value, ids: ids.value, meta });
  });
}

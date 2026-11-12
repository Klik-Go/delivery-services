import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { z } from "zod";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";
import { ValidationError } from "@klikgo/core";

export const dynamic = "force-dynamic";

const ZoneQuery = z.uuid().optional();

/** GET /api/admin/board?zoneId= — live orders in the person's zones, with SLA timers. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const raw = new URL(request.url).searchParams.get("zoneId") ?? undefined;
    const zoneId = ZoneQuery.safeParse(raw === "" ? undefined : raw);
    if (!zoneId.success) return jsonError(new ValidationError("Invalid zone."), meta);
    return respond(
      await getContainer().adminOrders.board(await getSessionUser(), { zoneId: zoneId.data }),
      meta,
    );
  });
}

import { ValidationError } from "@klikgo/core";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

const Status = z.enum(["open", "resolved"]).default("open");

/** GET /api/admin/tickets?status=open|resolved — low-rating tickets in the person's zones. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const status = Status.safeParse(new URL(request.url).searchParams.get("status") ?? undefined);
    if (!status.success) return jsonError(new ValidationError("Unknown list."), meta);
    return respond(
      await getContainer().retentionAdmin.tickets(await getSessionUser(), status.data),
      meta,
    );
  });
}

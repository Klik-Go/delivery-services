import { getSessionUser } from "@/server/auth/session";
import { getContainer } from "@/server/container";
import { ValidationError } from "@klikgo/core";
import { z } from "zod";
import { jsonError } from "@/server/http/api-response";
import { respond, runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

const Filter = z.enum(["pending", "active", "suspended", "coaching"]).default("pending");

/** GET /api/admin/riders?filter=pending|active|suspended|coaching — riders in the person's zones. */
export async function GET(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const filter = Filter.safeParse(new URL(request.url).searchParams.get("filter") ?? undefined);
    if (!filter.success) return jsonError(new ValidationError("Unknown list."), meta);
    return respond(await getContainer().riderAdmin.list(await getSessionUser(), filter.data), meta);
  });
}

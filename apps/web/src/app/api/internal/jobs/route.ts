import { timingSafeEqual } from "node:crypto";
import { NotFoundError, UnauthorizedError } from "@klikgo/core";
import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { runRoute } from "@/server/http/route";

export const dynamic = "force-dynamic";

/** Constant-time comparison of the bearer token with CRON_SECRET. */
function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "", "utf8");
  const expected = Buffer.from(secret, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/internal/jobs — called every 30 seconds by the database scheduler (pg_cron + pg_net)
 * with `Authorization: Bearer <CRON_SECRET>`: sends queued messages and finishes refunds.
 */
export async function POST(request: Request): Promise<Response> {
  return runRoute(request, async (meta) => {
    const { cronSecret, jobs } = getContainer();
    if (!cronSecret) return jsonError(new NotFoundError("Route", "/api/internal/jobs"), meta);
    if (!authorized(request.headers.get("authorization"), cronSecret)) {
      return jsonError(new UnauthorizedError("Invalid scheduler secret."), meta);
    }
    return jsonOk(await jobs.run(), meta);
  });
}

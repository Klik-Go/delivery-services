import { getContainer } from "@/server/container";
import { jsonOk } from "@/server/http/api-response";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/server/http/request-id";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/ready — readiness: is the database reachable and on this build's migrations?
 * 200 when ready, 503 when not, with the reason (`database`: unreachable | outdated). Public, no
 * input; it reveals only migration version numbers, never connection details.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const report = await getContainer().readiness.check();
  return jsonOk(report, { requestId }, report.status === "ready" ? 200 : 503);
}

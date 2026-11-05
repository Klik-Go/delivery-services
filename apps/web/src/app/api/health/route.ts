import { getContainer } from "@/server/container";
import { jsonError, jsonOk } from "@/server/http/api-response";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/server/http/request-id";

export const dynamic = "force-dynamic";

/** GET /api/health — liveness for uptime monitors and deploy checks. Public, no input. */
export function GET(request: Request): Response {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const { healthService, logger } = getContainer();
  const result = healthService.check();
  if (!result.ok) return jsonError(result.error, { requestId }, logger);
  const { status, version, checkedAt } = result.value;
  logger.debug("health check", { requestId, route: "/api/health" });
  return jsonOk({ status }, { requestId, version, checkedAt });
}

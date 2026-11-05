import "server-only";
import type { ApiMeta } from "@klikgo/types";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

/** Response meta for a request (the request id set by the proxy). */
export function metaFor(request: Request): ApiMeta {
  return { requestId: resolveRequestId(request.headers.get(REQUEST_ID_HEADER)) };
}

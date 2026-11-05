import {
  isAppError,
  RateLimitedError,
  ValidationError,
  type AppErrorCode,
  type Logger,
} from "@klikgo/core";
import type { ApiError, ApiMeta } from "@klikgo/types";
import { REQUEST_ID_HEADER } from "./request-id";

const HTTP_STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

function envelope(
  body: { data: unknown; error: ApiError | null; meta: ApiMeta },
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      [REQUEST_ID_HEADER]: body.meta.requestId,
      ...extraHeaders,
    },
  });
}

/** Success response in the `{ data, error: null, meta }` envelope. */
export function jsonOk(data: unknown, meta: ApiMeta, status = 200): Response {
  return envelope({ data, error: null, meta }, status);
}

/**
 * Failure response in the `{ data: null, error, meta }` envelope. Domain errors keep their message;
 * anything unexpected becomes a generic 500 so internals (SQL, stack traces, secrets) never leak.
 */
export function jsonError(error: unknown, meta: ApiMeta, logger?: Logger): Response {
  if (isAppError(error)) {
    const body: ApiError = { code: error.code, message: error.message };
    if (error instanceof ValidationError) body.issues = [...error.issues];
    const headers: Record<string, string> =
      error instanceof RateLimitedError ? { "retry-after": String(error.retryAfterSeconds) } : {};
    return envelope({ data: null, error: body, meta }, HTTP_STATUS_BY_CODE[error.code], headers);
  }
  logger?.error("unhandled error", { err: error, requestId: meta.requestId });
  return envelope(
    { data: null, error: { code: "INTERNAL", message: GENERIC_ERROR_MESSAGE }, meta },
    500,
  );
}

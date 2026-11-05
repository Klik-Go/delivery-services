import "server-only";
import { ValidationError, type AppError, type Result } from "@klikgo/core";
import type { ApiMeta } from "@klikgo/types";
import { z } from "zod";
import { getContainer } from "../container";
import { jsonError, jsonOk } from "./api-response";
import { metaFor } from "./route-context";

/**
 * Runs a route handler with the request's meta and turns anything unexpected into the generic 500
 * envelope (logged with the request id), so handlers only contain the happy path.
 */
export async function runRoute(
  request: Request,
  handler: (meta: ApiMeta) => Promise<Response>,
): Promise<Response> {
  const meta = metaFor(request);
  try {
    return await handler(meta);
  } catch (error) {
    return jsonError(error, meta, getContainer().logger);
  }
}

/** The `{ data }` envelope for a successful Result, or the mapped error. */
export function respond<T>(result: Result<T, AppError>, meta: ApiMeta, status = 200): Response {
  return result.ok
    ? jsonOk(result.value ?? null, meta, status)
    : jsonError(result.error, meta, getContainer().logger);
}

const IdSchema = z.uuid();

/** Validates route-segment ids (uuids) before they reach a service. */
export function parseIds<P extends Record<string, string>>(params: P): Result<P, ValidationError> {
  for (const [name, value] of Object.entries<string>(params)) {
    if (!IdSchema.safeParse(value).success)
      return {
        ok: false,
        error: new ValidationError(`Invalid ${name}.`, [{ path: name, message: "Not an id" }]),
      };
  }
  return { ok: true, value: params };
}

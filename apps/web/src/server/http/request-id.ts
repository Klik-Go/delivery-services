/** Header that carries the request id between proxy, middleware, route handlers and logs. */
export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Reuses a well-formed incoming id (so a request can be traced across hops) or makes a new UUID.
 * Anything else is replaced, because ids are written to logs and must not allow log injection.
 */
export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

import { AsyncLocalStorage } from "node:async_hooks";

/** What every log line of one request should carry. */
export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `work` with the request id available to every log line written during it, including from
 * services deep in packages/core that never see the request (they log through the Logger port).
 */
export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

/** The current request's id, if any. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

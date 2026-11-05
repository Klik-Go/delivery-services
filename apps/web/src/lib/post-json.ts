/** Outcome of a BFF call from the browser: the `data` payload or the error message to show. */
export type PostResult<T> =
  { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

/** Calls a BFF route with an optional JSON (or FormData) body and unwraps `{ data, error }`. */
export async function requestJson<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  fallbackMessage: string,
): Promise<PostResult<T>> {
  try {
    const isForm = body instanceof FormData;
    const response = await fetch(path, {
      method,
      ...(body === undefined
        ? {}
        : isForm
          ? { body }
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const envelope = (await response.json().catch(() => ({}))) as {
      data?: T;
      error?: { code?: string; message?: string } | null;
    };
    if (response.ok && envelope.data !== undefined) return { ok: true, data: envelope.data };
    return {
      ok: false,
      status: response.status,
      code: envelope.error?.code ?? "INTERNAL",
      message: envelope.error?.message ?? fallbackMessage,
    };
  } catch {
    return { ok: false, status: 0, code: "NETWORK", message: fallbackMessage };
  }
}

/** POSTs JSON to a BFF route and unwraps the `{ data, error }` envelope. */
export function postJson<T>(
  path: string,
  body: unknown,
  fallbackMessage: string,
): Promise<PostResult<T>> {
  return requestJson<T>("POST", path, body, fallbackMessage);
}

/** Throws the error message (for TanStack Query), or returns the data. */
export async function fetchData<T>(path: string, fallbackMessage: string): Promise<T> {
  const result = await requestJson<T>("GET", path, undefined, fallbackMessage);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

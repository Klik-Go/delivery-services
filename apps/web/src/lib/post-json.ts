/** Outcome of a BFF call from the browser: the `data` payload or the error message to show. */
export type PostResult<T> =
  { ok: true; data: T } | { ok: false; status: number; code: string; message: string };

/** POSTs JSON to a BFF route and unwraps the `{ data, error }` envelope. */
export async function postJson<T>(
  path: string,
  body: unknown,
  fallbackMessage: string,
): Promise<PostResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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

/**
 * Explicit success/failure value. Services return `Result` instead of throwing for expected
 * business failures (docs/BUSINESS.md §10.4.2 "Error handling"), so callers must handle both.
 */
export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Wraps a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wraps an expected failure. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Narrows a result to its success branch. */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

/** Narrows a result to its failure branch. */
export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/** Returns the value or throws the error; use only at boundaries where a failure is a bug. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  if (result.error instanceof Error) throw result.error;
  throw new Error("Unwrapped a failed Result", { cause: result.error });
}

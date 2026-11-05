import { err, ok, ValidationError, type Result } from "@klikgo/core";
import type { z } from "zod";

/** Reads a JSON body and validates it with a zod schema from packages/types. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Result<z.infer<S>, ValidationError>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err(new ValidationError("The request body must be JSON."));
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.join(".") || "body",
    message: issue.message,
  }));
  return err(new ValidationError(issues[0]?.message ?? "Invalid request.", issues));
}

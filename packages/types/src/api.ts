import { z } from "zod";

/** A single field problem in a validation error. */
export const ValidationIssueSchema = z.object({ path: z.string(), message: z.string() });

/** The `error` half of every BFF response. */
export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  issues: z.array(ValidationIssueSchema).optional(),
});

/** Metadata on every response; `requestId` matches the x-request-id header and the server logs. */
export const ApiMetaSchema = z.looseObject({ requestId: z.string().min(1) });

/**
 * Builds the `{ data, error, meta }` envelope schema for a payload (docs/BUSINESS.md §10.4.3 "API design").
 * Exactly one of `data` / `error` is non-null.
 */
// The return type is zod's inferred union; spelling it out would duplicate the schema below.
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function apiEnvelope<T extends z.ZodType>(data: T) {
  return z.union([
    z.object({ data, error: z.null(), meta: ApiMetaSchema }),
    z.object({ data: z.null(), error: ApiErrorSchema, meta: ApiMetaSchema }),
  ]);
}

/** Payload of GET /api/health. */
export const HealthDataSchema = z.object({ status: z.literal("ok") });

/** Full GET /api/health response. */
export const HealthResponseSchema = apiEnvelope(HealthDataSchema);

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiMeta = z.infer<typeof ApiMetaSchema>;
export type HealthData = z.infer<typeof HealthDataSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

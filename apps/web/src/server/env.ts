import { z } from "zod";

// Empty strings (e.g. an untouched copy of .env.example) count as "not set".
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url().optional());

const ServerEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["debug", "info", "warn", "error"]).default("info"),
    ),
    APP_VERSION: optionalString,
    VERCEL_GIT_COMMIT_SHA: optionalString,
    VERCEL_ENV: optionalString,
    NEXT_PUBLIC_APP_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    // Publishable (anon) key: safe in the browser, still only used server-side by the BFF.
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    // Server-only secrets below. Never prefix with NEXT_PUBLIC_.
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    SEND_SMS_HOOK_SECRET: optionalString,
    SEMAPHORE_API_KEY: optionalString,
    SEMAPHORE_SENDER_NAME: optionalString,
    // Pre-launch only: a shared 6-digit code that signs customers in while SMS is off
    // (ignored once SEMAPHORE_API_KEY is set). docs/OPEN_QUESTIONS.md Q20.
    PLACEHOLDER_OTP_CODE: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^\d{6}$/, "must be 6 digits")
        .optional(),
    ),
    // AI menu import (Phase 3). Only menu photos are ever sent to Gemini, never customer data.
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^[a-z0-9.-]+$/)
        .default("gemini-flash-latest"),
    ),
    // Address autocomplete (Phase 4): Google Places API (New), server-side key only.
    GOOGLE_MAPS_API_KEY: optionalString,
    // Payments (Phase 5): PayMongo hosted checkout. Secret key (sk_test_… / sk_live_…) and the
    // webhook endpoint's signing secret (whsk_…), both server only.
    PAYMONGO_SECRET_KEY: optionalString,
    PAYMONGO_WEBHOOK_SECRET: optionalString,
    // "fake" pays through the local /dev/pay page instead of PayMongo (local dev, Cucumber,
    // Playwright only; ignored on Vercel production).
    PAYMENT_GATEWAY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["paymongo", "fake"]).optional(),
    ),
    // "fake" uses the deterministic test menu reader (local dev, Cucumber, Playwright only).
    MENU_PARSER: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["gemini", "fake"]).optional(),
    ),
  })
  .transform((env) => ({
    ...env,
    APP_VERSION: env.APP_VERSION ?? env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  }));

/** Validated server configuration. Secrets added in later phases are read here, never in components. */
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/**
 * Validates environment variables. Error messages list variable names only, never values,
 * because values may be secrets and errors end up in logs.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new Error(`Invalid server environment variables: ${names}. See .env.example.`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

/** Returns the validated process environment (parsed once per process). */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

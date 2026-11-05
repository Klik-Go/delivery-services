import { randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type Client = ReturnType<typeof createClient>;
import { Secret, TOTP } from "otpauth";

/** Local Supabase test OTP numbers (supabase/config.toml [auth.sms.test_otp]); code is always 123456. */
export const TEST_OTP_CODE = "123456";
export const TEST_PHONES = {
  customerSignUp: "+639170000101",
  customerWrongCode: "+639170000102",
  customer: "+639170000103",
  customerSession: "+639170000104",
  rider: "+639170000110",
} as const;

/** True when the scenario can reach Supabase Auth with admin rights (local stack or CI). */
export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Service-role client for test setup only (creating staff accounts). Never used by the app's browser code. */
export function adminClient(): Client {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see README) for @auth scenarios.",
    );
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Anonymous client, used to prove a revoked refresh token no longer works. */
export function anonClient(): Client {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A fresh random email and a strong random password for a test staff account. */
export function newStaffCredentials(label: string): { email: string; password: string } {
  return {
    email: `${label}-${randomBytes(4).toString("hex")}@example.test`,
    password: `Pw-${randomBytes(12).toString("base64url")}`,
  };
}

/** A random Philippine mobile number outside the test OTP range. */
export function randomMobile(): string {
  return `+63918${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

/** A random documentation-range IP (RFC 5737) so each scenario counts as its own network. */
export function randomIp(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

/** Current 6-digit TOTP code for a base32 secret (what an authenticator app would show). */
export function totpCode(secret: string): string {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate();
}

import assert from "node:assert/strict";
import type { ApiClient } from "./api-client";
import { TEST_OTP_CODE } from "./supabase-test-auth";

/** Phone OTP sign-in through the BFF (API), leaving the session cookies on `client`. */
export async function signInWithPhone(client: ApiClient, phone: string): Promise<string> {
  let requested = await client.post("/api/auth/otp", { phone });
  // Supabase Auth allows one code per number per second; scenarios reuse test numbers back to back.
  for (let attempt = 0; requested.status === 429 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    requested = await client.post("/api/auth/otp", { phone });
  }
  assert.equal(requested.status, 200, requested.bodyText);
  const verified = await client.post("/api/auth/otp/verify", { phone, code: TEST_OTP_CODE });
  assert.equal(verified.status, 200, verified.bodyText);
  const me = await client.request("GET", "/api/me");
  const userId = (me.json as { data?: { userId?: unknown } } | undefined)?.data?.userId;
  assert.ok(typeof userId === "string" && userId, "Signed in but /api/me returned no user");
  return userId;
}

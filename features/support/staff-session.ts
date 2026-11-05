import assert from "node:assert/strict";
import { ApiClient } from "./api-client";
import { adminClient, newStaffCredentials, randomIp, totpCode } from "./supabase-test-auth";
import { BASE_URL, type KlikWorld } from "./world";

/**
 * Creates a staff account with `role` (scoped to `merchantId` for merchant roles) and signs it in
 * through the BFF with password + TOTP (AAL2). Test setup only: the service role creates the user.
 */
export async function signedInStaff(
  world: KlikWorld,
  role: "admin" | "merchant_owner" | "merchant_staff" | "coordinator",
  scope: { merchantId?: string; zoneId?: string } = {},
  client: ApiClient = new ApiClient(BASE_URL),
): Promise<{ client: ApiClient; userId: string }> {
  if (!client.headers.has("x-forwarded-for")) client.headers.set("x-forwarded-for", randomIp());
  const credentials = newStaffCredentials(role);
  const { data, error } = await adminClient().auth.admin.createUser({
    ...credentials,
    email_confirm: true,
  });
  assert.ok(data.user, error?.message ?? "Could not create the staff account");
  await world.db.query(
    `insert into public.user_roles (user_id, role, merchant_id, zone_id) values ($1, $2, $3, $4)`,
    [data.user.id, role, scope.merchantId ?? null, scope.zoneId ?? null],
  );
  const signIn = await client.post("/api/auth/password", credentials);
  assert.equal(signIn.status, 200, signIn.bodyText);
  const enrol = await client.post("/api/auth/mfa/enroll", {});
  assert.equal(enrol.status, 200, enrol.bodyText);
  const factor = (enrol.json as { data: { factorId: string; secret: string } }).data;
  const verify = await client.post("/api/auth/mfa/verify", {
    factorId: factor.factorId,
    code: totpCode(factor.secret),
  });
  assert.equal(verify.status, 200, verify.bodyText);
  return { client, userId: data.user.id };
}

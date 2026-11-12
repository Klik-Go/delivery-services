import { randomBytes, randomInt } from "node:crypto";
import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Secret, TOTP } from "otpauth";
import pg from "pg";

/** Supabase test OTP numbers reserved for Playwright (Cucumber uses 101–104 and 110). */
export const E2E_PHONES = {
  "mobile-pixel-7": {
    customer: "+639170000105",
    rider: "+639170000107",
    tracker: "+639170000111",
    applicant: "+639170000113",
  },
  "desktop-chrome": {
    customer: "+639170000106",
    rider: "+639170000108",
    tracker: "+639170000112",
    applicant: "+639170000114",
  },
} as const;
export const TEST_OTP_CODE = "123456";

/** True when the e2e run can reach Supabase Auth and the database. */
export function authStackConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.DATABASE_URL,
  );
}

/** Runs one SQL statement on the local test database (setup only). */
export async function sql(text: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end();
  }
}

/**
 * Clears rate-limit counters for the reserved test numbers and localhost (every browser sign-in in
 * the run comes from the same local address), so parallel specs and reruns are not blocked.
 */
export async function resetTestNumberLimits(): Promise<void> {
  await sql(
    `delete from private.rate_limit_counters where key like 'otp:phone:+6391700001%' or key like 'otp-verify:phone:+6391700001%' or key = 'otp:ip:unknown'
       or key ~ '^(otp|partner-apply|waitlist):ip:(unknown|::1|::ffff:127\\.0\\.0\\.1|127\\.0\\.0\\.1)$'`,
  );
}

/** Current TOTP code for a base32 secret. */
export function totpCode(secret: string): string {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate();
}

/** A BFF client with its own cookie jar and network address. */
export async function apiSession(baseURL: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${randomInt(1, 255)}` },
  });
}

/** Creates an admin (random email/password, never committed) and signs in with password + TOTP. */
export async function signedInAdmin(baseURL: string): Promise<APIRequestContext> {
  const email = `e2e-admin-${randomBytes(4).toString("hex")}@example.test`;
  const password = `Pw-${randomBytes(12).toString("base64url")}`;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!data.user) throw new Error(error?.message ?? "Could not create the e2e admin");
  await sql(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [data.user.id]);

  const api = await apiSession(baseURL);
  await expectOk(api.post("/api/auth/password", { data: { email, password } }));
  const enrolment = (await (
    await expectOk(api.post("/api/auth/mfa/enroll", { data: {} }))
  ).json()) as {
    data: { factorId: string; secret: string };
  };
  await expectOk(
    api.post("/api/auth/mfa/verify", {
      data: { factorId: enrolment.data.factorId, code: totpCode(enrolment.data.secret) },
    }),
  );
  return api;
}

/** Signs a phone user in through the BFF and returns the user id. */
export async function signInWithPhone(api: APIRequestContext, phone: string): Promise<string> {
  let response = await api.post("/api/auth/otp", { data: { phone } });
  for (let attempt = 0; response.status() === 429 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    response = await api.post("/api/auth/otp", { data: { phone } });
  }
  await expectOk(Promise.resolve(response));
  await expectOk(api.post("/api/auth/otp/verify", { data: { phone, code: TEST_OTP_CODE } }));
  const me = (await (await api.get("/api/me")).json()) as { data: { userId: string } };
  return me.data.userId;
}

async function expectOk<T extends { ok(): boolean; status(): number; text(): Promise<string> }>(
  pending: Promise<T>,
): Promise<T> {
  const response = await pending;
  if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
  return response;
}

/** Creates a merchant staff account for `merchantId` and signs it in (password + TOTP). */
export async function signedInMerchant(
  baseURL: string,
  merchantId: string,
  role: "merchant_owner" | "merchant_staff" = "merchant_owner",
): Promise<APIRequestContext> {
  return signedInStaff(baseURL, role, { merchantId });
}

/** Creates a staff account with a role (and its store or zone) and signs it in (password + TOTP). */
export async function signedInStaff(
  baseURL: string,
  role: "merchant_owner" | "merchant_staff" | "coordinator" | "admin",
  scope: { merchantId?: string; zoneId?: string } = {},
): Promise<APIRequestContext> {
  const email = `e2e-${role}-${randomBytes(4).toString("hex")}@example.test`;
  const password = `Pw-${randomBytes(12).toString("base64url")}`;
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!data.user) throw new Error(error?.message ?? "Could not create the e2e merchant user");
  await sql(
    `insert into public.user_roles (user_id, role, merchant_id, zone_id) values ($1, $2, $3, $4)`,
    [data.user.id, role, scope.merchantId ?? null, scope.zoneId ?? null],
  );
  const api = await apiSession(baseURL);
  await expectOk(api.post("/api/auth/password", { data: { email, password } }));
  const enrolment = (await (
    await expectOk(api.post("/api/auth/mfa/enroll", { data: {} }))
  ).json()) as { data: { factorId: string; secret: string } };
  await expectOk(
    api.post("/api/auth/mfa/verify", {
      data: { factorId: enrolment.data.factorId, code: totpCode(enrolment.data.secret) },
    }),
  );
  return api;
}

/** Id of a seeded store by name. */
export async function merchantIdByName(name: string): Promise<string> {
  const rows = await sql(`select id from public.merchants where name = $1`, [name]);
  const id = (rows.rows[0] as { id: string } | undefined)?.id;
  if (!id) throw new Error(`No merchant named ${name} (run pnpm db:reset)`);
  return id;
}

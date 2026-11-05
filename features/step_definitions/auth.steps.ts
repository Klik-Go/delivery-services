import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { ApiClient } from "../support/api-client";
import {
  adminClient,
  anonClient,
  newStaffCredentials,
  randomIp,
  randomMobile,
  TEST_OTP_CODE,
  TEST_PHONES,
  totpCode,
} from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

interface Envelope {
  data?: Record<string, unknown> | null;
  error?: { code?: string; message?: string } | null;
}
const body = (json: unknown): Envelope => (typeof json === "object" && json !== null ? json : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Phone OTP sign-in through the BFF (API), leaving the session cookies on `client`. */
async function signInWithPhone(client: ApiClient, phone: string): Promise<string> {
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
  const userId = text(body(me.json).data?.userId);
  assert.ok(userId, "Signed in but /api/me returned no user");
  return userId;
}

/** Grants a role directly in the database (test setup; the app never lets clients do this). */
async function grantRole(
  world: KlikWorld,
  userId: string,
  role: string,
  merchantId: string | null = null,
): Promise<void> {
  await world.db.query(
    `insert into public.user_roles (user_id, role, merchant_id) values ($1, $2, $3) on conflict on constraint user_roles_unique do nothing`,
    [userId, role, merchantId],
  );
}

async function merchantIdByName(world: KlikWorld, name: string): Promise<string> {
  const rows = await world.db.query<{ id: string }>(
    `select id from public.merchants where name = $1`,
    [name],
  );
  assert.ok(rows[0], `No merchant named ${name} (run pnpm db:reset)`);
  return rows[0].id;
}

/** Creates a confirmed email+password staff account with a role (test setup via the service role). */
async function createStaff(world: KlikWorld, role: string, merchantId: string | null = null) {
  const credentials = newStaffCredentials(role);
  const { data, error } = await adminClient().auth.admin.createUser({
    ...credentials,
    email_confirm: true,
  });
  assert.ok(data.user, error?.message ?? "Could not create the staff account");
  await grantRole(world, data.user.id, role, merchantId);
  return { ...credentials, userId: data.user.id };
}

// ---------- customer phone sign-in (browser) ----------

Given("a customer with the test phone number {string}", function (this: KlikWorld, phone: string) {
  this.auth.phone = phone;
});

When(
  "they sign in with their phone and the code {string}",
  async function (this: KlikWorld, code: string) {
    const page = await this.page();
    await page.goto("/auth/sign-in");
    await page.getByLabel("Mobile number").fill(this.auth.phone ?? "");
    await page.getByRole("button", { name: "Send code" }).click();
    await page.waitForURL(/\/auth\/verify/);
    await page.getByLabel("Digit 1").fill(code);
    await page.getByRole("button", { name: "Verify" }).click();
  },
);

Then("they land on Home signed in as {string}", async function (this: KlikWorld, phone: string) {
  const page = await this.page();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByText(`Signed in as ${phone}`)).toBeVisible();
});

Then("they are told the code is wrong", async function (this: KlikWorld) {
  const page = await this.page();
  // (Next.js also renders an empty role="alert" route announcer, so match the text.)
  await expect(page.getByText("That code is wrong or has expired.")).toBeVisible();
});

Then("they are not signed in", async function (this: KlikWorld) {
  const page = await this.page();
  const me = await page.request.get("/api/me");
  assert.equal(me.status(), 401);
});

When("someone asks for a code for {string}", async function (this: KlikWorld, phone: string) {
  this.lastResponse = await this.api.post("/api/auth/otp", { phone });
});

Then("the request is refused with code {string}", function (this: KlikWorld, code: string) {
  assert.equal(body(this.response().json).error?.code, code, this.response().bodyText);
});

// ---------- rate limits ----------

Given("a phone number that has not asked for a code yet", function (this: KlikWorld) {
  this.auth.phone = randomMobile();
  this.api.headers.set("x-forwarded-for", randomIp());
});

Given("a network that has not asked for codes yet", function (this: KlikWorld) {
  this.api.headers.set("x-forwarded-for", randomIp());
});

When("it asks for a code {int} times", async function (this: KlikWorld, times: number) {
  this.responses = [];
  for (let i = 0; i < times; i += 1) {
    // Supabase Auth allows one code per number per second locally (max_frequency); wait it out.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
    this.responses.push(await this.api.post("/api/auth/otp", { phone: this.auth.phone }));
  }
});

When("it asks for a code once more", async function (this: KlikWorld) {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  this.lastResponse = await this.api.post("/api/auth/otp", { phone: this.auth.phone });
});

When(
  "{int} different phone numbers on that network ask for a code",
  async function (this: KlikWorld, count: number) {
    this.responses = [];
    for (let i = 0; i < count; i += 1)
      this.responses.push(await this.api.post("/api/auth/otp", { phone: randomMobile() }));
  },
);

When("one more phone number on that network asks for a code", async function (this: KlikWorld) {
  this.lastResponse = await this.api.post("/api/auth/otp", { phone: randomMobile() });
});

Then("every request is accepted", function (this: KlikWorld) {
  for (const response of this.responses) assert.equal(response.status, 200, response.bodyText);
});

// ---------- staff invitations and MFA ----------

Given("an admin signed in with their authenticator app", async function (this: KlikWorld) {
  const admin = await createStaff(this, "admin");
  const signIn = await this.api.post("/api/auth/password", {
    email: admin.email,
    password: admin.password,
  });
  assert.equal(signIn.status, 200, signIn.bodyText);
  const enrol = await this.api.post("/api/auth/mfa/enroll", {});
  assert.equal(enrol.status, 200, enrol.bodyText);
  const factor = body(enrol.json).data as { factorId: string; secret: string };
  const verify = await this.api.post("/api/auth/mfa/verify", {
    factorId: factor.factorId,
    code: totpCode(factor.secret),
  });
  assert.equal(verify.status, 200, verify.bodyText);
  assert.equal(body(verify.json).data?.next, "/admin");
});

Given(
  "the admin has invited a new owner for {string}",
  async function (this: KlikWorld, merchant: string) {
    const merchantId = await merchantIdByName(this, merchant);
    const invite = await this.api.post("/api/admin/invites", {
      email: newStaffCredentials("owner").email,
      role: "merchant_owner",
      merchantId,
    });
    assert.equal(invite.status, 201, invite.bodyText);
    this.auth.invitePath = text(body(invite.json).data?.invitePath);
  },
);

When("the new owner opens the invite link", async function (this: KlikWorld) {
  const page = await this.page();
  await page.goto(this.auth.invitePath ?? "");
  await page.waitForURL(/\/auth\/set-password/);
});

When("chooses a strong password", async function (this: KlikWorld) {
  const page = await this.page();
  const { password } = newStaffCredentials("owner");
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password").fill(password);
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL(/\/auth\/mfa/);
});

When("enrols an authenticator app", async function (this: KlikWorld) {
  const page = await this.page();
  await page.getByRole("button", { name: "Set up authenticator app" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.replace(/\s/g, "") ?? "";
  assert.ok(secret, "No TOTP setup key shown");
  await page.getByLabel("Digit 1").fill(totpCode(secret));
  await page.getByRole("button", { name: "Verify" }).click();
});

Then("they land on the merchant dashboard", async function (this: KlikWorld) {
  const page = await this.page();
  await page.waitForURL((url) => url.pathname === "/merchant");
  await expect(page.getByRole("heading", { level: 1, name: "Merchant dashboard" })).toBeVisible();
});

Given("a customer signed in with a phone code", async function (this: KlikWorld) {
  this.auth.userId = await signInWithPhone(this.api, TEST_PHONES.customer);
});

When("they try to invite a merchant owner", async function (this: KlikWorld) {
  this.lastResponse = await this.api.post("/api/admin/invites", {
    email: newStaffCredentials("owner").email,
    role: "merchant_owner",
    merchantId: await merchantIdByName(this, "Aling Nena's Karinderya"),
  });
});

Given("a merchant owner who signed in with only their password", async function (this: KlikWorld) {
  const owner = await createStaff(
    this,
    "merchant_owner",
    await merchantIdByName(this, "Silog Express"),
  );
  const signIn = await this.api.post("/api/auth/password", {
    email: owner.email,
    password: owner.password,
  });
  assert.equal(signIn.status, 200, signIn.bodyText);
});

// ---------- surfaces ----------

Given("a rider signed in with a phone code", async function (this: KlikWorld) {
  const userId = await signInWithPhone(this.api, TEST_PHONES.rider);
  await grantRole(this, userId, "rider");
});

When("they open {string}", async function (this: KlikWorld, path: string) {
  this.lastResponse = await this.api.request("GET", path);
});

When(
  "a visitor who is not signed in opens {string}",
  async function (this: KlikWorld, path: string) {
    this.lastResponse = await new ApiClient(BASE_URL).request("GET", path);
  },
);

Then("they are refused with status {int}", function (this: KlikWorld, status: number) {
  assert.equal(this.response().status, status);
});

Then("the page opens", function (this: KlikWorld) {
  assert.equal(this.response().status, 200);
});

Then("they are sent to {string}", function (this: KlikWorld, path: string) {
  const response = this.response();
  assert.ok(
    [303, 307, 308].includes(response.status),
    `Expected a redirect, got ${response.status}`,
  );
  const location = new URL(response.headers.get("location") ?? "", BASE_URL);
  assert.equal(location.pathname, path);
});

// ---------- sessions ----------

function authCookie(client: ApiClient): { name: string; value: string } {
  const entry = [...client.cookies].find(([name]) => /^sb-.+-auth-token$/.test(name));
  assert.ok(entry, `No Supabase auth cookie (have: ${[...client.cookies.keys()].join(", ")})`);
  return { name: entry[0], value: entry[1] };
}

function readSession(value: string): Record<string, unknown> {
  const raw = decodeURIComponent(value);
  const json = raw.startsWith("base64-")
    ? Buffer.from(raw.slice(7), "base64url").toString("utf8")
    : raw;
  return JSON.parse(json) as Record<string, unknown>;
}

Given("their access token has expired", function (this: KlikWorld) {
  const cookie = authCookie(this.api);
  const session = readSession(cookie.value);
  this.auth.accessToken = String(session.access_token);
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  this.api.cookies.set(
    cookie.name,
    `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  );
});

When("they check who is signed in", async function (this: KlikWorld) {
  this.lastResponse = await this.api.request("GET", "/api/me");
});

Then("they are still signed in", function (this: KlikWorld) {
  assert.equal(this.response().status, 200, this.response().bodyText);
  assert.ok(body(this.response().json).data?.userId);
});

Then("they received a new access token", function (this: KlikWorld) {
  const session = readSession(authCookie(this.api).value);
  assert.notEqual(session.access_token, this.auth.accessToken);
  assert.ok(Number(session.expires_at) > Date.now() / 1000);
});

When("they log out", async function (this: KlikWorld) {
  this.auth.oldSession = this.api.clone();
  this.auth.refreshToken = String(readSession(authCookie(this.api).value).refresh_token);
  const out = await this.api.post("/api/auth/sign-out", {});
  assert.equal(out.status, 200, out.bodyText);
});

Then("their old session no longer works", async function (this: KlikWorld) {
  const old = this.auth.oldSession;
  assert.ok(old);
  const me = await old.request("GET", "/api/me");
  assert.equal(me.status, 401, me.bodyText);
});

Then("their old refresh token is rejected", async function (this: KlikWorld) {
  const { error } = await anonClient().auth.refreshSession({
    refresh_token: this.auth.refreshToken ?? "",
  });
  assert.ok(error, "The old refresh token still worked after logout");
});

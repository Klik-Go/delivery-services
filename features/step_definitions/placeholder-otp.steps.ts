import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { adminClient } from "../support/supabase-test-auth";
import type { KlikWorld } from "../support/world";

/**
 * The server only has a placeholder code when PLACEHOLDER_OTP_CODE is set for the run (CI sets a
 * test-only value, never the production one). Without it these scenarios are skipped.
 */
const CODE = process.env.PLACEHOLDER_OTP_CODE;

Before({ tags: "@placeholder-otp" }, async function (this: KlikWorld) {
  if (!CODE) return "skipped";
  // The seeded rider's number is reused on every run: start it with a fresh code budget.
  await this.db.query(
    `delete from private.rate_limit_counters
     where key in ('otp:phone:+639170000021', 'otp-verify:phone:+639170000021')`,
  );
  return undefined;
});

After({ tags: "@placeholder-otp" }, async function (this: KlikWorld) {
  const phone = this.auth.phone;
  if (!phone?.startsWith("0895")) return;
  const e164 = `+63${phone.replace(/\s/g, "").slice(1)}`;
  const rows = await this.db.query<{ id: string }>(
    "select id from public.profiles where phone = $1",
    [e164],
  );
  for (const { id } of rows) await adminClient().auth.admin.deleteUser(id);
});

async function signInWithTestCode(world: KlikWorld): Promise<void> {
  const page = await world.page();
  await page.goto("/auth/sign-in");
  await expect(page.getByText(/Text messages aren't switched on yet/)).toBeVisible();
  await page.getByLabel("Mobile number").fill(world.auth.phone ?? "");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForURL(/\/auth\/verify/);
  await expect(page.getByText(/Enter the test code from the Klik Go team/)).toBeVisible();
  await page.getByLabel("Digit 1").fill(CODE ?? "");
  await page.getByRole("button", { name: "Verify" }).click();
}

async function currentUserId(world: KlikWorld): Promise<string | undefined> {
  const page = await world.page();
  const me = await page.request.get("/api/me");
  if (me.status() !== 200) return undefined;
  return ((await me.json()) as { data: { userId: string } }).data.userId;
}

Given("a new customer with a DITO mobile number", function (this: KlikWorld) {
  this.auth.phone = `0895 ${String(randomInt(100, 1000))} ${String(randomInt(1000, 10_000))}`;
});

Given("the rider number {string}", function (this: KlikWorld, phone: string) {
  this.auth.phone = phone;
});

Given("they have signed in with the test code before", async function (this: KlikWorld) {
  await signInWithTestCode(this);
  const page = await this.page();
  await page.waitForURL((url) => url.pathname === "/");
  const userId = await currentUserId(this);
  assert.ok(userId, "first sign-in did not create a session");
  this.auth.userId = userId;
  await page.context().clearCookies();
});

When("they sign in with their phone and the test code", async function (this: KlikWorld) {
  await signInWithTestCode(this);
});

Then("they land on Home signed in with that number", async function (this: KlikWorld) {
  const page = await this.page();
  await page.waitForURL((url) => url.pathname === "/");
  const e164 = `+63${(this.auth.phone ?? "").replace(/\s/g, "").slice(1)}`;
  await expect(page.getByText(`Signed in as ${e164}`)).toBeVisible();
});

Then("they are signed in to the same account as before", async function (this: KlikWorld) {
  const page = await this.page();
  await page.waitForURL((url) => url.pathname === "/");
  assert.equal(await currentUserId(this), this.auth.userId);
});

Then("they are told to use the code that was texted to them", async function (this: KlikWorld) {
  const page = await this.page();
  await expect(
    page.getByText("This number can't use the test code.", { exact: false }),
  ).toBeVisible();
});

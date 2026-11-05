import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Given, Then, When } from "@cucumber/cucumber";
import { newStaffCredentials } from "../support/supabase-test-auth";
import type { KlikWorld } from "../support/world";

const run = promisify(execFile);

Given("an ADMIN_EMAIL that has no Klik Go account yet", function (this: KlikWorld) {
  this.auth.adminEmail = newStaffCredentials("bootstrap-admin").email;
});

async function bootstrap(world: KlikWorld): Promise<void> {
  const { stdout } = await run("node", ["--import", "tsx", "scripts/bootstrap-admin.ts"], {
    env: { ...process.env, ADMIN_EMAIL: world.auth.adminEmail ?? "" },
  });
  world.auth.scriptOutput = stdout;
}

When("the owner runs the bootstrap-admin script", async function (this: KlikWorld) {
  await bootstrap(this);
});

When("the owner runs the bootstrap-admin script again", async function (this: KlikWorld) {
  await bootstrap(this);
});

async function adminRoleCount(world: KlikWorld): Promise<number> {
  const rows = await world.db.query<{ count: number }>(
    `select count(*)::int as count from public.user_roles r join auth.users u on u.id = r.user_id
     where lower(u.email) = $1 and r.role = 'admin'`,
    [world.auth.adminEmail],
  );
  return rows[0]?.count ?? 0;
}

Then("that account is an admin", async function (this: KlikWorld) {
  assert.equal(await adminRoleCount(this), 1);
});

Then("that account still has exactly one admin role", async function (this: KlikWorld) {
  assert.equal(await adminRoleCount(this), 1);
});

Then("the script prints a one-time {string} link", function (this: KlikWorld, type: string) {
  const output = this.auth.scriptOutput ?? "";
  assert.match(
    output,
    new RegExp(`/auth/confirm\\?token_hash=[^&\\s]+&type=${type}&next=%2Fauth%2Fset-password`),
  );
});

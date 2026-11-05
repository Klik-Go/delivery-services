import assert from "node:assert/strict";
import { Given, Then } from "@cucumber/cucumber";
import type { KlikWorld } from "../support/world";

Given("the database has been migrated", async function (this: KlikWorld) {
  const rows = await this.db.query<{ version: string }>(
    "select version from supabase_migrations.schema_migrations order by version",
  );
  assert.ok(rows.length > 0, "No Supabase migrations have been applied. Run `pnpm db:reset`.");
});

Then("the {string} extension is enabled", async function (this: KlikWorld, extension: string) {
  const rows = await this.db.query<{ extname: string }>(
    "select extname from pg_extension where extname = $1",
    [extension],
  );
  assert.equal(rows.length, 1, `${extension} is not installed`);
});

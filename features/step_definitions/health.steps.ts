import assert from "node:assert/strict";
import { Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { LATEST_MIGRATION } from "@klikgo/db";
import type { KlikWorld } from "../support/world";

When("I open the home page", async function (this: KlikWorld) {
  const page = await this.page();
  const response = await page.goto("/");
  assert.equal(response?.status(), 200);
});

Then("I see the Klik Go brand", async function (this: KlikWorld) {
  const page = await this.page();
  await expect(page.getByRole("heading", { level: 1, name: "Klik Go" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Klik Go logo" })).toBeVisible();
  await expect(page).toHaveTitle(/Klik Go/);
});

Then("I see the tagline {string}", async function (this: KlikWorld, tagline: string) {
  const page = await this.page();
  await expect(page.getByText(tagline)).toBeVisible();
});

When("monitoring calls GET {string}", async function (this: KlikWorld, path: string) {
  this.lastResponse = await this.api.request("GET", path);
});

Then("the response status is {int}", function (this: KlikWorld, status: number) {
  assert.equal(this.response().status, status);
});

Then("the response body has data.status {string}", function (this: KlikWorld, expected: string) {
  const body = this.response().json as { data?: { status?: unknown }; error?: unknown };
  assert.deepEqual(body.data, { status: expected });
  assert.equal(body.error, null);
});

Then("the response carries a request id", function (this: KlikWorld) {
  const response = this.response();
  const header = response.headers.get("x-request-id");
  assert.match(header ?? "", /^[0-9a-f-]{36}$/);
  const body = response.json as { meta?: { requestId?: unknown } };
  assert.equal(body.meta?.requestId, header);
});

Then(
  "the database is reported {string} with this build's migrations applied",
  function (this: KlikWorld, expected: string) {
    const body = this.response().json as {
      data?: {
        status?: string;
        database?: string;
        schemaVersion?: string;
        expectedSchemaVersion?: string;
      };
    };
    assert.equal(body.data?.status, "ready");
    assert.equal(body.data?.database, expected);
    assert.equal(body.data?.schemaVersion, LATEST_MIGRATION);
    assert.equal(body.data?.expectedSchemaVersion, LATEST_MIGRATION);
  },
);

import assert from "node:assert/strict";
import { Then, When, type DataTable } from "@cucumber/cucumber";
import type { KlikWorld } from "../support/world";

const NONCE_PATTERN = /'nonce-([A-Za-z0-9+/=]+)'/;

function cspOf(world: KlikWorld): string {
  const csp = world.response().headers.get("content-security-policy");
  assert.ok(csp, "Content-Security-Policy header is missing");
  return csp;
}

When("I request {string}", async function (this: KlikWorld, path: string) {
  this.lastResponse = await this.api.request("GET", path);
  assert.equal(this.lastResponse.status, 200);
});

When("I request {string} twice", async function (this: KlikWorld, path: string) {
  this.responses = [await this.api.request("GET", path), await this.api.request("GET", path)];
});

Then(
  "the response has a Content-Security-Policy with a per-request nonce",
  function (this: KlikWorld) {
    const csp = cspOf(this);
    assert.match(csp, NONCE_PATTERN);
    assert.match(csp, /script-src [^;]*'strict-dynamic'/);
    assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);
    assert.match(csp, /object-src 'none'/);
  },
);

Then("the Content-Security-Policy forbids framing the app", function (this: KlikWorld) {
  assert.match(cspOf(this), /frame-ancestors 'none'/);
});

Then("the response has these headers:", function (this: KlikWorld, table: DataTable) {
  for (const { header, value } of table.hashes() as { header: string; value: string }[]) {
    assert.equal(this.response().headers.get(header), value, `${header} header`);
  }
});

Then("the response does not reveal the server framework", function (this: KlikWorld) {
  assert.equal(this.response().headers.get("x-powered-by"), null);
});

Then("the two Content-Security-Policy nonces are different", function (this: KlikWorld) {
  const nonces = this.responses.map(
    (r) => r.headers.get("content-security-policy")?.match(NONCE_PATTERN)?.[1],
  );
  assert.equal(nonces.length, 2);
  assert.ok(nonces[0] && nonces[1], "both responses need a nonce");
  assert.notEqual(nonces[0], nonces[1]);
});

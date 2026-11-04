import assert from "node:assert/strict";
import { Given } from "@cucumber/cucumber";
import { BASE_URL, type KlikWorld } from "../support/world";

Given("the platform is running", async function (this: KlikWorld) {
  assert.ok(
    await this.api.isUp(),
    `Klik Go is not answering at ${BASE_URL}. Start it with \`pnpm build && pnpm --filter @klikgo/web start\` or use \`pnpm test:bdd\`.`,
  );
});

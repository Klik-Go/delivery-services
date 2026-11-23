import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { After, Given, Then, When } from "@cucumber/cucumber";
import type { ApiResponse } from "../support/api-client";
import { signedInStaff } from "../support/staff-session";
import type { KlikWorld, RiderSession } from "../support/world";

/** A sari-sari store near Kape't Tinapay (same zone as Ayala Avenue). */
const SHOP = { lat: 14.5588, lng: 121.0205 };
const AYALA = { lat: 14.5547, lng: 121.0244 };
const SEEDED_RIDERS = [
  "5eed0000-0000-4000-8000-000000000201",
  "5eed0000-0000-4000-8000-000000000202",
];

/** A tiny valid JPEG (1×1), enough for the bucket's type check. */
const PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const LIST = [
  { description: "Eggs (medium)", quantity: 12 },
  { description: "Pandesal", quantity: 10, note: "Fresh if possible" },
];

/** "₱1,500.00" → 150000 centavos. */
function centavos(peso: string): number {
  const digits = peso.replace(/[₱,\s]/g, "");
  const [whole = "0", cents = "00"] = digits.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2, "0").slice(0, 2));
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function message(response: ApiResponse | undefined): string {
  return (response?.json as { error?: { message?: string } } | undefined)?.error?.message ?? "";
}

function orderId(world: KlikWorld): string {
  assert.ok(world.checkout.orderId, "No Pabili order in this scenario");
  return world.checkout.orderId;
}

function rider(world: KlikWorld, name: string): RiderSession {
  const session = world.dispatch.riders.get(name);
  assert.ok(session, `${name} is not signed in`);
  return session;
}

/** Sets the pabili flag through the admin API and puts it back after the scenario. */
async function setPabili(
  world: KlikWorld,
  enabled: boolean,
  rollout: Record<string, unknown>,
): Promise<void> {
  world.ops.admin ??= await signedInStaff(world, "admin");
  const client = world.ops.admin.client;
  const [before] = await world.db.query<{ enabled: boolean; rollout: Record<string, unknown> }>(
    "select enabled, rollout from public.feature_flags where key = 'pabili'",
  );
  const put = (on: boolean, settings: Record<string, unknown>) =>
    client.request("PUT", "/api/admin/settings/flags/pabili", {
      json: { enabled: on, rollout: settings },
    });
  const response = await put(enabled, rollout);
  assert.equal(response.status, 200, response.bodyText);
  world.hardening.cleanups.push(async () => {
    await put(before?.enabled ?? false, before?.rollout ?? {});
  });
}

After({ tags: "@pabili" }, async function (this: KlikWorld) {
  await this.db.query(
    `update public.riders set pabili_float_centavos = 0 where id = any($1::uuid[])`,
    [SEEDED_RIDERS],
  );
});

Given(
  "Pabili is switched on with a {word} item limit and a {word} fee",
  async function (this: KlikWorld, cap: string, fee: string) {
    await setPabili(this, true, {
      max_item_centavos: centavos(cap),
      service_fee_centavos: centavos(fee),
      max_items: 20,
      max_trip_m: 5000,
    });
  },
);

Given("Pabili is switched off", async function (this: KlikWorld) {
  await setPabili(this, false, {
    max_item_centavos: 150_000,
    service_fee_centavos: 4_900,
    max_items: 20,
    max_trip_m: 5000,
  });
});

Given(
  "{string} can spend up to {word} on Pabili items and {string} nothing",
  async function (this: KlikWorld, name: string, amount: string, other: string) {
    const set = await rider(this, name).client.request("PUT", "/api/rider/pabili-float", {
      json: { floatCentavos: centavos(amount) },
    });
    assert.equal(set.status, 200, set.bodyText);
    const none = await rider(this, other).client.request("PUT", "/api/rider/pabili-float", {
      json: { floatCentavos: 0 },
    });
    assert.equal(none.status, 200, none.bodyText);
  },
);

function listBody(store: string, limit: string): Record<string, unknown> {
  return {
    storeName: store,
    storeNotes: "Beside the chapel",
    pickup: SHOP,
    dropoff: AYALA,
    budgetCentavos: centavos(limit),
    items: LIST,
  };
}

When(
  "the customer asks for the price of a Pabili list from {string} with a {word} limit",
  async function (this: KlikWorld, store: string, limit: string) {
    this.lastResponse = await this.api.post("/api/pabili/quote", listBody(store, limit));
  },
);

Then(
  "the Pabili fees are {word} delivery and {word} Pabili fee",
  function (this: KlikWorld, delivery: string, fee: string) {
    assert.ok(this.lastResponse);
    const quote = data<{ deliveryFeeCentavos: number; serviceFeeCentavos: number }>(
      this.lastResponse,
    );
    assert.equal(quote.deliveryFeeCentavos, centavos(delivery));
    assert.equal(quote.serviceFeeCentavos, centavos(fee));
  },
);

Then("the most they will pay at the door is {word}", function (this: KlikWorld, amount: string) {
  assert.ok(this.lastResponse);
  assert.equal(
    data<{ maxToPayCentavos: number }>(this.lastResponse).maxToPayCentavos,
    centavos(amount),
  );
});

async function send(world: KlikWorld, store: string, limit: string): Promise<void> {
  const response = await world.api.request("POST", "/api/pabili/orders", {
    json: {
      ...listBody(store, limit),
      address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "+639170000031" },
    },
    headers: { "Idempotency-Key": `cucumber-pabili-${randomUUID()}` },
  });
  assert.equal(response.status, 201, response.bodyText);
  world.checkout.orderId = data<{ orderId: string }>(response).orderId;
}

When(
  /^the customer (?:sends|sent) a Pabili list from "([^"]+)" with a (\S+) limit$/,
  async function (this: KlikWorld, store: string, limit: string) {
    await send(this, store, limit);
  },
);

Then("the order is taken by Klik Go without any store", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ kind: string; merchant_id: string | null; status: string }>(
    "select kind::text, merchant_id, status::text from public.orders where id = $1",
    [orderId(this)],
  );
  assert.deepEqual(row, { kind: "pabili", merchant_id: null, status: "accepted" });
});

async function startShopping(world: KlikWorld, name: string): Promise<void> {
  world.lastResponse = await rider(world, name).client.post(
    `/api/rider/jobs/${orderId(world)}/shopping`,
    {},
  );
  assert.equal(world.lastResponse.status, 200, world.lastResponse.bodyText);
}

When(/^"([^"]+)" (?:starts|started) shopping$/, async function (this: KlikWorld, name: string) {
  await startShopping(this, name);
});

When(
  "{string} records a {word} receipt with a photo, {string} not available",
  async function (this: KlikWorld, name: string, amount: string, missing: string) {
    const form = new FormData();
    form.set("itemCostCentavos", String(centavos(amount)));
    form.set(
      "items",
      JSON.stringify(
        LIST.map((line, i) => ({
          position: i + 1,
          status: line.description === missing ? "unavailable" : "bought",
        })),
      ),
    );
    form.set("receipt", new Blob([PHOTO], { type: "image/jpeg" }), "receipt.jpg");
    this.lastResponse = await rider(this, name).client.request(
      "POST",
      `/api/rider/jobs/${orderId(this)}/bought`,
      { body: form },
    );
  },
);

interface PabiliView {
  status: string;
  itemCostCentavos: number | null;
  toPayCentavos: number | null;
  receiptUrl: string | null;
  lines: { description: string; status: string }[];
}

async function customerView(world: KlikWorld): Promise<PabiliView> {
  const response = await world.api.request("GET", `/api/pabili/orders/${orderId(world)}`);
  assert.equal(response.status, 200, response.bodyText);
  return data<PabiliView>(response);
}

Then(
  "the customer sees {word} for the items, {word} to pay at the door and a link to the receipt",
  async function (this: KlikWorld, items: string, toPay: string) {
    assert.equal(this.lastResponse?.status, 200, this.lastResponse?.bodyText);
    const view = await customerView(this);
    assert.equal(view.status, "ready");
    assert.equal(view.itemCostCentavos, centavos(items));
    assert.equal(view.toPayCentavos, centavos(toPay));
    assert.match(view.receiptUrl ?? "", /pabili-receipts/);
    assert.deepEqual(
      view.lines.map((l) => l.status),
      ["bought", "unavailable"],
    );
  },
);

Then(
  "the Pabili order is delivered after these steps: {}",
  async function (this: KlikWorld, steps: string) {
    assert.equal(this.lastResponse?.status, 200, this.lastResponse?.bodyText);
    const rows = await this.db.query<{ to_status: string }>(
      "select to_status::text from public.order_events where order_id = $1 order by id",
      [orderId(this)],
    );
    assert.deepEqual(
      rows.map((r) => r.to_status),
      steps.split(",").map((s) => s.trim()),
    );
  },
);

Then("the purchase is refused with {string}", function (this: KlikWorld, text: string) {
  assert.equal(this.lastResponse?.status, 400, this.lastResponse?.bodyText);
  assert.match(message(this.lastResponse), new RegExp(text));
});

Then("the customer's Pabili order is still being shopped", async function (this: KlikWorld) {
  assert.equal((await customerView(this)).status, "preparing");
});

When("the customer cancels the Pabili order", async function (this: KlikWorld) {
  this.lastResponse = await this.api.post(`/api/orders/${orderId(this)}/cancel`, {});
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then("the Pabili order is cancelled", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ status: string }>(
    "select status::text from public.orders where id = $1",
    [orderId(this)],
  );
  assert.equal(row?.status, "cancelled");
});

Then("the Pabili request is refused with {string}", function (this: KlikWorld, text: string) {
  assert.ok(this.lastResponse);
  assert.ok(this.lastResponse.status >= 400, this.lastResponse.bodyText);
  assert.match(message(this.lastResponse), new RegExp(text));
});

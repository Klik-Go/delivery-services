import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Before, Given, Then, When } from "@cucumber/cucumber";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signedInStaff } from "../support/staff-session";
import { BASE_URL, type KlikWorld } from "../support/world";

const CRON_SECRET = process.env.CRON_SECRET;
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;

/** The customer-facing words for each status (apps/web/messages/en.json). */
const EN = JSON.parse(
  readFileSync(new URL("../../apps/web/messages/en.json", import.meta.url), "utf8"),
) as { Customer: { order: { status: Record<string, string> } } };

// The SLA scenarios run the background jobs (CRON_SECRET) and sign a payment (webhook secret);
// CI generates both for the run.
Before({ tags: "@sla" }, function () {
  return CRON_SECRET && WEBHOOK_SECRET ? undefined : "skipped";
});

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function orderId(world: KlikWorld): string {
  assert.ok(world.checkout.orderId, "No order in this scenario");
  return world.checkout.orderId;
}

async function merchantIdByName(world: KlikWorld, name: string): Promise<string> {
  const [row] = await world.db.query<{ id: string }>(
    "select id from public.merchants where name = $1",
    [name],
  );
  assert.ok(row, `No store ${name}`);
  return row.id;
}

async function signInOwner(world: KlikWorld, store: string): Promise<void> {
  const merchantId = await merchantIdByName(world, store);
  world.checkout.ownerApi = (await signedInStaff(world, "merchant_owner", { merchantId })).client;
  world.checkout.ownerMerchantId = merchantId;
}

function owner(world: KlikWorld): ApiClient {
  assert.ok(world.checkout.ownerApi, "No store owner signed in");
  return world.checkout.ownerApi;
}

Given(
  /^the owner of "([^"]+)" is signed in(?: instead)?$/,
  async function (this: KlikWorld, store: string) {
    await signInOwner(this, store);
  },
);

async function accept(world: KlikWorld, minutes: number): Promise<ApiResponse> {
  world.lastResponse = await owner(world).post(`/api/orders/${orderId(world)}/accept`, {
    prepMinutes: minutes,
  });
  return world.lastResponse;
}

When(
  "the owner accepts the order with a prep time of {int} minutes",
  async function (this: KlikWorld, minutes: number) {
    await accept(this, minutes);
  },
);

Given(
  "the owner accepted the order with a prep time of {int} minutes",
  async function (this: KlikWorld, minutes: number) {
    const response = await accept(this, minutes);
    assert.equal(response.status, 200, response.bodyText);
  },
);

When("the owner marks the order ready", async function (this: KlikWorld) {
  this.lastResponse = await owner(this).post(`/api/orders/${orderId(this)}/ready`, {});
});

When(
  "the owner rejects the order because {string}",
  async function (this: KlikWorld, reason: string) {
    this.lastResponse = await owner(this).post(`/api/orders/${orderId(this)}/reject`, { reason });
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

When("the customer cancels the order", async function (this: KlikWorld) {
  this.lastResponse = await this.api.post(`/api/orders/${orderId(this)}/cancel`, {});
});

Then("the order history reads {string}", async function (this: KlikWorld, history: string) {
  const rows = await this.db.query<{ to_status: string }>(
    "select to_status::text from public.order_events where order_id = $1 order by id",
    [orderId(this)],
  );
  assert.equal(rows.map((r) => r.to_status).join(", "), history);
});

interface CustomerView {
  status: string;
  prepMinutes: number | null;
  readyBy: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
}

async function customerView(world: KlikWorld): Promise<CustomerView> {
  const response = await world.api.request("GET", `/api/orders/${orderId(world)}`);
  assert.equal(response.status, 200, response.bodyText);
  return data<CustomerView>(response);
}

Then(
  "the customer's order shows it is being prepared, ready in about {int} minutes",
  async function (this: KlikWorld, minutes: number) {
    const view = await customerView(this);
    assert.equal(view.status, "preparing");
    assert.equal(view.prepMinutes, minutes);
    assert.ok(view.readyBy, "No ready-by time");
    const inMinutes = (Date.parse(view.readyBy) - Date.now()) / 60_000;
    assert.ok(Math.abs(inMinutes - minutes) < 2, `ready in ${String(inMinutes)} minutes`);
  },
);

Then(
  "the customer's order shows {string} with the reason {string}",
  async function (this: KlikWorld, label: string, reason: string) {
    const view = await customerView(this);
    assert.equal(EN.Customer.order.status[view.status], label);
    assert.equal(view.rejectReason ?? view.cancelReason, reason);
  },
);

When("the owner opens the order board", async function (this: KlikWorld) {
  assert.ok(this.checkout.ownerMerchantId, "No store");
  this.lastResponse = await owner(this).request(
    "GET",
    `/api/merchant/${this.checkout.ownerMerchantId}/orders`,
  );
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

const COLUMNS: Record<string, string> = {
  New: "new",
  Preparing: "preparing",
  Ready: "ready",
  "Picked up": "pickedUp",
};

Then(
  "the board shows the order under {string} with {int} {string}",
  function (this: KlikWorld, column: string, quantity: number, item: string) {
    type Card = { id: string; confirmBy?: string; items: { name: string; quantity: number }[] };
    const board = data<Record<string, Card[]>>(this.response());
    const key = COLUMNS[column];
    assert.ok(key, `No column ${column}`);
    const card = board[key]?.find((o) => o.id === this.checkout.orderId);
    assert.ok(card, `Order not under ${column}: ${this.response().bodyText}`);
    assert.deepEqual(
      card.items.map((i) => [i.quantity, i.name]),
      [[quantity, item]],
    );
    if (key === "new") assert.ok(card.confirmBy, "No confirm-by time on a new order");
  },
);

// ---------- SLA ----------

Given(
  "the order has waited {int} seconds for the store",
  async function (this: KlikWorld, seconds: number) {
    await this.db.query(
      "update public.orders set placed_at = now() - make_interval(secs => $2) where id = $1",
      [orderId(this), seconds],
    );
  },
);

When("the platform checks the store deadlines", async function (this: KlikWorld) {
  await this.db.query("select private.escalate_merchant_sla()");
});

async function notificationsFor(world: KlikWorld, template: string) {
  return world.db.query<{ user_id: string; channel: string }>(
    "select user_id, channel::text from public.notifications where order_id = $1 and template = $2",
    [orderId(world), template],
  );
}

Then(
  "a text to {string} about the order is queued",
  async function (this: KlikWorld, store: string) {
    const [merchant] = await this.db.query<{ owner_id: string }>(
      "select owner_id from public.merchants where name = $1",
      [store],
    );
    const texts = await notificationsFor(this, "merchant_order_waiting");
    assert.deepEqual(texts, [{ user_id: merchant?.owner_id, channel: "sms" }]);
  },
);

Then("the order is flagged for the zone coordinator", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ sla_flagged_at: Date | null }>(
    "select sla_flagged_at from public.orders where id = $1",
    [orderId(this)],
  );
  assert.ok(row?.sla_flagged_at, "The order was not flagged");
});

Then(
  "the order is {string} because {string}",
  async function (this: KlikWorld, status: string, reason: string) {
    const [row] = await this.db.query<{ status: string; cancel_reason: string | null }>(
      "select status::text, cancel_reason from public.orders where id = $1",
      [orderId(this)],
    );
    assert.deepEqual(row, { status, cancel_reason: reason });
  },
);

Then("the customer is told the store did not confirm", async function (this: KlikWorld) {
  const told = await notificationsFor(this, "order_store_timeout");
  assert.ok(
    told.some((n) => n.user_id === this.checkout.customerId),
    "The customer was not told",
  );
  const view = await customerView(this);
  assert.equal(view.cancelReason, "merchant_timeout");
});

When("the platform runs its background jobs", async function (this: KlikWorld) {
  this.lastResponse = await new ApiClient(BASE_URL).request("POST", "/api/internal/jobs", {
    headers: { authorization: `Bearer ${CRON_SECRET ?? ""}` },
  });
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

When(
  "someone runs the background jobs without the scheduler's secret",
  async function (this: KlikWorld) {
    this.lastResponse = await new ApiClient(BASE_URL).request("POST", "/api/internal/jobs", {
      headers: { authorization: "Bearer not-the-secret-not-the-secret-123" },
    });
  },
);

Then("the jobs answer is {int}", function (this: KlikWorld, status: number) {
  assert.equal(this.response().status, status, this.response().bodyText);
});

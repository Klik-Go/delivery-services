import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Given, Then, When } from "@cucumber/cucumber";
import { LEGAL_VERSIONS } from "@klikgo/types";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { randomIp, randomMobile } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

/**
 * Production smoke test (features/smoke/production.feature). Configured by environment only:
 *  SMOKE_STORE_SLUG   the test store's slug (default: the seed's Kape't Tinapay)
 *  SMOKE_LAT/LNG      a pin inside the pilot zone (default: Ayala Avenue, Makati)
 *  SMOKE_CUSTOMER_PHONE + SMOKE_OTP_CODE  a Supabase test number and its fixed code; locally a
 *                     fresh number with PLACEHOLDER_OTP_CODE is used instead
 *  SMOKE_PLACE_ORDER=true  also place a cash order at the test store and cancel it at once
 * Never reads the database, so it is safe to run against production.
 */
const STORE = process.env.SMOKE_STORE_SLUG ?? "kapet-tinapay";
const PIN = {
  lat: Number(process.env.SMOKE_LAT ?? 14.5547),
  lng: Number(process.env.SMOKE_LNG ?? 121.0244),
};

interface Smoke {
  client?: ApiClient;
  store?: { merchantId: string; itemId: string };
  checkout?: ApiResponse;
}
const smoke = new WeakMap<KlikWorld, Smoke>();
const state = (world: KlikWorld): Smoke => {
  const found = smoke.get(world) ?? {};
  smoke.set(world, found);
  return found;
};

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

const visitor = (): ApiClient => {
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  return client;
};

async function storeOf(world: KlikWorld): Promise<{ merchantId: string; itemId: string }> {
  const known = state(world).store;
  if (known) return known;
  const page = data<{
    store: { merchantId: string };
    menu: {
      items: {
        id: string;
        isAvailable: boolean;
        modifierGroups: { required: boolean; minSelect: number }[];
      }[];
    }[];
  }>(await visitor().request("GET", `/api/stores/${STORE}`));
  const item = page.menu
    .flatMap((c) => c.items)
    .find((i) => i.isAvailable && !i.modifierGroups.some((g) => g.required || g.minSelect > 0));
  assert.ok(item, `${STORE} has no item that can be ordered without choices`);
  const found = { merchantId: page.store.merchantId, itemId: item.id };
  state(world).store = found;
  return found;
}

When(
  "a visitor opens the privacy notice, the terms and the partner page",
  async function (this: KlikWorld) {
    this.responses = [];
    for (const path of ["/legal/privacy", "/legal/terms", "/partners"]) {
      this.responses.push(await visitor().request("GET", path));
    }
  },
);

Then("each of them answers {int}", function (this: KlikWorld, status: number) {
  assert.deepEqual(
    this.responses.map((r) => r.status),
    this.responses.map(() => status),
  );
});

When("a visitor looks for stores at the smoke-test location", async function (this: KlikWorld) {
  this.lastResponse = await visitor().request(
    "GET",
    `/api/feed?lat=${String(PIN.lat)}&lng=${String(PIN.lng)}`,
  );
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then("the smoke-test store is listed and open to orders", async function (this: KlikWorld) {
  const feed = data<{ zone: unknown; stores: { slug: string }[] }>(
    this.lastResponse as ApiResponse,
  );
  assert.ok(feed.zone, "The smoke-test location is outside every zone");
  assert.ok(
    feed.stores.some((s) => s.slug === STORE),
    `${STORE} is not in the feed`,
  );
  await storeOf(this);
});

Then("its menu prices a cart on the server", async function (this: KlikWorld) {
  const { merchantId, itemId } = await storeOf(this);
  const quote = await visitor().post("/api/cart/quote", {
    merchantId,
    items: [{ itemId, quantity: 1, optionIds: [] }],
    dropoff: PIN,
  });
  assert.equal(quote.status, 200, quote.bodyText);
  assert.ok(data<{ totalCentavos: number }>(quote).totalCentavos > 0);
});

Given("the smoke-test customer signs in", async function (this: KlikWorld) {
  const phone = process.env.SMOKE_CUSTOMER_PHONE;
  const code = process.env.SMOKE_OTP_CODE ?? process.env.PLACEHOLDER_OTP_CODE;
  if (!code) return "skipped";
  const client = visitor();
  const number = phone ?? randomMobile();
  const requested = await client.post("/api/auth/otp", { phone: number });
  assert.equal(requested.status, 200, requested.bodyText);
  const verified = await client.post("/api/auth/otp/verify", { phone: number, code });
  assert.equal(verified.status, 200, verified.bodyText);
  // A fresh smoke customer agrees once; the fixed test number already has.
  await client.post("/api/me/consents", LEGAL_VERSIONS);
  state(this).client = client;
  return undefined;
});

const checkoutBody = (store: { merchantId: string; itemId: string }, method: string) => ({
  merchantId: store.merchantId,
  items: [{ itemId: store.itemId, quantity: 1, optionIds: [] }],
  dropoff: PIN,
  paymentMethod: method,
  tipCentavos: 0,
  address: {
    label: "Smoke test",
    landmark: "Smoke test, please ignore",
    contactPhone: "09170000000",
  },
});

When("they open checkout for the smoke-test store", async function (this: KlikWorld) {
  const { client } = state(this);
  assert.ok(client);
  state(this).checkout = await client.post(
    "/api/checkout/quote",
    checkoutBody(await storeOf(this), "cod"),
  );
});

Then("checkout offers cash on delivery", function (this: KlikWorld) {
  const response = state(this).checkout;
  assert.ok(response);
  const quote = data<{ paymentMethods: string[]; inviteRequired: boolean }>(response);
  assert.ok(quote.paymentMethods.includes("cod"), `Methods: ${quote.paymentMethods.join(", ")}`);
});

Then(
  "when order placing is enabled for the smoke test, an order is placed and cancelled at once",
  async function (this: KlikWorld) {
    if (process.env.SMOKE_PLACE_ORDER !== "true") return "skipped";
    const { client } = state(this);
    assert.ok(client);
    const placed = await client.request("POST", "/api/orders", {
      json: checkoutBody(await storeOf(this), "cod"),
      headers: { "Idempotency-Key": `smoke-${randomUUID()}` },
    });
    assert.equal(placed.status, 201, placed.bodyText);
    const { orderId } = data<{ orderId: string }>(placed);
    const cancelled = await client.post(`/api/orders/${orderId}/cancel`, {
      reason: "Smoke test order, cancelled automatically",
    });
    assert.equal(cancelled.status, 200, cancelled.bodyText);
    return undefined;
  },
);

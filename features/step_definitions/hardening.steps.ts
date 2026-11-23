import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { LEGAL_VERSIONS } from "@klikgo/types";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signedInStaff } from "../support/staff-session";
import { adminClient, randomIp, randomMobile } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

const PLACEHOLDER = process.env.PLACEHOLDER_OTP_CODE;
const CRON_SECRET = process.env.CRON_SECRET;
const AYALA = { lat: 14.5547, lng: 121.0244 };
const STORE = "Kape't Tinapay";
const NENA = "5eed0000-0000-4000-8000-000000000101";
const KYC_BUCKET = "rider-kyc";

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function message(response: ApiResponse | undefined): string {
  return (response?.json as { error?: { message?: string } } | undefined)?.error?.message ?? "";
}

function person(world: KlikWorld): { client: ApiClient; userId: string; phone: string } {
  assert.ok(world.hardening.person, "Nobody is signed in in this scenario");
  return world.hardening.person;
}

After(async function (this: KlikWorld) {
  for (const cleanup of this.hardening.cleanups.reverse()) await cleanup();
});

/** Signs a phone number in with the placeholder code; returns where the app sends them next. */
async function signIn(client: ApiClient, phone: string): Promise<string> {
  let requested = await client.post("/api/auth/otp", { phone });
  for (let attempt = 0; requested.status === 429 && attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    requested = await client.post("/api/auth/otp", { phone });
  }
  assert.equal(requested.status, 200, requested.bodyText);
  const verified = await client.post("/api/auth/otp/verify", { phone, code: PLACEHOLDER });
  assert.equal(verified.status, 200, verified.bodyText);
  return data<{ next: string }>(verified).next;
}

async function newPerson(world: KlikWorld, agree: boolean): Promise<"skipped" | undefined> {
  if (!PLACEHOLDER) return "skipped";
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  const phone = randomMobile();
  world.hardening.firstNext = await signIn(client, phone);
  const me = data<{ userId: string }>(await client.request("GET", "/api/me"));
  world.hardening.person = { client, userId: me.userId, phone };
  if (agree) {
    const agreed = await client.post("/api/me/consents", LEGAL_VERSIONS);
    assert.equal(agreed.status, 201, agreed.bodyText);
  }
  return undefined;
}

/** An order for the person from Aling Nena's, walked to `status` through legal transitions. */
async function orderFor(world: KlikWorld, userId: string, delivered: boolean): Promise<string> {
  const [zone] = await world.db.query<{ id: string }>(
    "select zone_id as id from public.merchants where id = $1",
    [NENA],
  );
  const [order] = await world.db.query<{ id: string; total_centavos: number }>(
    `insert into public.orders (code, customer_id, merchant_id, zone_id, status, payment_method,
       subtotal_centavos, delivery_fee_centavos, total_centavos, address_snapshot, dropoff)
     values ($1, $2, $3, $4, 'placed', 'cod', 20000, 3900, 23900,
             '{"street": "12 Mabini St", "landmark": "Blue gate", "barangay": "Poblacion", "city": "Makati", "contact_phone": "+639170000555"}',
             extensions.st_setsrid(extensions.st_makepoint($5, $6), 4326)::extensions.geography)
     returning id, total_centavos`,
    [`KG-${randomUUID().slice(0, 6).toUpperCase()}`, userId, NENA, zone?.id, AYALA.lng, AYALA.lat],
  );
  assert.ok(order, "Could not create the order");
  if (delivered) {
    await world.db.query(
      "select set_config('klikgo.actor_role', 'admin', false), set_config('klikgo.actor_id', '', false)",
    );
    for (const status of ["accepted", "preparing", "ready", "picked_up", "delivered"]) {
      await world.db.query("update public.orders set status = $2 where id = $1", [
        order.id,
        status,
      ]);
    }
  }
  world.hardening.orderId = order.id;
  world.hardening.orderTotal = order.total_centavos;
  return order.id;
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

Given("a new customer signs in with their phone", async function (this: KlikWorld) {
  return newPerson(this, false);
});

Then(
  "they are asked to agree to the terms and the privacy notice first",
  function (this: KlikWorld) {
    assert.match(this.hardening.firstNext ?? "", /^\/consent\?next=%2F/);
  },
);

When("they agree to the current terms and privacy notice", async function (this: KlikWorld) {
  this.lastResponse = await person(this).client.post("/api/me/consents", LEGAL_VERSIONS);
  assert.equal(this.lastResponse.status, 201, this.lastResponse.bodyText);
});

Then(
  "their agreement to both documents is recorded with today's version",
  async function (this: KlikWorld) {
    const rows = await this.db.query<{ document: string; version: string }>(
      "select document, version from public.consents where user_id = $1 order by document",
      [person(this).userId],
    );
    assert.deepEqual(rows, [
      { document: "privacy", version: LEGAL_VERSIONS.privacy },
      { document: "terms", version: LEGAL_VERSIONS.terms },
    ]);
  },
);

Then("signing in again takes them straight to the app", async function (this: KlikWorld) {
  const { client, phone } = person(this);
  const next = await signIn(client, phone);
  assert.ok(!next.startsWith("/consent"), `Still sent to ${next}`);
});

Given(
  "a signed-in customer with a saved address and a delivered order",
  async function (this: KlikWorld) {
    if ((await newPerson(this, true)) === "skipped") return "skipped";
    const { client, userId } = person(this);
    const saved = await client.post("/api/addresses", {
      label: "Home",
      location: AYALA,
      landmark: "Beside the bakery",
      barangay: "San Lorenzo",
      city: "Makati",
      contactPhone: "09170000555",
    });
    assert.equal(saved.status, 201, saved.bodyText);
    await orderFor(this, userId, true);
    return undefined;
  },
);

Given("a signed-in customer with an order on its way", async function (this: KlikWorld) {
  if ((await newPerson(this, true)) === "skipped") return "skipped";
  await orderFor(this, person(this).userId, false);
  return undefined;
});

When("they download their data", async function (this: KlikWorld) {
  this.lastResponse = await person(this).client.request("GET", "/api/me/export");
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  assert.match(
    this.lastResponse.headers.get("content-disposition") ?? "",
    /^attachment; filename="klikgo-my-data-\d{4}-\d{2}-\d{2}\.json"$/,
  );
  this.hardening.exported = JSON.parse(this.lastResponse.bodyText) as Record<string, unknown>;
});

Then(
  "the file holds their profile, their saved address and their order",
  function (this: KlikWorld) {
    const file = this.hardening.exported as {
      profile: { id: string };
      addresses: { landmark: string }[];
      orders: { total_centavos: number }[];
      consents: unknown[];
    };
    assert.equal(file.profile.id, person(this).userId);
    assert.deepEqual(
      file.addresses.map((a) => a.landmark),
      ["Beside the bakery"],
    );
    assert.deepEqual(
      file.orders.map((o) => o.total_centavos),
      [this.hardening.orderTotal],
    );
    assert.equal(file.consents.length, 2);
  },
);

Then("the file holds no other customer's details", async function (this: KlikWorld) {
  const others = await this.db.query<{ phone: string }>(
    "select phone from public.profiles where phone is not null and id <> $1 limit 200",
    [person(this).userId],
  );
  const body = this.lastResponse?.bodyText ?? "";
  for (const { phone } of others)
    assert.ok(!body.includes(phone), "Another person's number leaked");
});

Then(
  /^the audit log records "([^"]+)" for them$/,
  async function (this: KlikWorld, action: string) {
    const rows = await this.db.query(
      "select 1 from public.audit_logs where actor_id = $1 and action = $2",
      [person(this).userId, action],
    );
    assert.equal(rows.length, 1, `Expected one "${action}" audit row`);
  },
);

When(
  "they delete their account and type {string} to confirm",
  async function (this: KlikWorld, confirm: string) {
    this.lastResponse = await person(this).client.post("/api/me/delete", { confirm });
  },
);

Then(
  "they are signed out and cannot sign in to that account again",
  async function (this: KlikWorld) {
    assert.equal(this.lastResponse?.status, 200, this.lastResponse?.bodyText);
    const { client, userId, phone } = person(this);
    const me = await client.request("GET", "/api/me");
    assert.equal(me.status, 401, me.bodyText);
    // The same number now starts a brand-new account; the old one is gone for good.
    const fresh = new ApiClient(BASE_URL);
    fresh.headers.set("x-forwarded-for", randomIp());
    await signIn(fresh, phone);
    const again = data<{ userId: string }>(await fresh.request("GET", "/api/me"));
    assert.notEqual(again.userId, userId);
  },
);

Then("their name, phone number and saved addresses are erased", async function (this: KlikWorld) {
  const { userId } = person(this);
  const [profile] = await this.db.query(
    "select full_name, phone, email, status::text as status from public.profiles where id = $1",
    [userId],
  );
  assert.deepEqual(profile, { full_name: null, phone: null, email: null, status: "deleted" });
  const addresses = await this.db.query("select 1 from public.addresses where user_id = $1", [
    userId,
  ]);
  assert.equal(addresses.length, 0);
});

Then(
  "their order keeps its amounts but no longer holds their address",
  async function (this: KlikWorld) {
    const [order] = await this.db.query<{ total_centavos: number; address_snapshot: unknown }>(
      "select total_centavos, address_snapshot from public.orders where id = $1",
      [this.hardening.orderId],
    );
    assert.equal(order?.total_centavos, this.hardening.orderTotal);
    assert.deepEqual(order?.address_snapshot, {
      barangay: "Poblacion",
      city: "Makati",
      erased: true,
    });
  },
);

Then("the deletion is refused with {string}", function (this: KlikWorld, expected: string) {
  assert.ok(
    [400, 409].includes(this.lastResponse?.status ?? 0),
    `Expected a refusal, got ${String(this.lastResponse?.status)}`,
  );
  assert.ok(message(this.lastResponse).includes(expected), message(this.lastResponse));
});

Given("a store owner is signed in", async function (this: KlikWorld) {
  const owner = await signedInStaff(this, "merchant_owner", { merchantId: NENA });
  this.hardening.person = { ...owner, phone: "" };
});

Given(
  "a rider application rejected 91 days ago with an uploaded government ID",
  async function (this: KlikWorld) {
    const { data: created, error } = await adminClient().auth.admin.createUser({
      phone: randomMobile().slice(1),
      phone_confirm: true,
    });
    assert.ok(created.user, error?.message);
    const userId = created.user.id;
    const [rider] = await this.db.query<{ id: string }>(
      `insert into public.riders (user_id, zone_id, vehicle_type, status)
       select $1, z.id, 'bicycle', 'pending_kyc' from public.zones z where z.slug = 'makati'
       returning id`,
      [userId],
    );
    assert.ok(rider);
    const path = `${rider.id}/government_id-${randomUUID()}.jpg`;
    const uploaded = await adminClient()
      .storage.from(KYC_BUCKET)
      .upload(path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), { contentType: "image/jpeg" });
    assert.ok(!uploaded.error, uploaded.error?.message);
    await this.db.query(
      `insert into public.rider_kyc_documents (rider_id, type, storage_path, status, reviewed_at, rejection_reason)
       values ($1, 'government_id', $2, 'rejected', now() - interval '91 days', 'Blurry photo')`,
      [rider.id, path],
    );
    this.hardening.rider = { riderId: rider.id, path };
    this.hardening.cleanups.push(async () => {
      await adminClient().storage.from(KYC_BUCKET).remove([path]);
    });
  },
);

When("the background jobs run", async function (this: KlikWorld) {
  if (!CRON_SECRET) return "skipped";
  this.lastResponse = await new ApiClient(BASE_URL).request("POST", "/api/internal/jobs", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  return undefined;
});

Then(
  "the ID file is deleted from storage and the document is marked purged",
  async function (this: KlikWorld) {
    assert.ok(this.hardening.rider);
    const { riderId, path } = this.hardening.rider;
    const download = await adminClient().storage.from(KYC_BUCKET).download(path);
    assert.ok(download.error, "The ID file is still in storage");
    const [doc] = await this.db.query<{ purged_at: Date | null }>(
      "select purged_at from public.rider_kyc_documents where rider_id = $1",
      [riderId],
    );
    assert.ok(doc?.purged_at, "The document is not marked purged");
  },
);

Then(/^the audit log records "kyc\.purged"$/, async function (this: KlikWorld) {
  const rows = await this.db.query(
    "select 1 from public.audit_logs where action = 'kyc.purged' and entity_id = $1",
    [this.hardening.rider?.riderId],
  );
  assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------------------
// Resilience
// ---------------------------------------------------------------------------

async function setSwitch(world: KlikWorld, key: string, enabled: boolean): Promise<void> {
  const admin = world.ops.admin ?? (await signedInStaff(world, "admin"));
  world.ops.admin = admin;
  const [before] = await world.db.query<{ enabled: boolean }>(
    "select enabled from public.feature_flags where key = $1",
    [key],
  );
  const put = (on: boolean) =>
    admin.client.request("PUT", `/api/admin/settings/flags/${key}`, {
      json: { enabled: on, rollout: {} },
    });
  const response = await put(enabled);
  assert.equal(response.status, 200, response.bodyText);
  world.hardening.cleanups.push(async () => {
    await put(before?.enabled ?? !enabled);
  });
}

async function storeCart(world: KlikWorld): Promise<{
  merchantId: string;
  items: { itemId: string; quantity: number; optionIds: string[] }[];
}> {
  const [row] = await world.db.query<{ merchant_id: string; item_id: string }>(
    `select m.id as merchant_id, i.id as item_id from public.merchants m
       join public.menu_items i on i.merchant_id = m.id
      where m.name = $1 and i.is_available
        and not exists (select 1 from public.modifier_groups g
                         where g.menu_item_id = i.id and (g.is_required or g.min_select > 0))
      order by i.price_centavos desc limit 1`,
    [STORE],
  );
  assert.ok(row, `${STORE} has no menu`);
  return {
    merchantId: row.merchant_id,
    items: [{ itemId: row.item_id, quantity: 2, optionIds: [] }],
  };
}

function checkoutBody(
  cart: Awaited<ReturnType<typeof storeCart>>,
  paymentMethod: string,
): Record<string, unknown> {
  return {
    ...cart,
    dropoff: AYALA,
    paymentMethod,
    tipCentavos: 0,
    address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000103" },
  };
}

Given("an admin pauses online payments", async function (this: KlikWorld) {
  await setSwitch(this, "online_payments", false);
});

Given("an admin turns on the flat delivery fee", async function (this: KlikWorld) {
  await setSwitch(this, "flat_delivery_fee", true);
});

Given(
  "a signed-in customer with a cart from {string}",
  async function (this: KlikWorld, store: string) {
    assert.equal(store, STORE);
    return newPerson(this, true);
  },
);

When("the customer opens checkout", async function (this: KlikWorld) {
  const cart = await storeCart(this);
  this.lastResponse = await person(this).client.post(
    "/api/checkout/quote",
    checkoutBody(cart, "cod"),
  );
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then("cash on delivery is the only way to pay", function (this: KlikWorld) {
  const quote = data<{ paymentMethods: string[]; onlinePaymentsPaused: boolean }>(
    this.lastResponse as ApiResponse,
  );
  assert.deepEqual(quote.paymentMethods, ["cod"]);
  assert.equal(quote.onlinePaymentsPaused, true);
});

Then(
  "placing a GCash order is refused with {string}",
  async function (this: KlikWorld, expected: string) {
    const response = await person(this).client.request("POST", "/api/orders", {
      json: checkoutBody(await storeCart(this), "gcash"),
      headers: { "Idempotency-Key": `bdd-${randomUUID()}` },
    });
    assert.equal(response.status, 409, response.bodyText);
    assert.equal(message(response), expected);
  },
);

Then("placing a cash on delivery order works", async function (this: KlikWorld) {
  const response = await person(this).client.request("POST", "/api/orders", {
    json: checkoutBody(await storeCart(this), "cod"),
    headers: { "Idempotency-Key": `bdd-${randomUUID()}` },
  });
  assert.equal(response.status, 201, response.bodyText);
  const placed = data<{ orderId: string }>(response);
  // Leave nothing for the store's queue in later scenarios.
  await this.db.query(
    "select set_config('klikgo.actor_role', 'admin', false), set_config('klikgo.actor_id', '', false)",
  );
  await this.db.query(
    `update public.orders set status = 'cancelled', cancel_reason = 'Test', cancelled_by_role = 'admin'
      where id = $1`,
    [placed.orderId],
  );
});

When(
  "a customer asks for a quote from {string} to a nearby and to a farther address",
  async function (this: KlikWorld, store: string) {
    assert.equal(store, STORE);
    const cart = await storeCart(this);
    const quotes: number[] = [];
    for (const dropoff of [AYALA, { lat: AYALA.lat + 0.02, lng: AYALA.lng + 0.01 }]) {
      const response = await new ApiClient(BASE_URL).post("/api/cart/quote", { ...cart, dropoff });
      assert.equal(response.status, 200, response.bodyText);
      quotes.push(data<{ deliveryFeeCentavos: number }>(response).deliveryFeeCentavos);
    }
    this.hardening.quotes = quotes;
  },
);

Then("both quotes charge the zone's base delivery fee", async function (this: KlikWorld) {
  const [zone] = await this.db.query<{ base_fee_centavos: number }>(
    `select z.base_fee_centavos from public.zones z join public.merchants m on m.zone_id = z.id
      where m.name = $1`,
    [STORE],
  );
  assert.deepEqual(this.hardening.quotes, [zone?.base_fee_centavos, zone?.base_fee_centavos]);
});

Given("address search is unavailable", function () {
  // CI has no Google Maps key, so address search answers "unavailable" exactly as in an outage.
  return process.env.GOOGLE_MAPS_API_KEY ? "skipped" : undefined;
});

When("a signed-in customer searches for {string}", async function (this: KlikWorld, query: string) {
  if ((await newPerson(this, true)) === "skipped") return "skipped";
  const params = new URLSearchParams({ q: query, session: randomUUID() });
  this.lastResponse = await person(this).client.request(
    "GET",
    `/api/geo/autocomplete?${params.toString()}`,
  );
  return undefined;
});

Then("they are told to drop the pin on the map themselves", function (this: KlikWorld) {
  assert.equal(this.lastResponse?.status, 503, this.lastResponse?.bodyText);
  assert.match(message(this.lastResponse), /Drop the pin on the map yourself/);
});

Then("saving an address from a dropped pin works", async function (this: KlikWorld) {
  const saved = await person(this).client.post("/api/addresses", {
    label: "Home",
    location: { lat: 14.5561, lng: 121.0233 },
    landmark: "Green gate near the chapel",
    barangay: "San Lorenzo",
    city: "Makati",
    contactPhone: "09170000555",
  });
  assert.equal(saved.status, 201, saved.bodyText);
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

Given("a visitor on their own network", function (this: KlikWorld) {
  const visitor = new ApiClient(BASE_URL);
  // A private address no other scenario uses, so the count starts at zero.
  visitor.headers.set(
    "x-forwarded-for",
    `10.${String(randomInt(0, 256))}.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`,
  );
  this.hardening.visitor = visitor;
});

When(
  "they send {int} changes as fast as they can",
  async function (this: KlikWorld, count: number) {
    assert.ok(this.hardening.visitor);
    const statuses: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const response = await this.hardening.visitor.post("/api/events", { name: "home_viewed" });
      statuses.push(response.status);
      this.lastResponse = response.status === 429 ? response : (this.lastResponse ?? response);
    }
    this.hardening.statuses = statuses;
  },
);

Then("at most {int} changes a minute are accepted", function (this: KlikWorld, limit: number) {
  const statuses = this.hardening.statuses ?? [];
  const accepted = statuses.filter((s) => s === 202).length;
  // The requests span at most two fixed one-minute windows.
  assert.ok(accepted <= 2 * limit, `${String(accepted)} accepted`);
  assert.ok(statuses.includes(429), "Nothing was refused");
  assert.ok(
    statuses.slice(0, limit).every((s) => s === 202),
    "Refused before the limit",
  );
});

Then(
  "the rest are refused with status {int} and a Retry-After header",
  function (this: KlikWorld, status: number) {
    assert.equal(this.lastResponse?.status, status);
    assert.match(this.lastResponse?.headers.get("retry-after") ?? "", /^\d+$/);
    assert.equal(
      (this.lastResponse?.json as { error?: { code?: string } }).error?.code,
      "RATE_LIMITED",
    );
  },
);

When(
  "another website makes a visitor's browser send a change to Klik Go",
  async function (this: KlikWorld) {
    const client = new ApiClient(BASE_URL);
    client.headers.set("x-forwarded-for", randomIp());
    this.lastResponse = await client.request("POST", "/api/events", {
      json: { name: "home_viewed" },
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
  },
);

Then("the change is refused with status {int}", function (this: KlikWorld, status: number) {
  assert.equal(this.lastResponse?.status, status, this.lastResponse?.bodyText);
});

When("Klik Go's own page sends a change", async function (this: KlikWorld) {
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  this.lastResponse = await client.request("POST", "/api/events", {
    json: { name: "home_viewed" },
    headers: { origin: new URL(BASE_URL).origin, "sec-fetch-site": "same-origin" },
  });
});

Then("the change is not refused as cross-site", function (this: KlikWorld) {
  assert.equal(this.lastResponse?.status, 202, this.lastResponse?.bodyText);
});

Given("a rider applicant is signed in", async function (this: KlikWorld) {
  if ((await newPerson(this, true)) === "skipped") return "skipped";
  const [zone] = await this.db.query<{ id: string }>(
    "select id from public.zones where slug = 'makati'",
  );
  const applied = await person(this).client.post("/api/rider/application", {
    zoneId: zone?.id,
    vehicleType: "bicycle",
    fullName: "Pia Pretend",
    payoutAccountName: "Pia Pretend",
  });
  assert.equal(applied.status, 201, applied.bodyText);
  return undefined;
});

When(
  "they upload a web page renamed to {string} as their government ID",
  async function (this: KlikWorld, name: string) {
    const form = new FormData();
    form.set("type", "government_id");
    form.set(
      "file",
      new File(["<!doctype html><script>alert(1)</script>"], name, { type: "image/jpeg" }),
    );
    this.lastResponse = await person(this).client.request(
      "POST",
      "/api/rider/application/documents",
      { body: form },
    );
  },
);

Then("the upload is refused with {string}", function (this: KlikWorld, expected: string) {
  assert.equal(this.lastResponse?.status, 400, this.lastResponse?.bodyText);
  assert.ok(message(this.lastResponse).includes(expected), message(this.lastResponse));
});

Then("file storage is reported {string}", function (this: KlikWorld, state: string) {
  assert.equal(data<{ storage: string }>(this.lastResponse as ApiResponse).storage, state);
});

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

When("the app reports that a visitor viewed a store", async function (this: KlikWorld) {
  const [store] = await this.db.query<{ id: string }>(
    "select id from public.merchants where name = $1",
    [STORE],
  );
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  client.headers.set("x-device-id", `bdd-funnel-${randomUUID()}`);
  this.lastResponse = await client.post("/api/events", {
    name: "store_viewed",
    storeId: store?.id,
    path: "/s/kape-t-tinapay",
  });
  this.hardening.visitor = client;
});

Then("the event is accepted", function (this: KlikWorld) {
  assert.equal(this.lastResponse?.status, 202, this.lastResponse?.bodyText);
});

Then("an event that is not part of the funnel is refused", async function (this: KlikWorld) {
  assert.ok(this.hardening.visitor);
  const response = await this.hardening.visitor.post("/api/events", {
    name: "phone_number_seen",
    path: "/",
  });
  assert.equal(response.status, 400, response.bodyText);
});

When(
  "the app reports a browser error that mentions the phone number {string}",
  async function (this: KlikWorld, phone: string) {
    const client = new ApiClient(BASE_URL);
    client.headers.set("x-forwarded-for", randomIp());
    this.lastResponse = await client.post("/api/client-errors", {
      kind: "error",
      message: `Could not load the order for ${phone}`,
      path: "/checkout",
    });
  },
);

Then("the error report is accepted", function (this: KlikWorld) {
  assert.equal(this.lastResponse?.status, 202, this.lastResponse?.bodyText);
});

Given("the background jobs have run", async function (this: KlikWorld) {
  if (!CRON_SECRET) return "skipped";
  const response = await new ApiClient(BASE_URL).request("POST", "/api/internal/jobs", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  assert.equal(response.status, 200, response.bodyText);
  return undefined;
});

When("the admin opens the system status", async function (this: KlikWorld) {
  assert.ok(this.ops.admin, "No admin signed in");
  this.lastResponse = await this.ops.admin.client.request("GET", "/api/admin/system");
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then("it shows when the background jobs last ran", function (this: KlikWorld) {
  const status = data<{
    jobs: { lastRun: { finishedAt: string } | null; lagSeconds: number | null; healthy: boolean };
  }>(this.lastResponse as ApiResponse);
  assert.ok(status.jobs.lastRun?.finishedAt, "No job run recorded");
  assert.equal(typeof status.jobs.lagSeconds, "number");
  assert.equal(status.jobs.healthy, true);
});

Then("it lists failed payment webhooks and missed store deadlines", function (this: KlikWorld) {
  const status = data<{ webhookFailures: unknown[]; slaBreaches: unknown[]; cron: unknown[] }>(
    this.lastResponse as ApiResponse,
  );
  assert.ok(Array.isArray(status.webhookFailures));
  assert.ok(Array.isArray(status.slaBreaches));
  assert.ok(status.cron.length > 0, "No database schedules listed");
});

Then("a coordinator cannot open the system status", async function (this: KlikWorld) {
  const [zone] = await this.db.query<{ id: string }>(
    "select id from public.zones where slug = 'makati'",
  );
  const coordinator = await signedInStaff(this, "coordinator", { zoneId: zone?.id ?? "" });
  const response = await coordinator.client.request("GET", "/api/admin/system");
  assert.equal(response.status, 403, response.bodyText);
});

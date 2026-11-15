import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Given, Then, When } from "@cucumber/cucumber";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signInWithPhone } from "../support/phone-session";
import { signedInStaff } from "../support/staff-session";
import { randomIp, randomMobile } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld, type RetentionCustomer } from "../support/world";

const AYALA = { lat: 14.5547, lng: 121.0244 };
const STORE = "Kape't Tinapay";
/** The placeholder sign-in code CI sets for this run (customers only); scenarios skip without it. */
const PLACEHOLDER = process.env.PLACEHOLDER_OTP_CODE;
const RIDERS: Readonly<Record<string, { phone: string; id: string }>> = {
  Rico: { phone: "+639170000021", id: "5eed0000-0000-4000-8000-000000000201" },
  Rosa: { phone: "+639170000022", id: "5eed0000-0000-4000-8000-000000000202" },
};

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function errorMessage(response: ApiResponse): string {
  return (response.json as { error?: { message?: string } } | undefined)?.error?.message ?? "";
}

function customer(world: KlikWorld, name: string): RetentionCustomer {
  const found = world.retention.customers.get(name);
  assert.ok(found, `No customer ${name} in this scenario`);
  return found;
}

/** The scenario's main customer: a named one, or the signed-in test customer from checkout steps. */
function mainCustomer(world: KlikWorld): RetentionCustomer {
  assert.ok(world.checkout.customerId, "No signed-in customer");
  return { client: world.api, userId: world.checkout.customerId };
}

function orderId(world: KlikWorld): string {
  assert.ok(world.checkout.orderId, "No order in this scenario");
  return world.checkout.orderId;
}

async function storeId(world: KlikWorld): Promise<string> {
  const [row] = await world.db.query<{ id: string }>(
    "select id from public.merchants where name = $1",
    [STORE],
  );
  assert.ok(row, `No store ${STORE}`);
  return row.id;
}

async function menuItem(
  world: KlikWorld,
  name: string,
): Promise<{ id: string; options: Map<string, string> }> {
  const rows = await world.db.query<{
    id: string;
    option_id: string | null;
    option_name: string | null;
  }>(
    `select i.id, o.id as option_id, o.name as option_name
       from public.menu_items i
       join public.merchants m on m.id = i.merchant_id
       left join public.modifier_groups g on g.menu_item_id = i.id
       left join public.modifier_options o on o.modifier_group_id = g.id
      where m.name = $1 and i.name = $2`,
    [STORE, name],
  );
  const first = rows[0];
  assert.ok(first, `${STORE} has no ${name}`);
  return {
    id: first.id,
    options: new Map(
      rows.flatMap((r) => (r.option_id && r.option_name ? [[r.option_name, r.option_id]] : [])),
    ),
  };
}

/**
 * Walks an order to delivered by a rider, the way the store, dispatch and the rider app would,
 * as the platform (the database checks every transition and writes the history).
 */
async function deliver(
  world: KlikWorld,
  id: string,
  options: { rider?: string; daysAgo?: number } = {},
): Promise<void> {
  const rider = RIDERS[options.rider ?? "Rico"];
  assert.ok(rider, `No seeded rider ${options.rider ?? ""}`);
  const [current] = await world.db.query<{ status: string }>(
    "select status::text from public.orders where id = $1",
    [id],
  );
  const steps = ["accepted", "preparing", "ready", "picked_up", "delivered"];
  const from = steps.indexOf(current?.status ?? "") + 1;
  await world.db.query("begin");
  try {
    await world.db.query("select set_config('klikgo.actor_role', '', true)");
    for (const status of steps.slice(from)) {
      await world.db.query(
        `update public.orders set status = $2::public.order_status,
                rider_id = case when $2 = 'picked_up' then $3::uuid else rider_id end
          where id = $1`,
        [id, status, rider.id],
      );
    }
    if (options.daysAgo) {
      await world.db.query(
        "update public.orders set delivered_at = now() - make_interval(days => $2) where id = $1",
        [id, options.daysAgo],
      );
    }
    await world.db.query("commit");
  } catch (error) {
    await world.db.query("rollback");
    throw error;
  }
}

/** A COD order stored as checkout would, for a customer, at a subtotal and dropoff. */
async function storedOrder(
  world: KlikWorld,
  customerId: string,
  subtotal: number,
  dropoff = AYALA,
): Promise<string> {
  const merchantId = await storeId(world);
  const item = await menuItem(world, "Pandesal (10 pcs)");
  const [order] = await world.db.query<{ id: string }>(
    `insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method, subtotal_centavos,
                                delivery_fee_centavos, total_centavos, address_snapshot, dropoff)
     select $1, m.id, m.zone_id, 'placed', 'cod', $2, 3900, $2 + 3900,
            '{"label":"Home","landmark":"Gate","contact_phone":"+639170000000"}',
            extensions.st_setsrid(extensions.st_makepoint($4, $3), 4326)::extensions.geography
       from public.merchants m where m.id = $5
     returning id`,
    [customerId, subtotal, dropoff.lat, dropoff.lng, merchantId],
  );
  assert.ok(order);
  await world.db.query(
    `insert into public.order_items (order_id, menu_item_id, name_snapshot, unit_price_centavos, quantity, line_total_centavos)
     values ($1, $2, 'Pandesal (10 pcs)', $3, 1, $3)`,
    [order.id, item.id, subtotal],
  );
  return order.id;
}

async function quote(
  world: KlikWorld,
  who: RetentionCustomer,
  promoCode: string,
): Promise<ApiResponse> {
  const barako = await menuItem(world, "Kapeng Barako");
  return who.client.post("/api/checkout/quote", {
    merchantId: await storeId(world),
    items: [
      { itemId: barako.id, quantity: 2, optionIds: [barako.options.get("Less sugar") ?? ""] },
    ],
    dropoff: AYALA,
    tipCentavos: 0,
    promoCode,
  });
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

async function newCustomer(
  world: KlikWorld,
  name: string,
  device: string | null,
): Promise<string | undefined> {
  if (!PLACEHOLDER) return "skipped";
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  if (device) client.headers.set("x-device-id", `${device}-${world.retention.run}`);
  const phone = randomMobile();
  const requested = await client.post("/api/auth/otp", { phone });
  assert.equal(requested.status, 200, requested.bodyText);
  const verified = await client.post("/api/auth/otp/verify", { phone, code: PLACEHOLDER });
  assert.equal(verified.status, 200, verified.bodyText);
  const me = data<{ userId: string }>(await client.request("GET", "/api/me"));
  world.retention.customers.set(name, { client, userId: me.userId });
  return undefined;
}

Given(
  "a new customer {string} signs in on their phone",
  async function (this: KlikWorld, name: string) {
    return newCustomer(this, name, `own-${name.toLowerCase()}-device`);
  },
);

Given(
  "a new customer {string} signs in on device {string}",
  async function (this: KlikWorld, name: string, device: string) {
    return newCustomer(this, name, device);
  },
);

async function riderClient(name: string): Promise<ApiClient> {
  const rider = RIDERS[name];
  assert.ok(rider, `No seeded rider ${name}`);
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  await signInWithPhone(client, rider.phone);
  return client;
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

Given(
  /^the order (?:has been delivered|was delivered (\d+) days ago) by rider "([^"]+)"$/,
  async function (this: KlikWorld, days: string | null | undefined, rider: string) {
    await deliver(this, orderId(this), { rider, ...(days ? { daysAgo: Number(days) } : {}) });
  },
);

const tagList = (tags: string | null | undefined): string[] =>
  tags ? tags.split(",").map((t) => t.trim()) : [];

async function rate(world: KlikWorld, body: Record<string, unknown>): Promise<void> {
  world.lastResponse = await mainCustomer(world).client.post(
    `/api/orders/${orderId(world)}/ratings`,
    body,
  );
}

When(
  /^the customer rates the store (\d) stars(?: with "([^"]+)")?(?: and the rider (\d) stars)?$/,
  async function (
    this: KlikWorld,
    store: string,
    tags: string | null | undefined,
    rider: string | null | undefined,
  ) {
    await rate(this, {
      merchant: { score: Number(store), tags: tagList(tags) },
      ...(rider ? { rider: { score: Number(rider), tags: [] } } : {}),
    });
  },
);

Given("the customer rated the store {int} stars", async function (this: KlikWorld, score: number) {
  await rate(this, { merchant: { score, tags: [] } });
  assert.equal(this.response().status, 200, this.response().bodyText);
});

Then("the rating is refused with {string}", function (this: KlikWorld, message: string) {
  assert.equal(this.response().status, 409, this.response().bodyText);
  assert.equal(errorMessage(this.response()), message);
});

Then(
  /^the rating sheet shows the store at (\d) stars(?: and the rider at (\d) stars)?$/,
  async function (this: KlikWorld, store: string, rider: string | null | undefined) {
    const sheet = data<{
      open: boolean;
      merchant: { rating: { score: number } | null };
      rider: { rating: { score: number } | null } | null;
    }>(await mainCustomer(this).client.request("GET", `/api/orders/${orderId(this)}/ratings`));
    assert.equal(sheet.open, true);
    assert.equal(sheet.merchant.rating?.score, Number(store));
    if (rider) assert.equal(sheet.rider?.rating?.score, Number(rider));
  },
);

Then(
  "the order counts in {string}'s rating average",
  async function (this: KlikWorld, store: string) {
    const [row] = await this.db.query<{ ok: boolean }>(
      `select m.rating_count = (select count(*) from public.ratings r where r.target_type = 'merchant' and r.target_id = m.id)
              and m.rating_avg = (select round(avg(score)::numeric, 2) from public.ratings r
                                   where r.target_type = 'merchant' and r.target_id = m.id) as ok
         from public.merchants m where m.name = $1`,
      [store],
    );
    assert.equal(row?.ok, true);
  },
);

Given(
  "the store rating was given {int} hours ago",
  async function (this: KlikWorld, hours: number) {
    await this.db.query(
      `update public.ratings set created_at = now() - make_interval(hours => $2)
      where order_id = $1 and target_type = 'merchant'`,
      [orderId(this), hours],
    );
  },
);

Then(
  "the Makati coordinator sees a low-rating ticket for the order",
  async function (this: KlikWorld) {
    const [zone] = await this.db.query<{ id: string }>(
      "select id from public.zones where slug = 'makati'",
    );
    this.ops.coordinator = await signedInStaff(this, "coordinator", { zoneId: zone?.id ?? "" });
    const tickets = data<{ id: string; orderId: string; summary: string }[]>(
      await this.ops.coordinator.client.request("GET", "/api/admin/tickets?status=open"),
    );
    const ticket = tickets.find((t) => t.orderId === orderId(this));
    assert.ok(ticket, "No ticket for the order");
    assert.match(
      ticket.summary,
      /^Store Kape't Tinapay rated 2\/5 on KG-[A-Z0-9]{6} \(cold food\)$/,
    );
    this.retention.ticketId = ticket.id;
  },
);

When(
  "the coordinator marks the ticket done with {string}",
  async function (this: KlikWorld, note: string) {
    assert.ok(this.ops.coordinator && this.retention.ticketId);
    this.lastResponse = await this.ops.coordinator.client.post(
      `/api/admin/tickets/${this.retention.ticketId}/resolve`,
      { resolution: note },
    );
    assert.equal(this.response().status, 200, this.response().bodyText);
  },
);

Then(
  "the ticket is done and the audit log records {string}",
  async function (this: KlikWorld, action: string) {
    assert.equal(data<{ status: string }>(this.response()).status, "resolved");
    const [row] = await this.db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_logs where action = $1 and entity_id = $2",
      [action, this.retention.ticketId],
    );
    assert.equal(row?.n, 1);
  },
);

When(
  "rider {string} rates the customer {int} stars with {string}",
  async function (this: KlikWorld, rider: string, score: number, tags: string) {
    const client = await riderClient(rider);
    this.lastResponse = await client.post(`/api/rider/ratings/${orderId(this)}`, {
      score,
      tags: tagList(tags),
    });
    assert.equal(this.response().status, 200, this.response().bodyText);
  },
);

Then(
  "the customer's average from riders includes {int} stars",
  async function (this: KlikWorld, score: number) {
    const [row] = await this.db.query<{ rating_count: number; has: boolean }>(
      `select p.rating_count,
              exists (select 1 from public.ratings r where r.order_id = $2 and r.target_type = 'customer' and r.score = $3) as has
         from public.profiles p where p.id = $1`,
      [mainCustomer(this).userId, orderId(this), score],
    );
    assert.ok(row && row.rating_count >= 1 && row.has);
  },
);

Then(
  "rider {string} cannot rate the customer of that order",
  async function (this: KlikWorld, rider: string) {
    const client = await riderClient(rider);
    const response = await client.post(`/api/rider/ratings/${orderId(this)}`, {
      score: 1,
      tags: [],
    });
    assert.equal(response.status, 404, response.bodyText);
  },
);

// ---------------------------------------------------------------------------
// History and reorder
// ---------------------------------------------------------------------------

When("they open their order history", async function (this: KlikWorld) {
  this.lastResponse = await this.api.request("GET", "/api/orders");
});

Then(
  "the newest order lists {string} and the one before it {string}",
  function (this: KlikWorld, newest: string, before: string) {
    const list = data<{ itemsSummary: string }[]>(this.response());
    assert.equal(list[0]?.itemsSummary, newest);
    assert.equal(list[1]?.itemsSummary, before);
  },
);

async function changeItem(
  world: KlikWorld,
  item: string,
  set: string,
  value: unknown,
): Promise<void> {
  const { id } = await menuItem(world, item);
  const [before] = await world.db.query<Record<string, unknown>>(
    `select price_centavos, is_available from public.menu_items where id = $1`,
    [id],
  );
  world.merchant.cleanups.push(async () => {
    await world.db.query(
      "update public.menu_items set price_centavos = $2, is_available = $3 where id = $1",
      [id, before?.price_centavos, before?.is_available],
    );
  });
  await world.db.query(`update public.menu_items set ${set} = $2 where id = $1`, [id, value]);
}

Given(
  "{string} at {string} now costs {int} centavos",
  async function (this: KlikWorld, item: string, _store: string, price: number) {
    await changeItem(this, item, "price_centavos", price);
  },
);

When(/^they order the (.+) order again$/, async function (this: KlikWorld, item: string) {
  const [row] = await this.db.query<{ id: string }>(
    `select o.id from public.orders o join public.order_items i on i.order_id = o.id
      where o.customer_id = $1 and i.name_snapshot = $2 order by o.created_at desc limit 1`,
    [mainCustomer(this).userId, item],
  );
  assert.ok(row, `No ${item} order`);
  this.retention.orders.set("reordered", row.id);
  this.lastResponse = await this.api.post(`/api/orders/${row.id}/reorder`, {});
});

interface Plan {
  lines: {
    name: string;
    quantity: number;
    available: boolean;
    issue: string | null;
    unitPriceCentavos: number | null;
  }[];
}

Then(
  '"Order again" offers {int} {string} at {int} centavos each, all available',
  function (this: KlikWorld, quantity: number, item: string, price: number) {
    const plan = data<Plan>(this.response());
    assert.deepEqual(
      plan.lines.map((l) => [l.name, l.quantity, l.available, l.unitPriceCentavos]),
      [[item, quantity, true, price]],
    );
  },
);

Then(
  '"Order again" flags {string} as {string}',
  function (this: KlikWorld, item: string, issue: string) {
    const plan = data<Plan>(this.response());
    const line = plan.lines.find((l) => l.name === item);
    assert.ok(line, `No ${item} line`);
    assert.equal(line.available, false);
    assert.equal(line.issue, issue);
  },
);

Then("someone else cannot order that order again", async function (this: KlikWorld) {
  const stranger = new ApiClient(BASE_URL);
  stranger.headers.set("x-forwarded-for", randomIp());
  await signInWithPhone(stranger, "+639170000104");
  const response = await stranger.post(
    `/api/orders/${this.retention.orders.get("reordered") ?? ""}/reorder`,
    {},
  );
  assert.equal(response.status, 404, response.bodyText);
});

// ---------------------------------------------------------------------------
// Promos
// ---------------------------------------------------------------------------

Given(
  /^the admin creates a "([a-z_]+)" campaign(?: worth (\d+) (centavos|basis points))?(?: capped at (\d+) centavos)?(?: with a budget of (\d+) centavos)?( for new customers only)?$/,
  async function (
    this: KlikWorld,
    type: string,
    worth: string | null | undefined,
    unit: string | null | undefined,
    cap: string | null | undefined,
    budget: string | null | undefined,
    newOnly: string | null | undefined,
  ) {
    assert.ok(this.ops.admin, "No admin signed in");
    const code = `T${randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`;
    const response = await this.ops.admin.client.post("/api/admin/promos", {
      code,
      type,
      ...(worth && unit === "centavos" ? { discountCentavos: Number(worth) } : {}),
      ...(worth && unit === "basis points" ? { discountBps: Number(worth) } : {}),
      ...(cap ? { maxDiscountCentavos: Number(cap) } : {}),
      ...(budget ? { budgetCentavos: Number(budget) } : {}),
      ...(newOnly ? { firstOrders: 1 } : {}),
      minSubtotalCentavos: 0,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      perUserLimit: 1,
    });
    assert.equal(response.status, 201, response.bodyText);
    this.retention.campaign = { code, id: data<{ id: string }>(response).id };
  },
);

function campaignCode(world: KlikWorld): string {
  assert.ok(world.retention.campaign, "No campaign in this scenario");
  return world.retention.campaign.code;
}

Then(
  "the campaign takes {int} centavos off {string}'s checkout",
  async function (this: KlikWorld, amount: number, name: string) {
    const priced = data<{ promo: { discountCentavos: number } | null; promoError: string | null }>(
      await quote(this, customer(this, name), campaignCode(this)),
    );
    assert.equal(priced.promoError, null);
    assert.equal(priced.promo?.discountCentavos, amount);
  },
);

Then(
  "{string}'s checkout says {string}",
  async function (this: KlikWorld, name: string, message: string) {
    const priced = data<{ promoError: string | null }>(
      await quote(this, customer(this, name), campaignCode(this)),
    );
    assert.equal(priced.promoError, message);
  },
);

Given("{string} has had an order delivered", async function (this: KlikWorld, name: string) {
  const id = await storedOrder(this, customer(this, name).userId, 20000);
  await deliver(this, id);
  this.retention.orders.set(name, id);
});

Given(
  "{string} places a cash order with the campaign",
  async function (this: KlikWorld, name: string) {
    const barako = await menuItem(this, "Kapeng Barako");
    const response = await customer(this, name).client.request("POST", "/api/orders", {
      json: {
        merchantId: await storeId(this),
        items: [
          { itemId: barako.id, quantity: 2, optionIds: [barako.options.get("Less sugar") ?? ""] },
        ],
        dropoff: AYALA,
        tipCentavos: 0,
        promoCode: campaignCode(this),
        paymentMethod: "cod",
        address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000103" },
      },
      headers: { "Idempotency-Key": `bdd-promo-${randomUUID()}` },
    });
    assert.equal(response.status, 201, response.bodyText);
  },
);

When("the admin switches the campaign off", async function (this: KlikWorld) {
  assert.ok(this.ops.admin && this.retention.campaign);
  const response = await this.ops.admin.client.post(
    `/api/admin/promos/${this.retention.campaign.id}`,
    {
      isActive: false,
    },
  );
  assert.equal(response.status, 200, response.bodyText);
});

Then("the coordinator cannot list or create campaigns", async function (this: KlikWorld) {
  assert.ok(this.ops.coordinator);
  const list = await this.ops.coordinator.client.request("GET", "/api/admin/promos");
  assert.equal(list.status, 403, list.bodyText);
  const create = await this.ops.coordinator.client.post("/api/admin/promos", {
    code: "NOTALLOWED1",
    type: "free_delivery",
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(create.status, 403, create.bodyText);
});

// ---------------------------------------------------------------------------
// Referrals and loyalty
// ---------------------------------------------------------------------------

async function referralCode(world: KlikWorld, name: string): Promise<string> {
  return data<{ referralCode: string }>(
    await customer(world, name).client.request("GET", "/api/rewards"),
  ).referralCode;
}

async function enterCode(world: KlikWorld, who: string, whose: string): Promise<ApiResponse> {
  return customer(world, who).client.post("/api/rewards/referral", {
    code: await referralCode(world, whose),
  });
}

When(
  "{string} enters {string}'s referral code",
  async function (this: KlikWorld, who: string, whose: string) {
    const response = await enterCode(this, who, whose);
    assert.equal(response.status, 201, response.bodyText);
  },
);

Then(
  "{string} entering {string}'s referral code is refused with {string}",
  async function (this: KlikWorld, who: string, whose: string, message: string) {
    const response = await enterCode(this, who, whose);
    assert.ok(response.status >= 400, response.bodyText);
    assert.equal(errorMessage(response), message);
  },
);

When(
  /^"([^"]+)"'s first order is delivered(?: to "([^"]+)"'s address)?$/,
  async function (this: KlikWorld, name: string, addressOf: string | null | undefined) {
    // Somewhere no other test customer orders to, so the same-address guard stays quiet.
    let dropoff = { lat: 14.5601 + Math.random() / 1000, lng: 121.0151 + Math.random() / 1000 };
    if (addressOf) {
      const [row] = await this.db.query<{ lat: number; lng: number }>(
        `select extensions.st_y(dropoff::extensions.geometry) as lat, extensions.st_x(dropoff::extensions.geometry) as lng
           from public.orders where id = $1`,
        [this.retention.orders.get(addressOf)],
      );
      assert.ok(row, `No order of ${addressOf}`);
      dropoff = { lat: row.lat, lng: row.lng };
    }
    const id = await storedOrder(this, customer(this, name).userId, 20000, dropoff);
    await deliver(this, id);
  },
);

When(
  /^"([^"]+)"'s order of (\d+) centavos is delivered$/,
  async function (this: KlikWorld, name: string, subtotal: string) {
    await deliver(this, await storedOrder(this, customer(this, name).userId, Number(subtotal)));
  },
);

interface Rewards {
  referredBy: { status: string } | null;
  stamps: { count: number };
  vouchers: { code: string; type: string; source: string; discountCentavos: number | null }[];
}

async function rewards(world: KlikWorld, name: string): Promise<Rewards> {
  return data<Rewards>(await customer(world, name).client.request("GET", "/api/rewards"));
}

Then(
  "{string} and {string} each have a {int} centavo voucher",
  async function (this: KlikWorld, first: string, second: string, amount: number) {
    for (const name of [first, second]) {
      const mine = await rewards(this, name);
      assert.deepEqual(
        mine.vouchers.map((v) => [v.type, v.source, v.discountCentavos]),
        [["fixed_off", "referral", amount]],
        name,
      );
    }
  },
);

Then(
  /^"([^"]+)"'s voucher takes (\d+ centavos|the delivery fee) off their checkout$/,
  async function (this: KlikWorld, name: string, amount: string) {
    const [voucher] = (await rewards(this, name)).vouchers;
    assert.ok(voucher, `${name} has no voucher`);
    const priced = data<{
      promo: { discountCentavos: number } | null;
      promoError: string | null;
      quote: { deliveryFeeCentavos: number };
    }>(await quote(this, customer(this, name), voucher.code));
    assert.equal(priced.promoError, null);
    const expected =
      amount === "the delivery fee"
        ? priced.quote.deliveryFeeCentavos
        : Number.parseInt(amount, 10);
    assert.ok(expected > 0);
    assert.equal(priced.promo?.discountCentavos, expected);
  },
);

Then(
  "{string}'s referral is void and nobody has a referral voucher",
  async function (this: KlikWorld, name: string) {
    assert.equal((await rewards(this, name)).referredBy?.status, "void");
    for (const who of this.retention.customers.keys()) {
      assert.deepEqual((await rewards(this, who)).vouchers, [], who);
    }
  },
);

Given("{string} has {int} stamps", async function (this: KlikWorld, name: string, stamps: number) {
  const userId = customer(this, name).userId;
  for (let i = 0; i < stamps; i += 1) {
    const id = await storedOrder(this, userId, 20000);
    await deliver(this, id);
    // Stamped already, as the rewards job would have done on an earlier run.
    await this.db.query("update public.orders set rewards_processed_at = now() where id = $1", [
      id,
    ]);
    await this.db.query(
      "insert into public.loyalty_stamps (customer_id, order_id) values ($1, $2)",
      [userId, id],
    );
  }
});

Then(
  "{string} has a free-delivery voucher and an empty stamp card",
  async function (this: KlikWorld, name: string) {
    const mine = await rewards(this, name);
    assert.equal(mine.stamps.count, 0);
    assert.deepEqual(
      mine.vouchers.map((v) => [v.type, v.source]),
      [["free_delivery", "loyalty"]],
    );
  },
);

Then(
  "{string}'s stamp card shows {int} stamps",
  async function (this: KlikWorld, name: string, count: number) {
    assert.equal((await rewards(this, name)).stamps.count, count);
  },
);

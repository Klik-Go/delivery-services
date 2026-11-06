import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { Before, Given, Then, When } from "@cucumber/cucumber";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signInWithPhone } from "../support/phone-session";
import { signedInStaff } from "../support/staff-session";
import { randomIp, TEST_PHONES } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

const AYALA = { lat: 14.5547, lng: 121.0244 };
const STORE = "Kape't Tinapay";
const ALL_DAY = { open: "00:00", close: "23:59" };
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;

interface Placed {
  orderId: string;
  code: string;
  status: string;
  totalCentavos: number;
  checkoutUrl: string | null;
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

/** Remembers a seeded store's settings and puts them back after the scenario. */
async function keepStore(world: KlikWorld, name: string): Promise<string> {
  const [store] = await world.db.query<{
    id: string;
    hours: unknown;
    is_open: boolean;
    accepts_cod: boolean;
  }>(`select id, hours, is_open, accepts_cod from public.merchants where name = $1`, [name]);
  assert.ok(store, `No store ${name}`);
  world.merchant.cleanups.push(async () => {
    await world.db.query(
      `update public.merchants set hours = $2, is_open = $3, accepts_cod = $4 where id = $1`,
      [store.id, JSON.stringify(store.hours), store.is_open, store.accepts_cod],
    );
  });
  return store.id;
}

// Webhook scenarios sign events with the run's secret (CI generates one; see ci.yml).
Before({ tags: "@payments or @ledger" }, function () {
  return WEBHOOK_SECRET ? undefined : "skipped";
});

// The seeded store keeps lunch and dinner hours; checkout scenarios run at any time of day, so
// the store is open all day for them (and restored afterwards).
Before({ tags: "@checkout or @payments or @ledger" }, async function (this: KlikWorld) {
  const id = await keepStore(this, STORE);
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  await this.db.query(`update public.merchants set hours = $2, is_open = true where id = $1`, [
    id,
    JSON.stringify(Object.fromEntries(days.map((day) => [day, [ALL_DAY]]))),
  ]);
});

Given("a signed-in customer delivering to Ayala Avenue, Makati", async function (this: KlikWorld) {
  this.api.headers.set("x-forwarded-for", randomIp());
  const customerId = await signInWithPhone(this.api, TEST_PHONES.customer);
  this.checkout.customerId = customerId;
  this.discovery.location = AYALA;
  // The same test customer orders in every run: give the per-customer promo limit a fresh start.
  await this.db.query(`delete from public.promo_redemptions where user_id = $1`, [customerId]);
});

async function cart(
  world: KlikWorld,
  store: string,
  item: string,
  quantity: number,
  option?: string,
): Promise<{
  merchantId: string;
  items: { itemId: string; quantity: number; optionIds: string[] }[];
}> {
  const rows = await world.db.query<{
    merchant_id: string;
    item_id: string;
    option_id: string | null;
  }>(
    `select m.id as merchant_id, i.id as item_id, o.id as option_id
     from public.merchants m join public.menu_items i on i.merchant_id = m.id
     left join public.modifier_groups g on g.menu_item_id = i.id
     left join public.modifier_options o on o.modifier_group_id = g.id and o.name = $3
     where m.name = $1 and i.name = $2`,
    [store, item, option ?? null],
  );
  const row = option ? rows.find((r) => r.option_id) : rows[0];
  assert.ok(row, `${store} has no ${item}${option ? ` with ${option}` : ""}`);
  return {
    merchantId: row.merchant_id,
    items: [{ itemId: row.item_id, quantity, optionIds: row.option_id ? [row.option_id] : [] }],
  };
}

function orderBody(
  base: Awaited<ReturnType<typeof cart>>,
  paymentMethod: string,
  extra: { promoCode?: string; tipCentavos?: number } = {},
): Record<string, unknown> {
  return {
    ...base,
    dropoff: AYALA,
    paymentMethod,
    tipCentavos: extra.tipCentavos ?? 0,
    ...(extra.promoCode ? { promoCode: extra.promoCode } : {}),
    address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000103" },
  };
}

async function placeOrder(
  world: KlikWorld,
  body: Record<string, unknown>,
  key = `bdd-${randomUUID()}`,
  client: ApiClient = world.api,
): Promise<ApiResponse> {
  world.checkout.idempotencyKey = key;
  const response = await client.request("POST", "/api/orders", {
    json: body,
    headers: { "Idempotency-Key": key },
  });
  world.lastResponse = response;
  if (response.status === 201) world.checkout.orderId = data<Placed>(response).orderId;
  return response;
}

const ORDER = /^they order (\d+) "([^"]+)"(?: with "([^"]+)")? from "([^"]+)" paying "([^"]+)"(?: with promo "([^"]+)")?(?: with a (\d+) centavo tip)?$/;
const ORDERED = new RegExp(ORDER.source.replace("^they order ", "^they ordered "));

async function orderStep(
  this: KlikWorld,
  quantity: string,
  item: string,
  option: string | undefined,
  store: string,
  method: string,
  promo: string | undefined,
  tip: string | undefined,
): Promise<void> {
  const base = await cart(this, store, item, Number(quantity), option);
  await placeOrder(
    this,
    orderBody(base, method, {
      ...(promo ? { promoCode: promo } : {}),
      ...(tip ? { tipCentavos: Number(tip) } : {}),
    }),
  );
}

When(ORDER, orderStep);
Given(ORDERED, async function (
  this: KlikWorld,
  quantity: string,
  item: string,
  option: string | undefined,
  store: string,
  method: string,
  promo: string | undefined,
  tip: string | undefined,
) {
  await orderStep.call(this, quantity, item, option, store, method, promo, tip);
  assert.equal(this.response().status, 201, this.response().bodyText);
});

async function orderRow(world: KlikWorld) {
  assert.ok(world.checkout.orderId, "No order in this scenario");
  const [row] = await world.db.query<{
    status: string;
    code: string;
    total_centavos: number;
    payment_status: string;
  }>(
    `select status::text, code, total_centavos, payment_status::text from public.orders where id = $1`,
    [world.checkout.orderId],
  );
  assert.ok(row, "Order not found");
  return row;
}

Then("the order is {string} with a KG- code", async function (this: KlikWorld, status: string) {
  assert.equal(this.response().status, 201, this.response().bodyText);
  const placed = data<Placed>(this.response());
  assert.equal(placed.status, status);
  assert.match(placed.code, /^KG-[A-Z2-9]{6}$/);
  assert.deepEqual(
    { status: (await orderRow(this)).status, code: (await orderRow(this)).code },
    { status, code: placed.code },
  );
});

Then(/^the order (?:is|stays) "([^"]+)"$/, async function (this: KlikWorld, status: string) {
  assert.equal((await orderRow(this)).status, status);
});

Then("the order charges {int} centavos", async function (this: KlikWorld, centavos: number) {
  assert.equal(this.response().status, 201, this.response().bodyText);
  assert.equal(data<Placed>(this.response()).totalCentavos, centavos);
  assert.equal((await orderRow(this)).total_centavos, centavos);
});

Then("the order history starts with {string}", async function (this: KlikWorld, status: string) {
  const events = await this.db.query<{ from_status: string | null; to_status: string }>(
    `select from_status::text, to_status::text from public.order_events where order_id = $1 order by id`,
    [this.checkout.orderId],
  );
  assert.deepEqual(events[0], { from_status: null, to_status: status });
});

Then("they are sent to a payment page", function (this: KlikWorld) {
  const placed = data<Placed>(this.response());
  assert.ok(placed.checkoutUrl, "No payment page in the answer");
  assert.match(placed.checkoutUrl, /^(https:\/\/checkout\.paymongo\.com\/|\/dev\/pay\?session=)/);
});

When(
  "they send the same order twice with one Idempotency-Key paying {string}",
  async function (this: KlikWorld, method: string) {
    const body = orderBody(await cart(this, STORE, "Kapeng Barako", 2, "Less sugar"), method);
    const key = `bdd-double-${randomUUID()}`;
    this.checkout.idempotencyKey = key;
    // Both taps leave before either answer comes back.
    this.responses = await Promise.all(
      [0, 1].map(() =>
        this.api.request("POST", "/api/orders", {
          json: body,
          headers: { "Idempotency-Key": key },
        }),
      ),
    );
  },
);

Then("both answers name the same order", function (this: KlikWorld) {
  for (const response of this.responses) assert.equal(response.status, 201, response.bodyText);
  const ids = this.responses.map((r) => data<Placed>(r).orderId);
  assert.equal(new Set(ids).size, 1, ids.join(", "));
});

async function ordersWithKey(world: KlikWorld): Promise<number> {
  const [row] = await world.db.query<{ n: number }>(
    `select count(*)::int as n from public.orders where customer_id = $1 and idempotency_key = $2`,
    [world.checkout.customerId, world.checkout.idempotencyKey],
  );
  return row?.n ?? 0;
}

Then("only one order exists for that key", async function (this: KlikWorld) {
  assert.equal(await ordersWithKey(this), 1);
});

Then("no order was created", async function (this: KlikWorld) {
  assert.equal(await ordersWithKey(this), 0);
});

Given(
  "they placed an order with an Idempotency-Key paying {string}",
  async function (this: KlikWorld, method: string) {
    const response = await placeOrder(
      this,
      orderBody(await cart(this, STORE, "Kapeng Barako", 2, "Less sugar"), method),
    );
    assert.equal(response.status, 201, response.bodyText);
  },
);

When("they send a different cart with that Idempotency-Key", async function (this: KlikWorld) {
  await placeOrder(
    this,
    orderBody(await cart(this, STORE, "Kapeng Barako", 3, "Less sugar"), "cod"),
    this.checkout.idempotencyKey,
  );
});

Then(
  "the promo {string} is redeemed once for that order",
  async function (this: KlikWorld, code: string) {
    const rows = await this.db.query<{ discount_centavos: number }>(
      `select r.discount_centavos from public.promo_redemptions r join public.promos p on p.id = r.promo_id
       where p.code = $1 and r.order_id = $2`,
      [code, this.checkout.orderId],
    );
    assert.equal(rows.length, 1);
  },
);

Given("{string} is closed", async function (this: KlikWorld, store: string) {
  const id = await keepStore(this, store);
  await this.db.query(`update public.merchants set is_open = false where id = $1`, [id]);
});

Given("{string} does not accept cash on delivery", async function (this: KlikWorld, store: string) {
  const id = await keepStore(this, store);
  await this.db.query(`update public.merchants set accepts_cod = false where id = $1`, [id]);
});

When("someone who is not signed in places an order", async function (this: KlikWorld) {
  const body = orderBody(await cart(this, STORE, "Kapeng Barako", 2, "Less sugar"), "cod");
  await placeOrder(this, body, `bdd-guest-${randomUUID()}`, new ApiClient(BASE_URL));
});

// ---------- PayMongo webhooks ----------

async function paymentRow(world: KlikWorld) {
  const [row] = await world.db.query<{
    intent_id: string;
    amount_centavos: number;
    status: string;
    fee_centavos: number | null;
    refunded_centavos: number;
  }>(
    `select intent_id, amount_centavos, status::text, fee_centavos, refunded_centavos
     from public.payments where order_id = $1`,
    [world.checkout.orderId],
  );
  assert.ok(row, "No payment for the order");
  return row;
}

function signature(secret: string, body: string): string {
  const t = String(Math.floor(Date.now() / 1000));
  const te = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},te=${te},li=`;
}

async function sendWebhook(world: KlikWorld, body: string, secret = WEBHOOK_SECRET ?? "") {
  world.checkout.webhookBody = body;
  world.lastResponse = await world.api.request("POST", "/api/webhooks/paymongo", {
    body,
    headers: { "content-type": "application/json", "paymongo-signature": signature(secret, body) },
  });
  world.checkout.webhookStatus = world.lastResponse.status;
}

function event(type: string, data: unknown): string {
  return JSON.stringify({
    data: {
      id: `evt_bdd_${randomUUID().replaceAll("-", "")}`,
      type: "event",
      attributes: { type, livemode: false, data },
    },
  });
}

async function paidEvent(world: KlikWorld, fee: number): Promise<string> {
  const payment = await paymentRow(world);
  return event("checkout_session.payment.paid", {
    id: payment.intent_id,
    type: "checkout_session",
    attributes: {
      payments: [
        {
          id: `pay_bdd_${randomUUID().replaceAll("-", "")}`,
          type: "payment",
          attributes: {
            amount: payment.amount_centavos,
            fee,
            net_amount: payment.amount_centavos - fee,
            status: "paid",
          },
        },
      ],
    },
  });
}

const CONFIRMS = /^PayMongo confirms the payment with a gateway fee of (\d+) centavos$/;
async function confirm(this: KlikWorld, fee: string): Promise<void> {
  await sendWebhook(this, await paidEvent(this, Number(fee)));
  assert.equal(this.response().status, 200, this.response().bodyText);
}
When(CONFIRMS, confirm);

When("PayMongo sends the same confirmation again", async function (this: KlikWorld) {
  assert.ok(this.checkout.webhookBody, "No confirmation to replay");
  await sendWebhook(this, this.checkout.webhookBody);
  assert.equal(this.response().status, 200, this.response().bodyText);
  assert.equal(data<{ outcome: string }>(this.response()).outcome, "duplicate");
});

When(
  "someone sends a payment confirmation with a wrong signature",
  async function (this: KlikWorld) {
    await sendWebhook(this, await paidEvent(this, 450), "whsk_not_the_secret");
  },
);

When("PayMongo reports that the payment failed", async function (this: KlikWorld) {
  await sendWebhook(
    this,
    event("payment.failed", { id: `pay_bdd_${randomUUID()}`, type: "payment", attributes: {} }),
  );
});

Then("the webhook answer is {int}", function (this: KlikWorld, status: number) {
  assert.equal(this.checkout.webhookStatus, status, this.response().bodyText);
});

Then(
  "the payment is {string} with a fee of {int} centavos",
  async function (this: KlikWorld, status: string, fee: number) {
    const payment = await paymentRow(this);
    assert.deepEqual({ status: payment.status, fee: payment.fee_centavos }, { status, fee });
  },
);

async function ledger(world: KlikWorld) {
  return world.db.query<{
    txn_id: string;
    account: string;
    debit_centavos: number;
    credit_centavos: number;
  }>(
    `select txn_id, account::text, debit_centavos, credit_centavos
     from public.ledger_entries where order_id = $1 order by id`,
    [world.checkout.orderId],
  );
}

Then(
  "the payment is held in the ledger as the customer's deposit",
  async function (this: KlikWorld) {
    const { amount_centavos } = await paymentRow(this);
    const deposits = (await ledger(this)).filter((e) => e.account === "customer_deposits");
    assert.equal(
      deposits.reduce((sum, e) => sum + e.credit_centavos - e.debit_centavos, 0),
      amount_centavos,
    );
  },
);

Then("the ledger holds exactly one capture for the order", async function (this: KlikWorld) {
  const captures = new Set(
    (await ledger(this)).filter((e) => e.account === "gateway_fees").map((e) => e.txn_id),
  );
  assert.equal(captures.size, 1);
});

Then("the order's ledger balances", async function (this: KlikWorld) {
  const entries = await ledger(this);
  assert.ok(entries.length > 0, "The order has no ledger entries");
  const byTxn = new Map<string, number>();
  for (const e of entries) {
    byTxn.set(e.txn_id, (byTxn.get(e.txn_id) ?? 0) + e.debit_centavos - e.credit_centavos);
  }
  for (const [txn, net] of byTxn)
    assert.equal(net, 0, `Transaction ${txn} is off by ${String(net)}`);
});

Then(
  "the gateway fee of {int} centavos is recorded as an expense",
  async function (this: KlikWorld, fee: number) {
    const fees = (await ledger(this)).filter((e) => e.account === "gateway_fees");
    assert.equal(
      fees.reduce((sum, e) => sum + e.debit_centavos - e.credit_centavos, 0),
      fee,
    );
  },
);

Given("the order was cancelled because it was not paid in time", async function (this: KlikWorld) {
  await this.db.query(
    `update public.orders set created_at = now() - interval '20 minutes' where id = $1`,
    [this.checkout.orderId],
  );
  await this.db.query(`select private.cancel_unpaid_orders()`);
  assert.equal((await orderRow(this)).status, "cancelled");
});

Then("the whole payment is refunded through PayMongo", async function (this: KlikWorld) {
  const payment = await paymentRow(this);
  assert.deepEqual(
    { status: payment.status, refunded: payment.refunded_centavos },
    { status: "refunded", refunded: payment.amount_centavos },
  );
  const refunds = await this.db.query<{ amount_centavos: number; gateway_ref: string | null }>(
    `select amount_centavos, gateway_ref from public.refunds where order_id = $1`,
    [this.checkout.orderId],
  );
  assert.equal(refunds.length, 1);
  assert.ok(refunds[0]?.gateway_ref, "The refund has no gateway reference");
});

// ---------- refunds ----------

Given("a signed-in admin", async function (this: KlikWorld) {
  this.checkout.adminApi = (await signedInStaff(this, "admin")).client;
});

async function refund(world: KlikWorld, client: ApiClient, amount: number, reason: string) {
  world.lastResponse = await client.post(
    `/api/admin/orders/${world.checkout.orderId ?? ""}/refunds`,
    {
      amountCentavos: amount,
      reason,
    },
  );
}

When(
  "the admin refunds {int} centavos of the order because {string}",
  async function (this: KlikWorld, amount: number, reason: string) {
    assert.ok(this.checkout.adminApi, "No admin signed in");
    await refund(this, this.checkout.adminApi, amount, reason);
  },
);

When("the customer tries to refund their own order", async function (this: KlikWorld) {
  await refund(this, this.api, 1000, "I changed my mind");
});

Then(
  "the payment is {string} with {int} centavos refunded",
  async function (this: KlikWorld, status: string, refunded: number) {
    assert.equal(this.response().status, 201, this.response().bodyText);
    const payment = await paymentRow(this);
    assert.deepEqual(
      { status: payment.status, refunded: payment.refunded_centavos },
      { status, refunded },
    );
  },
);

Then(
  "the refund is recorded with reason {string}",
  async function (this: KlikWorld, reason: string) {
    const rows = await this.db.query<{ reason: string }>(
      `select reason from public.refunds where order_id = $1`,
      [this.checkout.orderId],
    );
    assert.deepEqual(
      rows.map((r) => r.reason),
      [reason],
    );
  },
);

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Given, Then, When } from "@cucumber/cucumber";
import { LEGAL_VERSIONS } from "@klikgo/types";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signedInStaff } from "../support/staff-session";
import { randomIp, randomMobile } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

const PLACEHOLDER = process.env.PLACEHOLDER_OTP_CODE;
const AYALA = { lat: 14.5547, lng: 121.0244 };

interface PilotScenario {
  customer?: { client: ApiClient; userId: string; next: string };
  codes: Map<string, string[]>;
  lastCode?: string;
  waiting: string[];
  kpis?: ApiResponse;
}
const scenarios = new WeakMap<KlikWorld, PilotScenario>();
function pilot(world: KlikWorld): PilotScenario {
  const found = scenarios.get(world) ?? { codes: new Map(), waiting: [] };
  scenarios.set(world, found);
  return found;
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function message(response: ApiResponse | undefined): string {
  return (response?.json as { error?: { message?: string } } | undefined)?.error?.message ?? "";
}

async function admin(world: KlikWorld): Promise<ApiClient> {
  world.ops.admin ??= await signedInStaff(world, "admin");
  return world.ops.admin.client;
}

/** Sets a flag through the admin API and puts it back after the scenario. */
async function setFlag(
  world: KlikWorld,
  key: string,
  enabled: boolean,
  rollout: Record<string, unknown>,
): Promise<void> {
  const client = await admin(world);
  const [before] = await world.db.query<{ enabled: boolean; rollout: Record<string, unknown> }>(
    "select enabled, rollout from public.feature_flags where key = $1",
    [key],
  );
  const put = (on: boolean, settings: Record<string, unknown>) =>
    client.request("PUT", `/api/admin/settings/flags/${key}`, {
      json: { enabled: on, rollout: settings },
    });
  const response = await put(enabled, rollout);
  assert.equal(response.status, 200, response.bodyText);
  world.hardening.cleanups.push(async () => {
    await put(before?.enabled ?? false, before?.rollout ?? {});
  });
}

async function signIn(client: ApiClient, phone: string): Promise<string> {
  const requested = await client.post("/api/auth/otp", { phone });
  assert.equal(requested.status, 200, requested.bodyText);
  const verified = await client.post("/api/auth/otp/verify", { phone, code: PLACEHOLDER });
  assert.equal(verified.status, 200, verified.bodyText);
  return data<{ next: string }>(verified).next;
}

/** A brand-new customer who signs in and agrees to the terms. */
async function newCustomer(): Promise<{ client: ApiClient; userId: string; next: string }> {
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  const next = await signIn(client, randomMobile());
  const agreed = await client.post("/api/me/consents", LEGAL_VERSIONS);
  assert.equal(agreed.status, 201, agreed.bodyText);
  const me = data<{ userId: string }>(await client.request("GET", "/api/me"));
  return { client, userId: me.userId, next };
}

async function codOrder(world: KlikWorld, client: ApiClient, store: string): Promise<ApiResponse> {
  const [row] = await world.db.query<{ merchant_id: string; item_id: string }>(
    `select m.id as merchant_id, i.id as item_id from public.merchants m
       join public.menu_items i on i.merchant_id = m.id
      where m.name = $1 and i.is_available
        and not exists (select 1 from public.modifier_groups g
                         where g.menu_item_id = i.id and (g.is_required or g.min_select > 0))
      order by i.price_centavos desc limit 1`,
    [store],
  );
  assert.ok(row, `${store} has no plain item`);
  // Scenarios run at any hour; the seeded store keeps lunch and dinner hours, so open it all day.
  const allDay = [{ open: "00:00", close: "23:59" }];
  await world.db.query(`update public.merchants set hours = $2, is_open = true where id = $1`, [
    row.merchant_id,
    JSON.stringify(
      Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, allDay])),
    ),
  ]);
  return client.request("POST", "/api/orders", {
    json: {
      merchantId: row.merchant_id,
      items: [{ itemId: row.item_id, quantity: 2, optionIds: [] }],
      dropoff: AYALA,
      paymentMethod: "cod",
      tipCentavos: 0,
      address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000103" },
    },
    headers: { "Idempotency-Key": `bdd-${randomUUID()}` },
  });
}

/** Cancels an order the scenario placed, so the store's queue stays clean. */
async function cancel(world: KlikWorld, orderId: string): Promise<void> {
  await world.db.query(
    "select set_config('klikgo.actor_role', 'admin', false), set_config('klikgo.actor_id', '', false)",
  );
  await world.db.query(
    `update public.orders set status = 'cancelled', cancel_reason = 'Test', cancelled_by_role = 'admin'
      where id = $1 and status = 'placed'`,
    [orderId],
  );
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

Given(
  "the pilot is invite-only for {int} customers",
  async function (this: KlikWorld, max: number) {
    if (!PLACEHOLDER) return "skipped";
    await setFlag(this, "invite_only", true, { max_customers: max });
    return undefined;
  },
);

Given("the pilot is invite-only and already full", async function (this: KlikWorld) {
  if (!PLACEHOLDER) return "skipped";
  const [row] = await this.db.query<{ n: number }>(
    "select count(*)::int as n from public.pilot_invites where redeemed_by is not null",
  );
  let used = row?.n ?? 0;
  if (used === 0) {
    // Someone has to hold the only place.
    const filler = await newCustomer();
    await this.db.query(
      `insert into public.pilot_invites (code, batch, redeemed_by, redeemed_at)
       values ($1, 'Test filler', $2, now())`,
      [
        `F${randomUUID()
          .slice(0, 8)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "Q")}`,
        filler.userId,
      ],
    );
    used = 1;
  }
  await setFlag(this, "invite_only", true, { max_customers: used });
  return undefined;
});

When("a new customer signs in during the pilot", async function (this: KlikWorld) {
  pilot(this).customer = await newCustomer();
});

Then("they are asked for an invite code after agreeing to the terms", function (this: KlikWorld) {
  const next = pilot(this).customer?.next ?? "";
  assert.match(next, /^\/consent\?next=/);
  const afterConsent = new URLSearchParams(next.split("?")[1]).get("next") ?? "";
  assert.match(afterConsent, /^\/join\?next=/);
});

Then(
  "placing a cash on delivery order from {string} is refused with {string}",
  async function (this: KlikWorld, store: string, expected: string) {
    const customer = pilot(this).customer;
    assert.ok(customer);
    const response = await codOrder(this, customer.client, store);
    assert.equal(response.status, 403, response.bodyText);
    assert.ok(message(response).includes(expected), message(response));
  },
);

Given(
  /^an admin creates (\d+) invite codes? in batch "([^"]+)"$/,
  async function (this: KlikWorld, count: string, batch: string) {
    const response = await (
      await admin(this)
    ).post("/api/admin/pilot-invites", {
      batch,
      count: Number(count),
    });
    assert.equal(response.status, 201, response.bodyText);
    pilot(this).codes.set(batch, [...data<{ codes: string[] }>(response).codes]);
  },
);

When("they enter one of the {string} codes", async function (this: KlikWorld, batch: string) {
  const state = pilot(this);
  const code = state.codes.get(batch)?.shift();
  assert.ok(code && state.customer, `No ${batch} code left`);
  state.lastCode = code;
  // Typed as people do: lower case with a space.
  this.lastResponse = await state.customer.client.post("/api/invites/redeem", {
    code: `${code.slice(0, 4).toLowerCase()} ${code.slice(4)}`,
  });
});

Then(
  "placing a cash on delivery order from {string} works",
  async function (this: KlikWorld, store: string) {
    assert.equal(this.lastResponse?.status, 200, this.lastResponse?.bodyText ?? "");
    const customer = pilot(this).customer;
    assert.ok(customer);
    const response = await codOrder(this, customer.client, store);
    assert.equal(response.status, 201, response.bodyText);
    await cancel(this, data<{ orderId: string }>(response).orderId);
  },
);

Then("another customer cannot use the same code", async function (this: KlikWorld) {
  const other = await newCustomer();
  const response = await other.client.post("/api/invites/redeem", { code: pilot(this).lastCode });
  assert.equal(response.status, 400, response.bodyText);
  assert.match(message(response), /already used/);
});

Then("the code is refused with {string}", function (this: KlikWorld, expected: string) {
  assert.equal(this.lastResponse?.status, 409, this.lastResponse?.bodyText ?? "");
  assert.ok(message(this.lastResponse).includes(expected), message(this.lastResponse));
});

Given("{int} people are waiting on the waitlist", async function (this: KlikWorld, n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    // Older than anyone real, so they are the first in line.
    const [row] = await this.db.query<{ id: string }>(
      `insert into public.waitlist_signups (name, phone, barangay, location, created_at)
       values ($1, $2, 'Poblacion', extensions.st_setsrid(extensions.st_makepoint(121.0, 14.5), 4326)::extensions.geography,
               timestamptz '1999-01-01' + make_interval(secs => $3))
       returning id`,
      [`Waiting ${String(i + 1)}`, randomMobile(), Math.floor(Math.random() * 1_000_000) + i],
    );
    if (row) ids.push(row.id);
  }
  pilot(this).waiting = ids;
});

When(
  "the admin invites the {int} oldest people on the waitlist",
  async function (this: KlikWorld, count: number) {
    this.lastResponse = await (
      await admin(this)
    ).post("/api/admin/pilot-invites/waitlist", { count });
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

async function waitlistInvites(world: KlikWorld): Promise<{ code: string; sent: boolean }[]> {
  return world.db.query<{ code: string; sent: boolean }>(
    `select code, sent_at is not null as sent from public.pilot_invites where waitlist_id = any($1)`,
    [pilot(world).waiting],
  );
}

Then("each of them is sent their own invite code", async function (this: KlikWorld) {
  const invites = await waitlistInvites(this);
  assert.equal(invites.length, pilot(this).waiting.length);
  assert.equal(new Set(invites.map((i) => i.code)).size, invites.length);
  assert.ok(
    invites.every((i) => i.sent),
    "Some codes were not texted",
  );
});

Then("inviting the waitlist again sends nothing to them", async function (this: KlikWorld) {
  const again = await (await admin(this)).post("/api/admin/pilot-invites/waitlist", { count: 2 });
  assert.equal(again.status, 200, again.bodyText);
  assert.equal((await waitlistInvites(this)).length, pilot(this).waiting.length);
});

// ---------------------------------------------------------------------------
// Pilot scope
// ---------------------------------------------------------------------------

Given(
  "an admin limits the pilot to food stores and turns off scheduled orders",
  async function (this: KlikWorld) {
    if (!PLACEHOLDER) return "skipped";
    await setFlag(this, "pilot_scope", true, { categories: ["food"] });
    await setFlag(this, "scheduled_orders", false, {});
    return undefined;
  },
);

When("a customer looks at stores around Ayala Avenue", async function (this: KlikWorld) {
  this.lastResponse = await new ApiClient(BASE_URL).request(
    "GET",
    `/api/feed?lat=${String(AYALA.lat)}&lng=${String(AYALA.lng)}`,
  );
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then("every store they see is a food store", function (this: KlikWorld) {
  const feed = data<{ stores: { category: string }[]; categories: string[] }>(
    this.lastResponse as ApiResponse,
  );
  assert.ok(feed.stores.length > 0, "No stores at all");
  assert.ok(feed.stores.every((s) => s.category === "food"));
  assert.deepEqual(feed.categories, ["food"]);
});

Then("checkout offers no delivery times for later", async function (this: KlikWorld) {
  const customer = await newCustomer();
  const [row] = await this.db.query<{ merchant_id: string; item_id: string }>(
    `select m.id as merchant_id, i.id as item_id from public.merchants m
       join public.menu_items i on i.merchant_id = m.id
      where m.name = 'Kape''t Tinapay' and i.is_available
        and not exists (select 1 from public.modifier_groups g
                         where g.menu_item_id = i.id and (g.is_required or g.min_select > 0))
      limit 1`,
  );
  const quote = await customer.client.post("/api/checkout/quote", {
    merchantId: row?.merchant_id,
    items: [{ itemId: row?.item_id, quantity: 2, optionIds: [] }],
    dropoff: AYALA,
    paymentMethod: "cod",
    tipCentavos: 0,
  });
  assert.equal(quote.status, 200, quote.bodyText);
  assert.deepEqual(data<{ slots: string[] }>(quote).slots, []);
});

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

Given(
  "a cash on delivery order from {string} was delivered today",
  async function (this: KlikWorld, store: string) {
    const [row] = await this.db.query<{
      merchant_id: string;
      zone_id: string;
      customer_id: string;
    }>(
      `select m.id as merchant_id, m.zone_id,
              (select r.user_id from public.user_roles r where r.role = 'customer' limit 1) as customer_id
         from public.merchants m where m.name = $1`,
      [store],
    );
    assert.ok(row);
    const [order] = await this.db.query<{ id: string }>(
      `insert into public.orders (code, customer_id, merchant_id, zone_id, status, payment_method,
         subtotal_centavos, delivery_fee_centavos, total_centavos, address_snapshot, dropoff)
       values ($1, $2, $3, $4, 'placed', 'cod', 25000, 3900, 28900, '{"barangay": "Poblacion"}',
               extensions.st_setsrid(extensions.st_makepoint($5, $6), 4326)::extensions.geography)
       returning id`,
      [
        `KG-${randomUUID().slice(0, 6).toUpperCase()}`,
        row.customer_id,
        row.merchant_id,
        row.zone_id,
        AYALA.lng,
        AYALA.lat,
      ],
    );
    await this.db.query(
      "select set_config('klikgo.actor_role', 'admin', false), set_config('klikgo.actor_id', '', false)",
    );
    for (const status of ["accepted", "preparing", "ready", "picked_up", "delivered"]) {
      await this.db.query("update public.orders set status = $2 where id = $1", [
        order?.id,
        status,
      ]);
    }
  },
);

When("the admin opens the KPI dashboard", async function (this: KlikWorld) {
  const state = pilot(this);
  state.kpis = await (await admin(this)).request("GET", "/api/admin/kpis");
  assert.equal(state.kpis.status, 200, state.kpis.bodyText);
});

interface PeriodWire {
  label: string;
  figures: { placed: number; delivered: number; gmvCentavos: number };
  aovCentavos: number | null;
  completionBps: number | null;
  codShareBps: number | null;
  confirmSeconds: number | null;
  deliveryMinutes: number | null;
  utilisationBps: number | null;
  riderEarningsPerHourCentavos: number | null;
}
function dashboard(world: KlikWorld): {
  periods: PeriodWire[];
  days: unknown[];
  targets: { confirmSeconds: number; deliveryMinutes: number };
} {
  const response = pilot(world).kpis;
  assert.ok(response);
  return data(response);
}

Then(
  "it shows orders, GMV, average order value, completion rate and cash share for today, 7 and 30 days",
  function (this: KlikWorld) {
    const { periods, days } = dashboard(this);
    assert.deepEqual(
      periods.map((p) => p.label),
      ["today", "7d", "30d"],
    );
    const today = periods[0];
    assert.ok(today && today.figures.delivered >= 1 && today.figures.gmvCentavos > 0);
    assert.ok(today.aovCentavos !== null && today.codShareBps !== null);
    assert.ok("completionBps" in today);
    assert.equal(days.length, 14);
  },
);

Then(
  "it shows store confirmation time and delivery time against their targets",
  function (this: KlikWorld) {
    const { periods, targets } = dashboard(this);
    assert.deepEqual([targets.confirmSeconds, targets.deliveryMinutes], [180, 35]);
    assert.equal(typeof periods[0]?.deliveryMinutes, "number");
  },
);

Then("it shows rider utilisation and earnings per online hour", function (this: KlikWorld) {
  const today = dashboard(this).periods[0];
  assert.ok(today && "utilisationBps" in today && "riderEarningsPerHourCentavos" in today);
});

Then("a coordinator cannot open the KPI dashboard", async function (this: KlikWorld) {
  const [zone] = await this.db.query<{ id: string }>(
    "select id from public.zones where slug = 'makati'",
  );
  const coordinator = await signedInStaff(this, "coordinator", { zoneId: zone?.id ?? "" });
  const response = await coordinator.client.request("GET", "/api/admin/kpis");
  assert.equal(response.status, 403, response.bodyText);
});

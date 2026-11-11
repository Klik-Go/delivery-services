import assert from "node:assert/strict";
import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signInWithPhone } from "../support/phone-session";
import { randomIp } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld, type RiderSession } from "../support/world";

const CRON_SECRET = process.env.CRON_SECRET;

/** The seeded riders (supabase/seed.sql) and their test numbers (supabase/config.toml). */
const RIDERS: Readonly<
  Record<string, { id: string; phone: string; at: { lat: number; lng: number } }>
> = {
  "Rico Rider": {
    id: "5eed0000-0000-4000-8000-000000000201",
    phone: "+639170000021",
    at: { lat: 14.564, lng: 121.028 },
  },
  "Rosa Rider": {
    id: "5eed0000-0000-4000-8000-000000000202",
    phone: "+639170000022",
    at: { lat: 14.559, lng: 121.022 },
  },
  "Rey Rider": {
    id: "5eed0000-0000-4000-8000-000000000203",
    phone: "+639170000023",
    at: { lat: 14.5585, lng: 121.019 },
  },
};
const NEAR_STORE = { lat: 14.5586, lng: 121.0189 };
const SEEDED = ["Rico Rider", "Rosa Rider"].map((name) => RIDERS[name]?.id ?? "");

interface Wire {
  offerId: string;
  orderId: string;
  earningsCentavos: number;
  expiresAt: string;
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function orderId(world: KlikWorld): string {
  assert.ok(world.checkout.orderId, "No order in this scenario");
  return world.checkout.orderId;
}

function rider(world: KlikWorld, name: string): RiderSession {
  const session = world.dispatch.riders.get(name);
  assert.ok(session, `${name} is not signed in`);
  return session;
}

/**
 * Dispatch shares the riders with every other scenario, so each one starts clean: no open offers,
 * no older test orders still waiting for a rider, and nobody holding an unfinished job.
 */
async function resetDispatch(world: KlikWorld): Promise<void> {
  await world.db.query(
    `update public.dispatch_offers set status = 'expired' where status = 'offered'`,
  );
  await world.db.query(
    `update public.orders set status = 'cancelled', cancel_reason = 'test_cleanup', cancelled_by_role = 'admin'
      where status in ('accepted', 'preparing', 'ready') and rider_id is null`,
  );
  await world.db.query(
    `update public.orders set rider_id = null
      where rider_id = any($1::uuid[]) and status in ('accepted', 'preparing', 'ready', 'picked_up')`,
    [SEEDED],
  );
}

Before({ tags: "@dispatch or @rider" }, async function (this: KlikWorld) {
  if (!CRON_SECRET) return "skipped";
  await resetDispatch(this);
  // Cash collected in earlier scenarios is never remitted (remittances are Phase 10), so each
  // scenario gives the riders their full ₱3,000 of room on top of what they already hold.
  await this.db.query(
    `update public.riders r set cash_limit_centavos = 300000 + coalesce((
        select sum(le.debit_centavos - le.credit_centavos) from public.ledger_entries le
         where le.account = 'rider_cash_on_hand' and le.party_id = r.id), 0)
      where r.id = any($1::uuid[])`,
    [SEEDED],
  );
  return undefined;
});

// Put the riders back as seeded but out of reach (their last position is old), so scenarios in
// other features never dispatch to them by accident.
After({ tags: "@dispatch or @rider" }, async function (this: KlikWorld) {
  await resetDispatch(this);
  await this.db.query(
    `update public.riders set is_online = true, cash_limit_centavos = 300000 where id = any($1::uuid[])`,
    [SEEDED],
  );
  await this.db.query(
    `update public.rider_locations set updated_at = now() - interval '1 hour' where rider_id = any($1::uuid[])`,
    [SEEDED],
  );
});

async function signInRider(world: KlikWorld, name: string): Promise<RiderSession> {
  const seeded = RIDERS[name];
  assert.ok(seeded, `No seeded rider ${name}`);
  const client = new ApiClient(BASE_URL);
  client.headers.set("x-forwarded-for", randomIp());
  const userId = await signInWithPhone(client, seeded.phone);
  const session = { client, riderId: seeded.id, userId };
  world.dispatch.riders.set(name, session);
  return session;
}

async function share(
  world: KlikWorld,
  name: string,
  at: { lat: number; lng: number },
): Promise<ApiResponse> {
  // The server keeps one position per 4 seconds; scenarios move riders right away, so the last
  // position is aged first.
  await world.db.query(
    `update public.rider_locations set updated_at = updated_at - interval '10 seconds' where rider_id = $1`,
    [rider(world, name).riderId],
  );
  world.lastResponse = await rider(world, name).client.post("/api/rider/location", at);
  return world.lastResponse;
}

Given(
  "riders {string} and {string} are online near Kape't Tinapay, Rosa the nearest",
  async function (this: KlikWorld, first: string, second: string) {
    for (const name of [first, second]) {
      const session = await signInRider(this, name);
      const online = await session.client.post("/api/rider/status", { online: true });
      assert.equal(online.status, 200, online.bodyText);
      const seeded = RIDERS[name];
      assert.ok(seeded);
      const shared = await share(this, name, seeded.at);
      assert.equal(shared.status, 200, shared.bodyText);
    }
  },
);

async function currentOffer(world: KlikWorld, name: string): Promise<Wire | null> {
  const response = await rider(world, name).client.request("GET", "/api/rider/offers/current");
  assert.equal(response.status, 200, response.bodyText);
  return data<Wire | null>(response);
}

async function offerRows(
  world: KlikWorld,
): Promise<{ rider_id: string; status: string; id: string }[]> {
  return world.db.query(
    `select id, rider_id, status::text from public.dispatch_offers where order_id = $1 order by offered_at`,
    [orderId(world)],
  );
}

Then(
  "{string} is offered the job, with her pay shown and {int} seconds to answer",
  async function (this: KlikWorld, name: string, seconds: number) {
    const offer = await currentOffer(this, name);
    assert.ok(offer, `${name} has no offer`);
    assert.equal(offer.orderId, orderId(this));
    assert.ok(offer.earningsCentavos >= 3500, `pay ${String(offer.earningsCentavos)}`);
    const left = (Date.parse(offer.expiresAt) - Date.now()) / 1000;
    assert.ok(left > seconds - 5 && left <= seconds, `${String(left)} seconds left`);
  },
);

Then("{string} is offered the job", async function (this: KlikWorld, name: string) {
  const offer = await currentOffer(this, name);
  assert.ok(offer, `${name} has no offer`);
  assert.equal(offer.orderId, orderId(this));
});

Then("{string} is never offered the job", async function (this: KlikWorld, name: string) {
  const offers = await offerRows(this);
  assert.ok(!offers.some((o) => o.rider_id === RIDERS[name]?.id), `${name} got an offer`);
});

async function answer(
  world: KlikWorld,
  name: string,
  verb: "accept" | "decline",
  offerOf = name,
): Promise<ApiResponse> {
  const offers = await offerRows(world);
  const offer = [...offers].reverse().find((o) => o.rider_id === RIDERS[offerOf]?.id);
  assert.ok(offer, `${offerOf} has no offer for this order`);
  world.lastResponse = await rider(world, name).client.post(
    `/api/rider/offers/${offer.id}/${verb}`,
    {},
  );
  return world.lastResponse;
}

When("{string} declines the offer", async function (this: KlikWorld, name: string) {
  const response = await answer(this, name, "decline");
  assert.equal(response.status, 200, response.bodyText);
});

When(/^"([^"]+)" accepts the offer(?: again)?$/, async function (this: KlikWorld, name: string) {
  await answer(this, name, "accept");
});

When("{string} tries to accept Rosa's offer", async function (this: KlikWorld, name: string) {
  await answer(this, name, "accept", "Rosa Rider");
});

Given("{string} accepted the offer", async function (this: KlikWorld, name: string) {
  const response = await answer(this, name, "accept");
  assert.equal(response.status, 200, response.bodyText);
  const earnings = data<{
    today: { jobs: number; payCentavos: number; tipCentavos: number };
    cashHeldCentavos: number;
  }>(await rider(this, name).client.request("GET", "/api/rider/earnings"));
  this.dispatch.before = {
    cashHeld: earnings.cashHeldCentavos,
    earned: earnings.today.payCentavos + earnings.today.tipCentavos,
    jobs: earnings.today.jobs,
  };
});

Then("{string} is delivering the order", async function (this: KlikWorld, name: string) {
  const [row] = await this.db.query<{ rider_id: string | null; dispatch_status: string }>(
    `select rider_id, dispatch_status::text from public.orders where id = $1`,
    [orderId(this)],
  );
  assert.deepEqual(row, { rider_id: RIDERS[name]?.id, dispatch_status: "assigned" });
  const job = data<{ orderId: string } | null>(
    await rider(this, name).client.request("GET", "/api/rider/job"),
  );
  assert.equal(job?.orderId, orderId(this));
});

Given(
  "Rosa's offer has been waiting for {int} seconds",
  async function (this: KlikWorld, seconds: number) {
    await this.db.query(
      `update public.dispatch_offers
        set offered_at = offered_at - make_interval(secs => $3), expires_at = expires_at - make_interval(secs => $3)
      where order_id = $1 and rider_id = $2 and status = 'offered'`,
      [orderId(this), RIDERS["Rosa Rider"]?.id, seconds],
    );
  },
);

Then("Rosa's offer has expired", async function (this: KlikWorld) {
  const offers = await offerRows(this);
  assert.equal(offers.find((o) => o.rider_id === RIDERS["Rosa Rider"]?.id)?.status, "expired");
});

Given(
  "{string} can carry only ₱50.00 more cash before reaching her limit",
  async function (this: KlikWorld, name: string) {
    const id = RIDERS[name]?.id;
    const [row] = await this.db.query<{ held: string }>(
      `select coalesce(sum(debit_centavos - credit_centavos), 0)::text as held from public.ledger_entries
        where account = 'rider_cash_on_hand' and party_id = $1`,
      [id],
    );
    await this.db.query(`update public.riders set cash_limit_centavos = $2 where id = $1`, [
      id,
      Number(row?.held ?? 0) + 5000,
    ]);
  },
);

Given(/^"([^"]+)" goes offline$/, async function (this: KlikWorld, name: string) {
  this.lastResponse = await rider(this, name).client.post("/api/rider/status", { online: false });
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then(
  "the order is flagged for the zone coordinator as unassigned",
  async function (this: KlikWorld) {
    const [row] = await this.db.query<{
      dispatch_flagged_at: Date | null;
      rider_id: string | null;
    }>(`select dispatch_flagged_at, rider_id from public.orders where id = $1`, [orderId(this)]);
    assert.ok(row?.dispatch_flagged_at, "The order was not flagged");
    assert.equal(row.rider_id, null);
    const alerts = await this.db.query<{ user_id: string }>(
      `select n.user_id from public.notifications n join public.user_roles r on r.user_id = n.user_id
      where n.order_id = $1 and n.template = 'dispatch_unassigned' and r.role = 'coordinator'`,
      [orderId(this)],
    );
    assert.ok(alerts.length > 0, "The coordinator was not alerted");
  },
);

// --- the rider's job ---------------------------------------------------------------------------

interface JobWire {
  orderId: string;
  status: string;
  contactPhone: string | null;
  cashToCollectCentavos: number;
  dropoff: { landmark: string | null };
}

Then(
  "Rosa's job shows the landmark, a masked contact number and {string}",
  async function (this: KlikWorld, collect: string) {
    const job = data<JobWire | null>(
      await rider(this, "Rosa Rider").client.request("GET", "/api/rider/job"),
    );
    assert.ok(job, "Rosa has no job");
    assert.equal(job.dropoff.landmark, "Blue tower lobby");
    assert.match(job.contactPhone ?? "", /^\+63 ••• ••• \d{4}$/);
    const amount = Number(collect.replace(/[^0-9.]/g, "")) * 100;
    assert.equal(job.cashToCollectCentavos, Math.round(amount));
  },
);

When("{string} arrives at the store", async function (this: KlikWorld, name: string) {
  this.lastResponse = await rider(this, name).client.post(
    `/api/rider/jobs/${orderId(this)}/arrived`,
    {},
  );
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

When(
  /^"([^"]+)" (?:tries to pick|picks) up the order$/,
  async function (this: KlikWorld, name: string) {
    this.lastResponse = await rider(this, name).client.post(
      `/api/rider/jobs/${orderId(this)}/picked-up`,
      {},
    );
  },
);

/** A tiny valid JPEG (1×1), enough for the bucket's type check. */
const PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function deliver(
  world: KlikWorld,
  name: string,
  proof: { pin?: string; photo?: boolean },
): Promise<void> {
  const form = new FormData();
  if (proof.pin) form.set("pin", proof.pin);
  if (proof.photo) form.set("photo", new Blob([PHOTO], { type: "image/jpeg" }), "proof.jpg");
  world.lastResponse = await rider(world, name).client.request(
    "POST",
    `/api/rider/jobs/${orderId(world)}/delivered`,
    { body: form },
  );
}

When("{string} delivers the order with a photo", async function (this: KlikWorld, name: string) {
  await deliver(this, name, { photo: true });
});

When(
  "{string} delivers the order with the PIN {string}",
  async function (this: KlikWorld, name: string, pin: string) {
    await deliver(this, name, { pin });
  },
);

async function customerOrder(world: KlikWorld): Promise<{ deliveryPin: string | null }> {
  return data(await world.api.request("GET", `/api/orders/${orderId(world)}`));
}

Given("the customer's order shows a 4-digit delivery PIN", async function (this: KlikWorld) {
  assert.match((await customerOrder(this)).deliveryPin ?? "", /^\d{4}$/);
});

When(
  "{string} delivers the order with the customer's PIN",
  async function (this: KlikWorld, name: string) {
    const pin = (await customerOrder(this)).deliveryPin;
    assert.ok(pin, "The customer has no PIN");
    await deliver(this, name, { pin });
  },
);

Then(
  "Rosa holds ₱199.00 more cash and earned her pay plus the ₱20.00 tip today",
  async function (this: KlikWorld) {
    assert.ok(this.dispatch.before, "No earnings recorded when Rosa took the job");
    const [row] = await this.db.query<{ rider_earnings_centavos: number }>(
      `select rider_earnings_centavos from public.orders where id = $1`,
      [orderId(this)],
    );
    const after = data<{
      today: { jobs: number; payCentavos: number; tipCentavos: number };
      cashHeldCentavos: number;
    }>(await rider(this, "Rosa Rider").client.request("GET", "/api/rider/earnings"));
    assert.equal(after.cashHeldCentavos - this.dispatch.before.cashHeld, 19900);
    assert.equal(after.today.jobs - this.dispatch.before.jobs, 1);
    assert.equal(
      after.today.payCentavos + after.today.tipCentavos - this.dispatch.before.earned,
      (row?.rider_earnings_centavos ?? 0) + 2000,
    );
  },
);

// --- tracking ------------------------------------------------------------------------------------

interface TrackingWire {
  rider: { firstName: string | null; location: { lat: number; lng: number } | null } | null;
  etaMinutes: number | null;
}

async function tracking(world: KlikWorld): Promise<TrackingWire> {
  return data(await world.api.request("GET", `/api/orders/${orderId(world)}/tracking`));
}

Then(/^the customer's tracking shows no rider(?: yet)?$/, async function (this: KlikWorld) {
  assert.equal((await tracking(this)).rider, null);
});

When(
  /^"([^"]+)" shares her location near the store$/,
  async function (this: KlikWorld, name: string) {
    await share(this, name, NEAR_STORE);
  },
);

Then(
  "the customer's tracking shows Rosa on the map with an arrival estimate",
  async function (this: KlikWorld) {
    const view = await tracking(this);
    assert.equal(view.rider?.firstName, "Rosa");
    assert.deepEqual(view.rider.location, NEAR_STORE);
    assert.ok(view.etaMinutes !== null && view.etaMinutes > 0, `ETA ${String(view.etaMinutes)}`);
  },
);

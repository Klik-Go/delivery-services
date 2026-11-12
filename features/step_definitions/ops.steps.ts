import assert from "node:assert/strict";
import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signInWithPhone } from "../support/phone-session";
import { signedInStaff } from "../support/staff-session";
import { randomIp } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

const AYALA = { lat: 14.5547, lng: 121.0244 };
/** Reserved Supabase test number for the rider applicant (supabase/config.toml). */
const APPLICANT_PHONE = "+639170000109";
const DOCUMENTS = [
  "government_id",
  "drivers_license",
  "vehicle_registration",
  "selfie_with_id",
  "payout_account",
];
const SLA_WORDS: Readonly<Record<string, string>> = {
  "on time": "on_time",
  "at risk": "at_risk",
  late: "late",
};
/** A 1×1 JPEG for document uploads. */
const PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

function orderId(world: KlikWorld): string {
  assert.ok(world.checkout.orderId, "No order in this scenario");
  return world.checkout.orderId;
}

function coordinator(world: KlikWorld): ApiClient {
  assert.ok(world.ops.coordinator, "No coordinator signed in");
  return world.ops.coordinator.client;
}

function admin(world: KlikWorld): ApiClient {
  assert.ok(world.ops.admin, "No admin signed in");
  return world.ops.admin.client;
}

function actor(world: KlikWorld, who: string): ApiClient {
  return who === "admin" ? admin(world) : coordinator(world);
}

async function zoneId(world: KlikWorld, name: string): Promise<string> {
  const [row] = await world.db.query<{ id: string }>(
    "select id from public.zones where name = $1",
    [name],
  );
  assert.ok(row, `No zone ${name}`);
  return row.id;
}

async function riderIdByName(world: KlikWorld, name: string): Promise<string> {
  const [row] = await world.db.query<{ id: string }>(
    "select r.id from public.riders r join public.profiles p on p.id = r.user_id where p.full_name = $1",
    [name],
  );
  assert.ok(row, `No rider ${name}`);
  return row.id;
}

// ---------------------------------------------------------------------------
// Every console scenario puts back the seeded settings it may change.
// ---------------------------------------------------------------------------

interface Snapshot {
  zones: {
    id: string;
    base_fee_centavos: number;
    is_active: boolean;
    max_radius_km: string;
    coordinator_id: string | null;
    area: string;
  }[];
  fees: { id: string; fee_centavos: number; is_active: boolean }[];
  merchants: {
    id: string;
    status: string;
    status_reason: string | null;
    is_open: boolean;
    commission_bps: number;
  }[];
  flags: { key: string; enabled: boolean; rollout: unknown }[];
  riders: { id: string; rating_avg: string; rating_count: number }[];
}
const snapshots = new WeakMap<KlikWorld, Snapshot>();

Before({ tags: "@ops" }, async function (this: KlikWorld) {
  snapshots.set(this, {
    zones: await this.db.query(
      "select id, base_fee_centavos, is_active, max_radius_km::text, coordinator_id, extensions.st_asewkt(area::extensions.geometry) as area from public.zones",
    ),
    fees: await this.db.query("select id, fee_centavos, is_active from public.fee_rules"),
    merchants: await this.db.query(
      "select id, status::text, status_reason, is_open, commission_bps from public.merchants where id::text like '5eed%'",
    ),
    flags: await this.db.query("select key, enabled, rollout from public.feature_flags"),
    riders: await this.db.query(
      "select id, rating_avg::text, rating_count from public.riders where id::text like '5eed%'",
    ),
  });
});

After({ tags: "@ops" }, async function (this: KlikWorld) {
  const snap = snapshots.get(this);
  if (!snap) return;
  for (const z of snap.zones) {
    await this.db.query(
      `update public.zones set base_fee_centavos = $2, is_active = $3, max_radius_km = $4::numeric, coordinator_id = $5,
              area = extensions.st_geomfromewkt($6)::extensions.geography where id = $1`,
      [z.id, z.base_fee_centavos, z.is_active, z.max_radius_km, z.coordinator_id, z.area],
    );
  }
  for (const f of snap.fees) {
    await this.db.query(
      "update public.fee_rules set fee_centavos = $2, is_active = $3 where id = $1",
      [f.id, f.fee_centavos, f.is_active],
    );
  }
  for (const m of snap.merchants) {
    await this.db.query(
      `update public.merchants set status = $2::public.merchant_status, status_reason = $3, is_open = $4, commission_bps = $5,
              next_commission_bps = null, next_commission_from = null where id = $1`,
      [m.id, m.status, m.status_reason, m.is_open, m.commission_bps],
    );
  }
  for (const flag of snap.flags) {
    await this.db.query(
      "update public.feature_flags set enabled = $2, rollout = $3 where key = $1",
      [flag.key, flag.enabled, JSON.stringify(flag.rollout)],
    );
  }
  for (const r of snap.riders) {
    await this.db.query(
      "update public.riders set rating_avg = $2::numeric, rating_count = $3 where id = $1",
      [r.id, r.rating_avg, r.rating_count],
    );
  }
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

Given("the Makati coordinator is signed in", async function (this: KlikWorld) {
  this.ops.coordinator = await signedInStaff(this, "coordinator", {
    zoneId: await zoneId(this, "Makati City"),
  });
});

Given("a coordinator of {string} is signed in", async function (this: KlikWorld, zone: string) {
  this.ops.coordinator = await signedInStaff(this, "coordinator", {
    zoneId: await zoneId(this, zone),
  });
});

Given("an admin is signed in", async function (this: KlikWorld) {
  this.ops.admin = await signedInStaff(this, "admin");
});

Then(
  /^the audit log records "([^"]+)" by the (coordinator|admin)(?: because "([^"]*)")?$/,
  async function (this: KlikWorld, action: string, who: string, reason: string | null | undefined) {
    const actorId = who === "admin" ? this.ops.admin?.userId : this.ops.coordinator?.userId;
    const [row] = await this.db.query<{ actor_role: string; meta: Record<string, unknown> }>(
      "select actor_role::text, meta from public.audit_logs where actor_id = $1 and action = $2 order by id desc limit 1",
      [actorId, action],
    );
    assert.ok(row, `No "${action}" audit row by the ${who}`);
    assert.equal(row.actor_role, who);
    // Cucumber passes null for an optional group that did not match.
    if (reason !== undefined && reason !== null) assert.equal(row.meta.reason, reason);
  },
);

// ---------------------------------------------------------------------------
// Live orders
// ---------------------------------------------------------------------------

interface BoardOrder {
  id: string;
  status: string;
  sla: { state: string } | null;
}

async function board(world: KlikWorld): Promise<ApiResponse> {
  world.lastResponse = await coordinator(world).request("GET", "/api/admin/board");
  return world.lastResponse;
}

When("the coordinator opens the order board", async function (this: KlikWorld) {
  await board(this);
});

Then(
  "the order is on the board as {string} and {string}",
  async function (this: KlikWorld, status: string, sla: string) {
    const orders = data<BoardOrder[]>(await board(this));
    const order = orders.find((o) => o.id === orderId(this));
    assert.ok(order, "The order is not on the board");
    assert.equal(order.status, status);
    assert.equal(order.sla?.state, SLA_WORDS[sla]);
  },
);

Then("the order is not on the board", function (this: KlikWorld) {
  const orders = data<BoardOrder[]>(this.response());
  assert.ok(!orders.some((o) => o.id === orderId(this)), "Another zone's order is on the board");
});

When(
  "the order has been preparing for {int} minutes",
  async function (this: KlikWorld, minutes: number) {
    await this.db.query(
      "update public.orders set accepted_at = now() - make_interval(mins => $2) where id = $1",
      [orderId(this), minutes],
    );
  },
);

When("the coordinator opens the order", async function (this: KlikWorld) {
  this.lastResponse = await coordinator(this).request("GET", `/api/admin/orders/${orderId(this)}`);
});

Then("the console history reads {string}", function (this: KlikWorld, expected: string) {
  const detail = data<{ history: { to: string; actorRole: string | null }[] }>(this.response());
  assert.equal(
    detail.history.map((h) => `${h.to} by ${h.actorRole ?? "system"}`).join(", "),
    expected,
  );
});

When(
  "the coordinator assigns {string} to the order because {string}",
  async function (this: KlikWorld, rider: string, reason: string) {
    this.lastResponse = await coordinator(this).post(`/api/admin/orders/${orderId(this)}/assign`, {
      riderId: await riderIdByName(this, rider),
      reason,
    });
  },
);

Then("Rosa's offer for the order has been withdrawn", async function (this: KlikWorld) {
  const rows = await this.db.query<{ status: string }>(
    "select status::text from public.dispatch_offers where order_id = $1 and rider_id = $2",
    [orderId(this), await riderIdByName(this, "Rosa Rider")],
  );
  assert.ok(rows.length > 0 && rows.every((r) => r.status !== "offered"), JSON.stringify(rows));
});

Then("{string} has no job", async function (this: KlikWorld, name: string) {
  const session = this.dispatch.riders.get(name);
  assert.ok(session, `${name} is not signed in`);
  const job = data<unknown>(await session.client.request("GET", "/api/rider/job"));
  assert.equal(job, null);
});

When(
  "the coordinator cancels the order because {string}",
  async function (this: KlikWorld, reason: string) {
    this.lastResponse = await coordinator(this).post(`/api/admin/orders/${orderId(this)}/cancel`, {
      reason,
    });
  },
);

When("the coordinator adds the note {string}", async function (this: KlikWorld, body: string) {
  this.lastResponse = await coordinator(this).post(`/api/admin/orders/${orderId(this)}/notes`, {
    body,
  });
  assert.equal(this.lastResponse.status, 201, this.lastResponse.bodyText);
});

Then(
  "the order shows the note {string} by the coordinator",
  async function (this: KlikWorld, body: string) {
    const detail = data<{ notes: { body: string; authorRole: string }[] }>(
      await coordinator(this).request("GET", `/api/admin/orders/${orderId(this)}`),
    );
    assert.deepEqual(
      detail.notes.map((n) => [n.body, n.authorRole]),
      [[body, "coordinator"]],
    );
  },
);

// ---------------------------------------------------------------------------
// Zones, fees and settings
// ---------------------------------------------------------------------------

When(
  /^the (admin|coordinator) changes the "([^"]+)" fee of "([^"]+)" to ₱(\d+\.\d\d)$/,
  async function (this: KlikWorld, who: string, rule: string, zone: string, pesos: string) {
    const [row] = await this.db.query<{ id: string }>(
      "select f.id from public.fee_rules f join public.zones z on z.id = f.zone_id where f.name = $1 and z.name = $2",
      [rule, zone],
    );
    assert.ok(row, `No fee rule ${rule} in ${zone}`);
    this.lastResponse = await actor(this, who).request("PATCH", `/api/admin/fee-rules/${row.id}`, {
      json: { feeCentavos: Math.round(Number(pesos) * 100) },
    });
  },
);

Then(
  /^a new quote for (\d+) "([^"]+)" with "([^"]+)" from "([^"]+)" has a ₱(\d+\.\d\d) delivery fee$/,
  async function (
    this: KlikWorld,
    quantity: string,
    item: string,
    option: string,
    store: string,
    pesos: string,
  ) {
    const [row] = await this.db.query<{ merchant_id: string; item_id: string; option_id: string }>(
      `select m.id as merchant_id, i.id as item_id, o.id as option_id
         from public.merchants m join public.menu_items i on i.merchant_id = m.id
         join public.modifier_groups g on g.menu_item_id = i.id
         join public.modifier_options o on o.modifier_group_id = g.id
        where m.name = $1 and i.name = $2 and o.name = $3`,
      [store, item, option],
    );
    assert.ok(row, "Menu item not found");
    const quote = await new ApiClient(BASE_URL).post("/api/cart/quote", {
      merchantId: row.merchant_id,
      items: [{ itemId: row.item_id, quantity: Number(quantity), optionIds: [row.option_id] }],
      dropoff: AYALA,
    });
    assert.equal(quote.status, 200, quote.bodyText);
    assert.equal(
      data<{ deliveryFeeCentavos: number }>(quote).deliveryFeeCentavos,
      Math.round(Number(pesos) * 100),
    );
  },
);

Then(
  /^the order placed before still has a ₱(\d+\.\d\d) delivery fee$/,
  async function (this: KlikWorld, pesos: string) {
    const [row] = await this.db.query<{ fee: number }>(
      "select delivery_fee_centavos as fee from public.orders where id = $1",
      [orderId(this)],
    );
    assert.equal(row?.fee, Math.round(Number(pesos) * 100));
  },
);

function square(lat: number, lng: number): [number, number][] {
  const d = 0.02;
  return [
    [lng - d, lat - d],
    [lng + d, lat - d],
    [lng + d, lat + d],
    [lng - d, lat + d],
  ];
}

When(
  "the admin redraws {string} as a square around {float}, {float}",
  async function (this: KlikWorld, zone: string, lat: number, lng: number) {
    this.lastResponse = await admin(this).request(
      "PUT",
      `/api/admin/zones/${await zoneId(this, zone)}/area`,
      {
        json: { ring: square(lat, lng) },
      },
    );
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

When("the admin redraws {string} as a bow tie", async function (this: KlikWorld, zone: string) {
  const [a, b, c, d] = square(14.97, 120.16);
  this.lastResponse = await admin(this).request(
    "PUT",
    `/api/admin/zones/${await zoneId(this, zone)}/area`,
    {
      json: { ring: [a, c, b, d] },
    },
  );
});

Then(
  "{string} covers {float}, {float}",
  async function (this: KlikWorld, zone: string, lat: number, lng: number) {
    const [row] = await this.db.query<{ covers: boolean }>(
      `select extensions.st_covers(area, extensions.st_setsrid(extensions.st_makepoint($2, $3), 4326)::extensions.geography) as covers
       from public.zones where name = $1`,
      [zone, lng, lat],
    );
    assert.equal(row?.covers, true);
  },
);

When(
  "the admin makes them the coordinator of {string}",
  async function (this: KlikWorld, zone: string) {
    this.lastResponse = await admin(this).request(
      "PUT",
      `/api/admin/zones/${await zoneId(this, zone)}/coordinator`,
      {
        json: { userId: this.ops.coordinator?.userId },
      },
    );
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

Then("{string} lists them as its coordinator", async function (this: KlikWorld, zone: string) {
  const zones = data<{ name: string; coordinatorId: string | null }[]>(
    await admin(this).request("GET", "/api/admin/zones"),
  );
  assert.equal(zones.find((z) => z.name === zone)?.coordinatorId, this.ops.coordinator?.userId);
});

When(
  /^the (admin|coordinator) sets the dispatch offer time to (\d+) seconds$/,
  async function (this: KlikWorld, who: string, seconds: string) {
    const [flag] = await this.db.query<{ enabled: boolean; rollout: Record<string, unknown> }>(
      "select enabled, rollout from public.feature_flags where key = 'dispatch'",
    );
    assert.ok(flag);
    this.lastResponse = await actor(this, who).request(
      "PUT",
      "/api/admin/settings/flags/dispatch",
      {
        json: {
          enabled: flag.enabled,
          rollout: { ...flag.rollout, offer_seconds: Number(seconds) },
        },
      },
    );
  },
);

Then(
  "the dispatch settings give riders {int} seconds to answer",
  async function (this: KlikWorld, seconds: number) {
    assert.equal(this.response().status, 200, this.response().bodyText);
    const [flag] = await this.db.query<{ seconds: string }>(
      "select rollout ->> 'offer_seconds' as seconds from public.feature_flags where key = 'dispatch'",
    );
    assert.equal(Number(flag?.seconds), seconds);
  },
);

When(
  "the admin revokes their {string} role for {string}",
  async function (this: KlikWorld, role: string, zone: string) {
    const grants = data<{ id: string; userId: string; role: string; zoneName: string | null }[]>(
      await admin(this).request("GET", "/api/admin/staff"),
    );
    const grant = grants.find(
      (g) => g.userId === this.ops.coordinator?.userId && g.role === role && g.zoneName === zone,
    );
    assert.ok(grant, "Grant not found");
    this.lastResponse = await admin(this).request("DELETE", `/api/admin/staff/${grant.id}`);
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

Then("the coordinator can no longer open the order board", async function (this: KlikWorld) {
  const response = await board(this);
  assert.equal(response.status, 403, response.bodyText);
});

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

async function store(world: KlikWorld, name: string): Promise<{ id: string; slug: string }> {
  const [row] = await world.db.query<{ id: string; slug: string }>(
    "select id, slug from public.merchants where name = $1",
    [name],
  );
  assert.ok(row, `No store ${name}`);
  return row;
}

When(
  "the admin suspends {string} because {string}",
  async function (this: KlikWorld, name: string, reason: string) {
    const { id } = await store(this, name);
    this.lastResponse = await admin(this).post(`/api/admin/stores/${id}/status`, {
      status: "suspended",
      reason,
    });
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

When("the admin reactivates {string}", async function (this: KlikWorld, name: string) {
  const { id } = await store(this, name);
  this.lastResponse = await admin(this).post(`/api/admin/stores/${id}/status`, {
    status: "active",
  });
  assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
});

Then(
  /^customers can (no longer open|open) "([^"]+)"(?: again)?$/,
  async function (this: KlikWorld, can: string, name: string) {
    const { slug } = await store(this, name);
    const page = await new ApiClient(BASE_URL).request("GET", `/api/stores/${slug}`);
    assert.equal(page.status, can === "open" ? 200 : 404, page.bodyText);
  },
);

When(
  "the admin sets the commission of {string} to {int}% from tomorrow",
  async function (this: KlikWorld, name: string, percent: number) {
    const { id } = await store(this, name);
    const manilaTomorrow = new Date(Date.now() + 8 * 3_600_000 + 86_400_000)
      .toISOString()
      .slice(0, 10);
    this.lastResponse = await admin(this).post(`/api/admin/stores/${id}/commission`, {
      commissionBps: percent * 100,
      effectiveFrom: `${manilaTomorrow}T00:00:00+08:00`,
      reason: "New partner rate",
    });
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

async function commissionAt(
  world: KlikWorld,
  name: string,
  interval: string,
): Promise<number | undefined> {
  const { id } = await store(world, name);
  const [row] = await world.db.query<{ bps: number }>(
    "select private.commission_bps($1, now() + $2::interval) as bps",
    [id, interval],
  );
  return row?.bps;
}

Then(
  "{string} still pays its current commission today",
  async function (this: KlikWorld, name: string) {
    const snap = snapshots.get(this);
    const { id } = await store(this, name);
    assert.equal(
      await commissionAt(this, name, "0 hours"),
      snap?.merchants.find((m) => m.id === id)?.commission_bps,
    );
  },
);

Then(
  "from tomorrow {string} pays {int}%",
  async function (this: KlikWorld, name: string, percent: number) {
    assert.equal(await commissionAt(this, name, "2 days"), percent * 100);
  },
);

// ---------------------------------------------------------------------------
// Rider applications and KYC
// ---------------------------------------------------------------------------

function applicant(world: KlikWorld): NonNullable<KlikWorld["ops"]["applicant"]> {
  assert.ok(world.ops.applicant, "No rider applied in this scenario");
  return world.ops.applicant;
}

Given(
  "a new rider applies in {string} with a motorcycle and uploads their documents",
  async function (this: KlikWorld, zone: string) {
    const client = new ApiClient(BASE_URL);
    client.headers.set("x-forwarded-for", randomIp());
    const userId = await signInWithPhone(client, APPLICANT_PHONE);
    // The test number applies again in every scenario: start from a clean slate.
    await this.db.query("delete from public.riders where user_id = $1", [userId]);
    await this.db.query("delete from public.user_roles where user_id = $1 and role = 'rider'", [
      userId,
    ]);
    const applied = await client.post("/api/rider/application", {
      zoneId: await zoneId(this, zone),
      vehicleType: "motorcycle",
      plateNo: "KYC 2026",
      fullName: "Ella Applicant",
      payoutAccountName: "Ella Applicant",
    });
    assert.equal(applied.status, 201, applied.bodyText);
    const { riderId } = data<{ riderId: string }>(applied);
    for (const type of DOCUMENTS) {
      const form = new FormData();
      form.set("type", type);
      form.set("file", new Blob([PHOTO], { type: "image/jpeg" }), `${type}.jpg`);
      const uploaded = await client.request("POST", "/api/rider/application/documents", {
        body: form,
      });
      assert.equal(uploaded.status, 201, uploaded.bodyText);
    }
    this.ops.applicant = { client, userId, riderId };
  },
);

interface Review {
  id: string;
  checklist: { type: string; state: string; document: { id: string } | null }[];
}

async function review(world: KlikWorld): Promise<Review> {
  return data<Review>(
    await coordinator(world).request("GET", `/api/admin/riders/${applicant(world).riderId}`),
  );
}

async function documentId(world: KlikWorld, type: string): Promise<string> {
  const item = (await review(world)).checklist.find((c) => c.type === type);
  assert.ok(item?.document, `No ${type}`);
  return item.document.id;
}

When("the coordinator opens the rider queue", async function (this: KlikWorld) {
  this.lastResponse = await coordinator(this).request("GET", "/api/admin/riders?filter=pending");
});

Then(
  "the new rider is waiting with {int} documents to check",
  function (this: KlikWorld, count: number) {
    const riders = data<Review[]>(this.response());
    const mine = riders.find((r) => r.id === applicant(this).riderId);
    assert.ok(mine, "The application is not in the queue");
    assert.equal(mine.checklist.filter((c) => c.state === "pending").length, count);
  },
);

When("the coordinator opens the rider's {string}", async function (this: KlikWorld, type: string) {
  const response = await coordinator(this).request(
    "GET",
    `/api/admin/kyc/${await documentId(this, type)}`,
  );
  this.ops.link = data<{ url: string }>(response).url;
});

Then(
  "the link works now and expires 60 seconds after it was made",
  async function (this: KlikWorld) {
    assert.ok(this.ops.link, "No link");
    const fetched = await fetch(this.ops.link);
    assert.equal(fetched.status, 200);
    const token = new URL(this.ops.link).searchParams.get("token") ?? "";
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as {
      iat: number;
      exp: number;
    };
    assert.equal(payload.exp - payload.iat, 60);
  },
);

Then("the document has no public address", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ path: string }>(
    "select storage_path as path from public.rider_kyc_documents where rider_id = $1 limit 1",
    [applicant(this).riderId],
  );
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/rider-kyc/${row?.path ?? ""}`;
  const response = await fetch(url);
  assert.notEqual(response.status, 200);
});

When("the coordinator accepts every document", async function (this: KlikWorld) {
  for (const item of (await review(this)).checklist) {
    assert.ok(item.document, `${item.type} missing`);
    const response = await coordinator(this).post(`/api/admin/kyc/${item.document.id}`, {
      decision: "approve",
    });
    assert.equal(response.status, 200, response.bodyText);
  }
});

When("the coordinator approves the rider", async function (this: KlikWorld) {
  this.lastResponse = await coordinator(this).post(
    `/api/admin/riders/${applicant(this).riderId}/status`,
    { status: "active" },
  );
});

When(
  "the coordinator suspends the rider because {string}",
  async function (this: KlikWorld, reason: string) {
    this.lastResponse = await coordinator(this).post(
      `/api/admin/riders/${applicant(this).riderId}/status`,
      {
        status: "suspended",
        reason,
      },
    );
    assert.equal(this.lastResponse.status, 200, this.lastResponse.bodyText);
  },
);

When(
  "the coordinator rejects the rider's {string} because {string}",
  async function (this: KlikWorld, type: string, reason: string) {
    const response = await coordinator(this).post(
      `/api/admin/kyc/${await documentId(this, type)}`,
      { decision: "reject", reason },
    );
    assert.equal(response.status, 200, response.bodyText);
  },
);

Then(
  "the rider sees {string} rejected because {string}",
  async function (this: KlikWorld, type: string, reason: string) {
    const application = data<{
      checklist: { type: string; state: string; document: { rejectionReason: string | null } }[];
    }>(await applicant(this).client.request("GET", "/api/rider/application"));
    const item = application.checklist.find((c) => c.type === type);
    assert.equal(item?.state, "rejected");
    assert.equal(item.document.rejectionReason, reason);
  },
);

Then(/^the new rider (can|cannot) go online$/, async function (this: KlikWorld, can: string) {
  const response = await applicant(this).client.post("/api/rider/status", { online: true });
  assert.equal(response.status, can === "can" ? 200 : 403, response.bodyText);
  if (can === "can") await applicant(this).client.post("/api/rider/status", { online: false });
});

Given(
  "{string} has an average rating of {float} from {int} ratings",
  async function (this: KlikWorld, name: string, rating: number, count: number) {
    await this.db.query(
      "update public.riders set rating_avg = $2, rating_count = $3 where id = $1",
      [await riderIdByName(this, name), rating, count],
    );
  },
);

When("the coordinator opens the coaching list", async function (this: KlikWorld) {
  this.lastResponse = await coordinator(this).request("GET", "/api/admin/riders?filter=coaching");
});

Then("{string} is on the coaching list", async function (this: KlikWorld, name: string) {
  const riders = data<{ id: string }[]>(this.response());
  assert.ok(
    riders.map((r) => r.id).includes(await riderIdByName(this, name)),
    `${name} is not on the list`,
  );
});

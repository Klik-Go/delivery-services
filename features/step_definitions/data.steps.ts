import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Given, Then, When, type DataTable } from "@cucumber/cucumber";
import { pesosToCentavos } from "@klikgo/core";
import { asUser, DbFixtures, offsetLatLng, pointEwkt, type LatLng } from "@klikgo/db/testing";
import type { KlikWorld } from "../support/world";

async function fixtures(world: KlikWorld): Promise<DbFixtures> {
  return new DbFixtures(await world.db.client());
}

const centavos = (peso: string): number => pesosToCentavos(peso.replace("₱", ""));

// ---------- zones ----------

Given("the pilot zone from the seed data", async function (this: KlikWorld) {
  const rows = await this.db.query<{ id: string; lat: number; lng: number }>(
    `select id, extensions.st_y(c) as lat, extensions.st_x(c) as lng
     from public.zones, extensions.st_centroid(area::extensions.geometry) c where slug = 'pilot-zone'`,
  );
  const zone = rows[0];
  assert.ok(zone, "The seed has no pilot zone. Run `pnpm db:reset`.");
  this.data.pilotZone = { id: zone.id, centre: { lat: Number(zone.lat), lng: Number(zone.lng) } };
});

Given("the pilot zone is paused", async function (this: KlikWorld) {
  await this.db.query(`update public.zones set is_active = false where id = $1`, [
    this.data.zone().id,
  ]);
});

async function dropPin(world: KlikWorld, point: LatLng): Promise<void> {
  const rows = await world.db.query<{ id: string }>(
    `select id from public.zone_for_point($1::extensions.geography)`,
    [pointEwkt(point)],
  );
  world.data.servingZone = rows[0]?.id ?? null;
}

When("a customer drops a pin at the centre of the pilot zone", async function (this: KlikWorld) {
  await dropPin(this, this.data.zone().centre);
});

When(
  "a customer drops a pin {int} km north of the pilot zone centre",
  async function (this: KlikWorld, km: number) {
    await dropPin(this, offsetLatLng(this.data.zone().centre, km * 1000));
  },
);

Then("the address is served by the pilot zone", function (this: KlikWorld) {
  assert.equal(this.data.servingZone, this.data.zone().id);
});

Then("no zone serves the address", function (this: KlikWorld) {
  assert.equal(this.data.servingZone, null);
});

When(
  "a merchant tries to register {int} km north of the pilot zone centre",
  async function (this: KlikWorld, km: number) {
    const fx = await fixtures(this);
    const owner = await fx.user("Faraway Owner");
    this.data.lastError = await this.db.attempt(() =>
      fx.merchant({
        zoneId: this.data.zone().id,
        ownerId: owner,
        name: "Faraway",
        location: offsetLatLng(this.data.zone().centre, km * 1000),
      }),
    );
  },
);

Then("the merchant is not saved", function (this: KlikWorld) {
  assert.match(this.data.lastError ?? "", /outside its zone/);
});

// ---------- merchants, riders, people ----------

async function addMerchant(world: KlikWorld, name: string, staff?: string): Promise<void> {
  const fx = await fixtures(world);
  const ownerId = await fx.user(`${name} owner`);
  const location = world.data.zone().centre;
  const id = await fx.merchant({ zoneId: world.data.zone().id, ownerId, name, location });
  world.data.merchants.set(name, { id, ownerId, location });
  if (staff) {
    const staffId = await fx.user(staff, [{ role: "merchant_staff", merchantId: id }]);
    world.data.people.set(staff, staffId);
  }
}

Given(
  "a merchant {string} at the centre of the pilot zone",
  async function (this: KlikWorld, name: string) {
    await addMerchant(this, name);
  },
);

Given(
  "a merchant {string} at the centre of the pilot zone with staff member {string}",
  async function (this: KlikWorld, name: string, staff: string) {
    await addMerchant(this, name, staff);
  },
);

async function addRider(
  world: KlikWorld,
  name: string,
  options: {
    status?: "active" | "pending_kyc";
    isOnline?: boolean;
    metres?: number;
    lastSeen?: number;
    near?: LatLng;
  },
): Promise<string> {
  const fx = await fixtures(world);
  const userId = await fx.user(name);
  const id = await fx.rider({
    userId,
    zoneId: world.data.zone().id,
    status: options.status ?? "active",
    isOnline: options.isOnline ?? true,
    location: offsetLatLng(options.near ?? world.data.zone().centre, options.metres ?? 100),
    lastSeenSecondsAgo: options.lastSeen ?? 5,
  });
  world.data.riders.set(name, { id, userId });
  world.data.people.set(name, userId);
  return id;
}

Given("a rider {string} on duty in the pilot zone", async function (this: KlikWorld, name: string) {
  await addRider(this, name, {});
});

Given(
  "these are the only riders on duty around {string}:",
  async function (this: KlikWorld, merchantName: string, table: DataTable) {
    const merchant = this.data.get(this.data.merchants, merchantName);
    const fx = await fixtures(this);
    // Seeded riders go off duty for this scenario (the transaction is rolled back afterwards).
    await this.db.query(`update public.riders set is_online = false where zone_id = $1`, [
      this.data.zone().id,
    ]);
    for (const row of table.hashes()) {
      const riderId = await addRider(this, row.rider ?? "", {
        status: row.status === "pending_kyc" ? "pending_kyc" : "active",
        isOnline: row.online === "yes",
        metres: Number(row["metres away"]),
        lastSeen: parseInt(row["last seen"] ?? "0", 10),
        near: merchant.location,
      });
      if (row.delivering === "yes") {
        const customer = await fx.user(`Customer of ${row.rider ?? ""}`);
        const order = await fx.order({
          customerId: customer,
          merchantId: merchant.id,
          zoneId: this.data.zone().id,
          dropoff: offsetLatLng(merchant.location, 500),
        });
        await fx.assignRider(order, riderId);
        await fx.setStatus(order, "accepted");
      }
    }
  },
);

// ---------- dispatch ----------

async function findRiders(
  world: KlikWorld,
  merchantName: string,
  limit: number,
  maxDistanceM: number,
): Promise<void> {
  const merchant = world.data.get(world.data.merchants, merchantName);
  const rows = await world.db.query<{ rider_id: string }>(
    `select rider_id from public.nearest_available_riders($1::extensions.geography, $2, $3)`,
    [pointEwkt(merchant.location), limit, maxDistanceM],
  );
  const names = new Map([...world.data.riders].map(([name, r]) => [r.id, name]));
  world.data.offeredRiders = rows.map(
    (r) => names.get(r.rider_id) ?? `unknown rider ${r.rider_id}`,
  );
}

When(
  "dispatch looks for the {int} nearest available riders to {string}",
  async function (this: KlikWorld, limit: number, merchant: string) {
    await findRiders(this, merchant, limit, 5000);
  },
);

When(
  "dispatch looks for available riders within {int} m of {string}",
  async function (this: KlikWorld, metres: number, merchant: string) {
    await findRiders(this, merchant, 50, metres);
  },
);

Then(/^the riders offered are, nearest first: (.+)$/, function (this: KlikWorld, list: string) {
  assert.deepEqual(
    this.data.offeredRiders,
    list.split(",").map((s) => s.trim()),
  );
});

// ---------- orders and privacy ----------

async function placeOrder(
  world: KlikWorld,
  customer: string,
  merchantName: string,
): Promise<string> {
  const fx = await fixtures(world);
  const customerId = world.data.people.get(customer) ?? (await fx.user(customer));
  world.data.people.set(customer, customerId);
  const merchant = world.data.get(world.data.merchants, merchantName);
  const id = await fx.order({
    customerId,
    merchantId: merchant.id,
    zoneId: world.data.zone().id,
    dropoff: offsetLatLng(merchant.location, 400),
  });
  world.data.orders.set(`${customer} from ${merchantName}`, id);
  world.data.currentOrder = id;
  return id;
}

Given(
  "customer {string} has an order from {string} that {string} is delivering",
  async function (this: KlikWorld, customer: string, merchant: string, rider: string) {
    const fx = await fixtures(this);
    const order = await placeOrder(this, customer, merchant);
    await fx.assignRider(order, this.data.get(this.data.riders, rider).id);
    for (const status of ["accepted", "preparing", "ready", "picked_up"] as const)
      await fx.setStatus(order, status);
  },
);

Given(
  "customer {string} has an order from {string} offered to {string}",
  async function (this: KlikWorld, customer: string, merchant: string, rider: string) {
    const fx = await fixtures(this);
    const order = await placeOrder(this, customer, merchant);
    await fx.offer(order, this.data.get(this.data.riders, rider).id);
  },
);

Given(
  "customer {string} has placed a cash-on-delivery order from {string}",
  async function (this: KlikWorld, customer: string, merchant: string) {
    await placeOrder(this, customer, merchant);
  },
);

async function visibleOrders(world: KlikWorld, userId: string | null): Promise<void> {
  const client = await world.db.client();
  const labels = new Map([...world.data.orders].map(([label, id]) => [id, label]));
  const rows = await asUser(client, userId, () =>
    client.query<{ id: string }>(`select id from public.orders where id = any($1)`, [
      [...world.data.orders.values()],
    ]),
  );
  world.data.visible = rows.rows.map((r) => labels.get(r.id) ?? r.id).sort();
}

When("{string} looks at orders", async function (this: KlikWorld, person: string) {
  await visibleOrders(this, this.data.get(this.data.people, person));
});

When("a visitor who is not signed in looks at orders", async function (this: KlikWorld) {
  await visibleOrders(this, null);
});

Then(
  /^"([^"]+)" sees exactly these orders: (.+)$/,
  function (this: KlikWorld, _person: string, list: string) {
    assert.deepEqual(
      this.data.visible,
      list
        .split(";")
        .map((s) => s.trim())
        .sort(),
    );
  },
);

Then("they see no orders", function (this: KlikWorld) {
  assert.deepEqual(this.data.visible, []);
});

When("{string} looks at rider locations", async function (this: KlikWorld, person: string) {
  const client = await this.db.client();
  const names = new Map([...this.data.riders].map(([name, r]) => [r.id, name]));
  const rows = await asUser(client, this.data.get(this.data.people, person), () =>
    client.query<{ rider_id: string }>(
      `select rider_id from public.rider_locations where rider_id = any($1)`,
      [[...this.data.riders.values()].map((r) => r.id)],
    ),
  );
  this.data.visible = rows.rows.map((r) => names.get(r.rider_id) ?? r.rider_id).sort();
});

Then(
  "{string} sees the location of {string} only",
  function (this: KlikWorld, _person: string, rider: string) {
    assert.deepEqual(this.data.visible, [rider]);
  },
);

Given("{string} has uploaded a government ID", async function (this: KlikWorld, rider: string) {
  await (await fixtures(this)).kycDocument(this.data.get(this.data.riders, rider).id);
});

async function kycVisibleTo(world: KlikWorld, userId: string, rider: string): Promise<number> {
  const client = await world.db.client();
  const rows = await asUser(client, userId, () =>
    client.query(`select id from public.rider_kyc_documents where rider_id = $1`, [
      world.data.get(world.data.riders, rider).id,
    ]),
  );
  return rows.rowCount ?? 0;
}

Then(
  "the zone coordinator cannot see {string}'s ID documents",
  async function (this: KlikWorld, rider: string) {
    const coordinator = await (
      await fixtures(this)
    ).user("Zone Coordinator", [{ role: "coordinator", zoneId: this.data.zone().id }]);
    assert.equal(await kycVisibleTo(this, coordinator, rider), 0);
  },
);

Then(
  "{string} cannot see {string}'s ID documents",
  async function (this: KlikWorld, viewer: string, rider: string) {
    assert.equal(await kycVisibleTo(this, this.data.get(this.data.people, viewer), rider), 0);
  },
);

Then("an admin can see {string}'s ID documents", async function (this: KlikWorld, rider: string) {
  const admin = await (await fixtures(this)).user("Admin", [{ role: "admin" }]);
  assert.equal(await kycVisibleTo(this, admin, rider), 1);
});

// ---------- integrity ----------

function currentOrder(world: KlikWorld): string {
  assert.ok(world.data.currentOrder, "No order in this scenario yet.");
  return world.data.currentOrder;
}

When(
  /^the order is saved with subtotal (₱[\d,.]+), delivery fee (₱[\d,.]+), discount (₱[\d,.]+) and total (₱[\d,.]+)$/,
  async function (this: KlikWorld, subtotal: string, fee: string, discount: string, total: string) {
    this.data.lastError = await this.db.attempt(() =>
      this.db.query(
        `update public.orders set subtotal_centavos = $2, delivery_fee_centavos = $3, discount_centavos = $4, total_centavos = $5 where id = $1`,
        [
          currentOrder(this),
          centavos(subtotal),
          centavos(fee),
          centavos(discount),
          centavos(total),
        ],
      ),
    );
  },
);

When("the order status is changed to {string}", async function (this: KlikWorld, status: string) {
  const fx = await fixtures(this);
  this.data.lastError = await this.db.attempt(() =>
    fx.setStatus(currentOrder(this), status as "delivered"),
  );
});

When(
  "the merchant owner of {string} accepts the order",
  async function (this: KlikWorld, merchant: string) {
    const owner = this.data.get(this.data.merchants, merchant).ownerId;
    await (
      await fixtures(this)
    ).setStatus(currentOrder(this), "accepted", { id: owner, role: "merchant_owner" });
  },
);

Then(
  "the order history reads {string} then {string} by a {string}",
  async function (this: KlikWorld, first: string, second: string, role: string) {
    const rows = await this.db.query<{ to_status: string; actor_role: string | null }>(
      `select to_status::text, actor_role::text from public.order_events where order_id = $1 order by created_at, id`,
      [currentOrder(this)],
    );
    assert.deepEqual(
      rows.map((r) => r.to_status),
      [first, second],
    );
    assert.equal(rows[1]?.actor_role, role);
  },
);

When(
  /^a ledger transaction debits (₱[\d,.]+) and credits (₱[\d,.]+)$/,
  async function (this: KlikWorld, debit: string, credit: string) {
    const txn = randomUUID();
    this.data.lastError = await this.db.attempt(async () => {
      await this.db.query(
        `insert into public.ledger_entries (txn_id, account, party_type, debit_centavos, credit_centavos)
       values ($1, 'gateway_clearing', 'platform', $2, 0), ($1, 'merchant_payable', 'platform', 0, $3)`,
        [txn, centavos(debit), centavos(credit)],
      );
      await this.db.query("set constraints all immediate");
    });
  },
);

Then("the change is refused", function (this: KlikWorld) {
  assert.ok(
    this.data.lastError,
    "Expected the database to refuse the change, but it was accepted.",
  );
});

Then("the change is accepted", function (this: KlikWorld) {
  assert.equal(this.data.lastError, null);
});

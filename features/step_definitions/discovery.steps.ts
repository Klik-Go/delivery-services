import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { ApiResponse } from "../support/api-client";
import type { KlikWorld } from "../support/world";

// ---------- places ----------

const PLACES: Record<string, { lat: number; lng: number }> = {
  "Ayala Avenue, Makati": { lat: 14.5547, lng: 121.0244 },
  "Kapitolyo, Pasig": { lat: 14.5707, lng: 121.0596 },
};

function place(name: string): { lat: number; lng: number } {
  const point = PLACES[name];
  assert.ok(point, `Unknown place ${name}`);
  return point;
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(json?.data !== undefined, `No data (${String(response.status)}): ${response.bodyText}`);
  return json.data;
}

interface StoreCard {
  merchantId: string;
  name: string;
  deliveryFeeCentavos: number;
  eta: { min: number; max: number };
}
interface Feed {
  zone: { name: string } | null;
  promos: { code: string }[];
  rails: { key: string; stores: StoreCard[] }[];
  stores: StoreCard[];
}
interface QuoteLine {
  itemId: string;
  name: string;
}
interface Quote {
  lines: QuoteLine[];
  issues: { itemId: string; code: string }[];
  subtotalCentavos: number;
  deliveryFeeCentavos: number;
  smallOrderFeeCentavos: number;
  totalCentavos: number;
  distanceMeters: number;
}

function location(world: KlikWorld): { lat: number; lng: number } {
  assert.ok(world.discovery.location, "No delivery location chosen in this scenario");
  return world.discovery.location;
}

// ---------- serviceability ----------

When("someone checks a pin on Ayala Avenue, Makati", async function (this: KlikWorld) {
  this.discovery.location = place("Ayala Avenue, Makati");
  this.lastResponse = await this.api.post("/api/geo/serviceability", {
    location: this.discovery.location,
  });
});

When("someone checks a pin in Kapitolyo, Pasig", async function (this: KlikWorld) {
  this.discovery.location = place("Kapitolyo, Pasig");
  this.lastResponse = await this.api.post("/api/geo/serviceability", {
    location: this.discovery.location,
  });
});

Then(
  "they are told Klik Go delivers there from {string}",
  function (this: KlikWorld, zone: string) {
    assert.equal(data<{ zone: { name: string } | null }>(this.response()).zone?.name, zone);
  },
);

Then("they are told {string}", function (this: KlikWorld, message: string) {
  const answer = data<{ zone: unknown; message: string }>(this.response());
  assert.equal(answer.zone, null);
  assert.equal(answer.message, message);
});

When(
  "they join the waitlist as {string} from barangay {string}",
  async function (this: KlikWorld, name: string, barangay: string) {
    this.lastResponse = await this.api.post("/api/waitlist", {
      name,
      phone: "0917 555 0102",
      barangay,
      city: "Pasig City",
      location: location(this),
    });
  },
);

Then("their waitlist request is recorded", async function (this: KlikWorld) {
  assert.equal(this.response().status, 201, this.response().bodyText);
  const { id } = data<{ id: string }>(this.response());
  const rows = await this.db.query<{ barangay: string }>(
    `select barangay from public.waitlist_signups where id = $1`,
    [id],
  );
  assert.equal(rows[0]?.barangay, "Kapitolyo");
  this.merchant.cleanups.push(async () => {
    await this.db.query(`delete from public.waitlist_signups where id = $1`, [id]);
  });
});

When(
  "they save {string} on Ayala Avenue with the landmark {string} and contact number {string}",
  async function (this: KlikWorld, label: string, landmark: string, phone: string) {
    this.lastResponse = await this.api.post("/api/addresses", {
      label,
      location: place("Ayala Avenue, Makati"),
      landmark,
      barangay: "San Lorenzo",
      city: "Makati City",
      contactPhone: phone,
    });
    assert.equal(this.response().status, 201, this.response().bodyText);
  },
);

When("they save an address on Ayala Avenue without a landmark", async function (this: KlikWorld) {
  this.lastResponse = await this.api.post("/api/addresses", {
    label: "Home",
    location: place("Ayala Avenue, Makati"),
    barangay: "San Lorenzo",
    city: "Makati City",
    contactPhone: "0917 000 0103",
  });
});

Then("{string} is their default address", async function (this: KlikWorld, label: string) {
  const list = data<{ label: string; isDefault: boolean }[]>(
    await this.api.request("GET", "/api/addresses"),
  );
  const defaults = list.filter((address) => address.isDefault);
  assert.deepEqual(
    defaults.map((address) => address.label),
    [label],
  );
});

// ---------- feed and search ----------

Given(/^a customer delivering to (.+)$/, function (this: KlikWorld, name: string) {
  this.discovery.location = place(name);
});

When("they open the home feed", async function (this: KlikWorld) {
  const { lat, lng } = location(this);
  this.lastResponse = await this.api.request(
    "GET",
    `/api/feed?lat=${String(lat)}&lng=${String(lng)}`,
  );
  this.discovery.feed = data<Feed>(this.response());
});

function feed(world: KlikWorld): Feed {
  assert.ok(world.discovery.feed, "The feed was not opened");
  return world.discovery.feed as Feed;
}

const RAIL_KEYS: Record<string, string> = { "Near you": "near", "Under ₱100": "under100" };

Then(
  "{string} lists {string} and {string}",
  function (this: KlikWorld, rail: string, first: string, second: string) {
    const names =
      feed(this)
        .rails.find((r) => r.key === RAIL_KEYS[rail])
        ?.stores.map((s) => s.name) ?? [];
    assert.ok(names.includes(first) && names.includes(second), `${rail}: ${names.join(", ")}`);
  },
);

Then("{string} lists {string}", function (this: KlikWorld, rail: string, store: string) {
  const names =
    feed(this)
      .rails.find((r) => r.key === RAIL_KEYS[rail])
      ?.stores.map((s) => s.name) ?? [];
  assert.ok(names.includes(store), `${rail}: ${names.join(", ")}`);
});

Then("every store shows a delivery fee and an arrival time range", function (this: KlikWorld) {
  const stores = feed(this).stores;
  assert.ok(stores.length >= 5, `only ${String(stores.length)} stores`);
  for (const store of stores) {
    assert.ok(store.deliveryFeeCentavos > 0, store.name);
    assert.ok(store.eta.max > store.eta.min && store.eta.min >= 10, store.name);
  }
});

Then("the promo carousel shows {string}", function (this: KlikWorld, code: string) {
  assert.ok(feed(this).promos.some((promo) => promo.code === code));
});

Then("they see no stores and are invited to join the waitlist", function (this: KlikWorld) {
  const result = feed(this);
  assert.equal(result.zone, null);
  assert.deepEqual(result.stores, []);
});

When("they search for {string}", async function (this: KlikWorld, q: string) {
  const { lat, lng } = location(this);
  const query = new URLSearchParams({ q, lat: String(lat), lng: String(lng) });
  this.lastResponse = await this.api.request("GET", `/api/search?${query.toString()}`);
  this.discovery.search = data(this.response());
});

type Groups = { store: { name: string }; dishes: { name: string }[] }[];

Then(
  "the results include {string} from {string}",
  function (this: KlikWorld, dish: string, store: string) {
    const group = (this.discovery.search as Groups).find((g) => g.store.name === store);
    assert.ok(
      group?.dishes.some((d) => d.name === dish),
      JSON.stringify(this.discovery.search),
    );
  },
);

Then("the results include the store {string}", function (this: KlikWorld, store: string) {
  assert.ok((this.discovery.search as Groups).some((g) => g.store.name === store));
});

// ---------- cart ----------

async function menuOf(world: KlikWorld, store: string) {
  const rows = await world.db.query<{
    merchant_id: string;
    item_id: string;
    item: string;
    option_id: string | null;
    option: string | null;
  }>(
    `select m.id as merchant_id, i.id as item_id, i.name as item, o.id as option_id, o.name as option
     from public.merchants m join public.menu_items i on i.merchant_id = m.id
     left join public.modifier_groups g on g.menu_item_id = i.id
     left join public.modifier_options o on o.modifier_group_id = g.id
     where m.name = $1`,
    [store],
  );
  assert.ok(rows[0], `No menu for ${store}`);
  return rows;
}

async function itemId(world: KlikWorld, store: string, item: string): Promise<string> {
  const row = (await menuOf(world, store)).find((r) => r.item === item);
  assert.ok(row, `${store} has no ${item}`);
  return row.item_id;
}

async function quote(
  world: KlikWorld,
  store: string,
  lines: { item: string; quantity: number; option?: string }[],
) {
  const menu = await menuOf(world, store);
  const items = lines.map(({ item, quantity, option }) => {
    const rows = menu.filter((r) => r.item === item);
    assert.ok(rows[0], `${store} has no ${item}`);
    const chosen = option ? rows.find((r) => r.option === option)?.option_id : undefined;
    if (option) assert.ok(chosen, `${item} has no choice ${option}`);
    return { itemId: rows[0].item_id, quantity, optionIds: chosen ? [chosen] : [] };
  });
  world.lastResponse = await world.api.post("/api/cart/quote", {
    merchantId: menu[0]?.merchant_id,
    items,
    dropoff: location(world),
  });
  assert.equal(world.lastResponse.status, 200, world.lastResponse.bodyText);
  world.discovery.quote = data<Quote>(world.lastResponse);
  world.discovery.itemIds = new Map(
    await Promise.all(
      lines.map(async ({ item }) => [item, await itemId(world, store, item)] as const),
    ),
  );
}

function lastQuote(world: KlikWorld): Quote {
  assert.ok(world.discovery.quote, "No quote yet");
  return world.discovery.quote as Quote;
}

When(
  "they ask for a quote for {int} {string} with {string} from {string}",
  async function (this: KlikWorld, quantity: number, item: string, option: string, store: string) {
    await quote(this, store, [{ item, quantity, option }]);
  },
);

When(
  "they ask for a quote for {int} {string} and {int} {string} from {string}",
  async function (this: KlikWorld, q1: number, i1: string, q2: number, i2: string, store: string) {
    await quote(this, store, [
      { item: i1, quantity: q1 },
      { item: i2, quantity: q2 },
    ]);
  },
);

When(
  "they ask for a quote for {int} {string} without choosing from {string}",
  async function (this: KlikWorld, quantity: number, item: string, store: string) {
    await quote(this, store, [{ item, quantity }]);
  },
);

Then("the subtotal is {int} centavos", function (this: KlikWorld, centavos: number) {
  assert.equal(lastQuote(this).subtotalCentavos, centavos);
});

Then(
  "the delivery fee is {int} centavos for a trip under 2 km",
  function (this: KlikWorld, centavos: number) {
    assert.ok(lastQuote(this).distanceMeters < 2000, `${String(lastQuote(this).distanceMeters)} m`);
    assert.equal(lastQuote(this).deliveryFeeCentavos, centavos);
  },
);

Then("a small-order fee of {int} centavos applies", function (this: KlikWorld, centavos: number) {
  assert.equal(lastQuote(this).smallOrderFeeCentavos, centavos);
});

Then("the total is {int} centavos", function (this: KlikWorld, centavos: number) {
  assert.equal(lastQuote(this).totalCentavos, centavos);
});

async function changeItem(
  world: KlikWorld,
  store: string,
  item: string,
  sql: string,
  value: unknown,
) {
  const id = await itemId(world, store, item);
  const [before] = await world.db.query<{ price_centavos: number; is_available: boolean }>(
    `select price_centavos, is_available from public.menu_items where id = $1`,
    [id],
  );
  await world.db.query(sql, [id, value]);
  world.merchant.cleanups.push(async () => {
    await world.db.query(
      `update public.menu_items set price_centavos = $2, is_available = $3 where id = $1`,
      [id, before?.price_centavos, before?.is_available],
    );
  });
}

Given(
  "{string} at {string} now costs ₱{int}",
  async function (this: KlikWorld, item: string, store: string, pesos: number) {
    await changeItem(
      this,
      store,
      item,
      `update public.menu_items set price_centavos = $2 where id = $1`,
      pesos * 100,
    );
  },
);

Given(
  "{string} at {string} is sold out",
  async function (this: KlikWorld, item: string, store: string) {
    await changeItem(
      this,
      store,
      item,
      `update public.menu_items set is_available = $2 where id = $1`,
      false,
    );
  },
);

function issueFor(world: KlikWorld, item: string): string | undefined {
  const id = world.discovery.itemIds?.get(item);
  return lastQuote(world).issues.find((issue) => issue.itemId === id)?.code;
}

Then("{string} is flagged as sold out", function (this: KlikWorld, item: string) {
  assert.equal(issueFor(this, item), "sold_out");
});

Then("{string} is flagged as needing a choice", function (this: KlikWorld, item: string) {
  assert.equal(issueFor(this, item), "choices_needed");
});

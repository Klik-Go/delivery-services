import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { ApiClient } from "../support/api-client";
import { newStaffCredentials } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

const run = promisify(execFile);

const ZONES = ["makati", "san-fernando-pampanga", "san-marcelino-zambales"] as const;
const SAN_FERNANDO = { lat: 15.035, lng: 120.684 };

async function demo(world: KlikWorld, action: "load" | "hide"): Promise<void> {
  const { stdout } = await run("node", ["--import", "tsx", "scripts/demo-data.ts"], {
    env: { ...process.env, DEMO_ACTION: action, DEMO_OWNER_EMAIL: world.auth.adminEmail ?? "" },
  });
  world.auth.scriptOutput = stdout;
}

// Other scenarios expect only the seed's stores: always take the demo off again.
After({ tags: "@demo" }, async function (this: KlikWorld) {
  await demo(this, "hide");
});

Given("a demo store owner email that has no Klik Go account yet", function (this: KlikWorld) {
  this.auth.adminEmail = newStaffCredentials("demo-owner").email;
});

When(/^the owner loads the demo data(?: again)?$/, async function (this: KlikWorld) {
  await demo(this, "load");
});

When("the owner hides the demo data", async function (this: KlikWorld) {
  await demo(this, "hide");
});

async function demoStoreSlugs(world: KlikWorld, zoneSlug: string): Promise<string[]> {
  const rows = await world.db.query<{ slug: string }>(
    `select m.slug from public.merchants m join public.zones z on z.id = m.zone_id
      where m.id::text like 'de300000-%' and z.slug = $1`,
    [zoneSlug],
  );
  return rows.map((r) => r.slug);
}

// The home feed is cached per zone for a minute, so stores are checked on their own pages.
Then(
  "every launch zone has demo stores customers can open, with full menus and cash on delivery",
  async function (this: KlikWorld) {
    const api = new ApiClient(BASE_URL);
    for (const zone of ZONES) {
      const slugs = await demoStoreSlugs(this, zone);
      assert.ok(slugs.length >= 2, `Only ${String(slugs.length)} demo stores in ${zone}`);
      for (const slug of slugs) {
        const page = await api.request("GET", `/api/stores/${slug}`);
        assert.equal(page.status, 200, `${slug}: ${page.bodyText}`);
        const data = (
          page.json as { data: { store: { acceptsCod: boolean }; menu: { items: unknown[] }[] } }
        ).data;
        assert.equal(data.store.acceptsCod, true, slug);
        const items = data.menu.reduce((n, category) => n + category.items.length, 0);
        assert.ok(items >= 5, `${slug} has ${String(items)} items`);
      }
    }
  },
);

Then(
  "a customer in San Fernando can price an order from {string}",
  async function (this: KlikWorld, store: string) {
    const [item] = await this.db.query<{ merchant_id: string; item_id: string }>(
      `select m.id as merchant_id, i.id as item_id from public.merchants m
         join public.menu_items i on i.merchant_id = m.id
        where m.name = $1 and i.name = 'Bringhe'`,
      [store],
    );
    assert.ok(item, `No Bringhe at ${store}`);
    const response = await new ApiClient(BASE_URL).post("/api/cart/quote", {
      merchantId: item.merchant_id,
      items: [{ itemId: item.item_id, quantity: 2, optionIds: [] }],
      dropoff: SAN_FERNANDO,
    });
    assert.equal(response.status, 200, response.bodyText);
    const quote = (
      response.json as { data: { deliverable: boolean; issues: unknown[]; totalCentavos: number } }
    ).data;
    assert.equal(quote.deliverable, true);
    assert.deepEqual(quote.issues, []);
    assert.ok(quote.totalCentavos > 32000, `total ${String(quote.totalCentavos)}`);
  },
);

Then("the demo owner manages all the demo stores", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ stores: number; owned: number }>(
    `select (select count(*)::int from public.merchants where id::text like 'de300000-%') as stores,
            (select count(*)::int from public.user_roles r join auth.users u on u.id = r.user_id
              where lower(u.email) = $1 and r.role = 'merchant_owner'
                and r.merchant_id::text like 'de300000-%') as owned`,
    [this.auth.adminEmail],
  );
  assert.ok(row && row.stores >= 9, `stores: ${String(row?.stores)}`);
  assert.equal(row.owned, row.stores);
});

Then("the demo menus are not duplicated", async function (this: KlikWorld) {
  const [row] = await this.db.query<{ items: number; distinct_items: number }>(
    `select count(*)::int as items, count(distinct (merchant_id, name))::int as distinct_items
       from public.menu_items where merchant_id::text like 'de300000-%'`,
  );
  assert.ok(row && row.items > 0);
  assert.equal(row.items, row.distinct_items);
  assert.match(this.auth.scriptOutput ?? "", /Created 0 demo stores/);
});

Then(
  "the demo stores in San Fernando can no longer be opened by customers",
  async function (this: KlikWorld) {
    const slugs = await demoStoreSlugs(this, "san-fernando-pampanga");
    assert.ok(slugs.length > 0);
    const api = new ApiClient(BASE_URL);
    for (const slug of slugs) {
      const page = await api.request("GET", `/api/stores/${slug}`);
      assert.equal(page.status, 404, `${slug}: ${page.bodyText}`);
    }
  },
);

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { ApiClient, type ApiResponse } from "../support/api-client";
import { signedInStaff } from "../support/staff-session";
import { adminClient, randomIp } from "../support/supabase-test-auth";
import { BASE_URL, type KlikWorld } from "../support/world";

// ---------- helpers ----------

/** Ayala Avenue, Makati (a launch zone). */
const PILOT_PIN = { lat: 14.5547, lng: 121.0244 };
const CEBU_PIN = { lat: 10.3157, lng: 123.8854 };

interface MenuOption {
  name: string;
  priceDeltaCentavos: number;
}
interface MenuGroup {
  name: string;
  required: boolean;
  options: MenuOption[];
}
interface MenuItem {
  id: string;
  name: string;
  priceCentavos: number;
  isAvailable: boolean;
  modifierGroups: MenuGroup[];
}
interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

function data<T>(response: ApiResponse): T {
  const json = response.json as { data?: T } | undefined;
  assert.ok(
    json?.data !== undefined,
    `No data in response ${response.status}: ${response.bodyText}`,
  );
  return json.data;
}

function expectStatus(response: ApiResponse, status: number): void {
  assert.equal(response.status, status, response.bodyText);
}

async function merchantByName(world: KlikWorld, name: string): Promise<string> {
  const rows = await world.db.query<{ id: string }>(
    `select id from public.merchants where name = $1 order by created_at limit 1`,
    [name],
  );
  assert.ok(rows[0], `No merchant named ${name} (run pnpm db:reset)`);
  return rows[0].id;
}

function merchantId(world: KlikWorld): string {
  assert.ok(world.merchant.merchantId, "No store chosen yet in this scenario");
  return world.merchant.merchantId;
}

function menuPath(world: KlikWorld, rest = ""): string {
  return `/api/merchant/${merchantId(world)}/menu${rest}`;
}

async function menu(world: KlikWorld, client: ApiClient = world.api): Promise<MenuCategory[]> {
  const response = await client.request("GET", menuPath(world));
  expectStatus(response, 200);
  return data<MenuCategory[]>(response);
}

async function findItem(world: KlikWorld, name: string): Promise<MenuItem> {
  const id = world.merchant.items.get(name);
  const items = (await menu(world)).flatMap((category) => category.items);
  const item = id
    ? items.find((candidate) => candidate.id === id)
    : items.filter((candidate) => candidate.name === name).at(-1);
  assert.ok(item, `No menu item ${name}`);
  return item;
}

/**
 * Snapshots a seeded store (settings, closures, menu) and registers an undo, so scenarios can
 * change "Aling Nena's Karinderya" and still leave the seed as they found it.
 */
async function protectStore(world: KlikWorld, id: string): Promise<void> {
  const [settings] = await world.db.query<Record<string, unknown>>(
    `select hours, default_prep_minutes, accepts_cod, service_radius_km, is_open from public.merchants where id = $1`,
    [id],
  );
  const categories = await world.db.query<{ id: string }>(
    `select id from public.menu_categories where merchant_id = $1`,
    [id],
  );
  const items = await world.db.query<{ id: string }>(
    `select id from public.menu_items where merchant_id = $1`,
    [id],
  );
  const closures = await world.db.query<{ id: string }>(
    `select id from public.merchant_closures where merchant_id = $1`,
    [id],
  );
  world.merchant.cleanups.push(async () => {
    await world.db.query(
      `delete from public.menu_items where merchant_id = $1 and not (id = any($2::uuid[]))`,
      [id, items.map((row) => row.id)],
    );
    await world.db.query(
      `delete from public.menu_categories where merchant_id = $1 and not (id = any($2::uuid[]))`,
      [id, categories.map((row) => row.id)],
    );
    await world.db.query(
      `delete from public.merchant_closures where merchant_id = $1 and not (id = any($2::uuid[]))`,
      [id, closures.map((row) => row.id)],
    );
    await world.db.query(
      `update public.menu_items set is_available = true where merchant_id = $1`,
      [id],
    );
    await world.db.query(
      `update public.merchants set hours = $2, default_prep_minutes = $3, accepts_cod = $4,
         service_radius_km = $5, is_open = $6 where id = $1`,
      [
        id,
        JSON.stringify(settings?.hours ?? {}),
        settings?.default_prep_minutes,
        settings?.accepts_cod,
        settings?.service_radius_km,
        settings?.is_open,
      ],
    );
  });
}

function application(name: string, location: { lat: number; lng: number }) {
  return {
    businessName: name,
    ownerName: "Test Applicant",
    phone: "0917 555 0101",
    email: `apply-${randomBytes(4).toString("hex")}@example.test`,
    category: "food",
    barangay: "Poblacion",
    city: "Placeholder City",
    addressLine: "Near the chapel",
    location,
  };
}

async function apply(
  world: KlikWorld,
  client: ApiClient,
  name: string,
  location: { lat: number; lng: number },
): Promise<ApiResponse> {
  const response = await client.post("/api/partners/applications", application(name, location));
  world.lastResponse = response;
  const id = (response.json as { data?: { applicationId?: string } } | undefined)?.data
    ?.applicationId;
  if (id) world.merchant.applications.set(name, id);
  return response;
}

function applicationId(world: KlikWorld, name: string): string {
  const id = world.merchant.applications.get(name);
  assert.ok(id, `${name} has not applied in this scenario`);
  return id;
}

async function adminApi(world: KlikWorld): Promise<ApiClient> {
  world.merchant.adminApi ??= (await signedInStaff(world, "admin")).client;
  return world.merchant.adminApi;
}

async function pendingApplications(
  world: KlikWorld,
): Promise<{ id: string; businessName: string; zoneName: string | null }[]> {
  const response = await (
    await adminApi(world)
  ).request("GET", "/api/admin/merchant-applications?status=pending");
  expectStatus(response, 200);
  return data(response);
}

function nextChristmas(): string {
  const now = new Date();
  const year =
    now.getUTCMonth() === 11 && now.getUTCDate() >= 25
      ? now.getUTCFullYear() + 1
      : now.getUTCFullYear();
  return `${String(year)}-12-25`;
}

// ---------- onboarding ----------

When(
  "{string} applies to become a partner with a pin inside Makati",
  async function (this: KlikWorld, name: string) {
    await apply(this, this.api, name, PILOT_PIN);
  },
);

When(
  "{string} applies to become a partner with a pin outside every zone",
  async function (this: KlikWorld, name: string) {
    await apply(this, this.api, name, CEBU_PIN);
  },
);

Given(
  "{string} has applied to become a partner with a pin inside Makati",
  async function (this: KlikWorld, name: string) {
    const visitor = new ApiClient(BASE_URL);
    visitor.headers.set("x-forwarded-for", randomIp());
    expectStatus(await apply(this, visitor, name, PILOT_PIN), 201);
  },
);

Then("the application is accepted for review", function (this: KlikWorld) {
  expectStatus(this.response(), 201);
  assert.ok(data<{ applicationId: string }>(this.response()).applicationId);
});

Then(
  "an admin sees {string} waiting for review in {string}",
  async function (this: KlikWorld, name: string, zone: string) {
    const id = applicationId(this, name);
    const found = (await pendingApplications(this)).find((a) => a.id === id);
    assert.ok(found, `${name} is not waiting for review`);
    assert.equal(found.zoneName, zone);
  },
);

Then("the applicant is told {string}", function (this: KlikWorld, message: string) {
  const receipt = data<{ inArea: boolean; message: string }>(this.response());
  assert.equal(receipt.inArea, false);
  assert.match(receipt.message, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

Then(
  "an admin cannot approve {string} until a zone covers it",
  async function (this: KlikWorld, name: string) {
    const response = await (
      await adminApi(this)
    ).post(`/api/admin/merchant-applications/${applicationId(this, name)}/approve`, {
      commissionBps: 2000,
      foundingPartner: false,
    });
    expectStatus(response, 409);
    assert.match(response.bodyText, /not in this store's area yet/);
  },
);

When(
  "the admin approves {string} as a founding partner at {int}% commission",
  async function (this: KlikWorld, name: string, percent: number) {
    const response = await this.api.post(
      `/api/admin/merchant-applications/${applicationId(this, name)}/approve`,
      { commissionBps: percent * 100, foundingPartner: true },
    );
    expectStatus(response, 201);
    const approved = data<{ merchantId: string; slug: string; invitePath: string }>(response);
    this.merchant.approvedMerchantId = approved.merchantId;
    this.auth.invitePath = approved.invitePath;
  },
);

Then(
  "the store {string} exists, closed, with a public store link",
  async function (this: KlikWorld, name: string) {
    const [store] = await this.db.query<{
      name: string;
      slug: string;
      status: string;
      is_open: boolean;
    }>(`select name, slug, status::text, is_open from public.merchants where id = $1`, [
      this.merchant.approvedMerchantId,
    ]);
    assert.deepEqual(
      { name: store?.name, status: store?.status, open: store?.is_open },
      {
        name,
        status: "active",
        open: false,
      },
    );
    const page = await new ApiClient(BASE_URL).request("GET", `/stores/${store?.slug ?? ""}`);
    expectStatus(page, 200);
    assert.match(page.bodyText, new RegExp(name));
  },
);

Then(
  "it pays 0% commission for its first 90 days, then {int}%",
  async function (this: KlikWorld, percent: number) {
    const [store] = await this.db.query<{ commission_bps: number; days: number }>(
      `select commission_bps, extract(epoch from founding_commission_until - now()) / 86400 as days
       from public.merchants where id = $1`,
      [this.merchant.approvedMerchantId],
    );
    assert.equal(store?.commission_bps, percent * 100);
    assert.ok(
      Math.abs(Number(store?.days) - 90) < 0.1,
      `founding period is ${String(store?.days)} days`,
    );
  },
);

Then("the admin receives an invite link for the owner", function (this: KlikWorld) {
  assert.match(this.auth.invitePath ?? "", /^\/auth\/confirm\?token_hash=.+&type=invite/);
});

Then(
  "they land on the merchant dashboard for {string}",
  async function (this: KlikWorld, name: string) {
    const page = await this.page();
    await page.waitForURL((url) => url.pathname === "/merchant");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  },
);

Given(
  "the owner of {string} signed in with their authenticator app",
  async function (this: KlikWorld, name: string) {
    const id = await merchantByName(this, name);
    this.merchant.merchantId = id;
    this.merchant.merchantName = name;
    await protectStore(this, id);
    await signedInStaff(this, "merchant_owner", { merchantId: id }, this.api);
  },
);

When("they try to approve {string}", async function (this: KlikWorld, name: string) {
  this.lastResponse = await this.api.post(
    `/api/admin/merchant-applications/${applicationId(this, name)}/approve`,
    { commissionBps: 2000, foundingPartner: false },
  );
});

When(
  "the admin rejects {string} because {string}",
  async function (this: KlikWorld, name: string, reason: string) {
    const response = await this.api.post(
      `/api/admin/merchant-applications/${applicationId(this, name)}/reject`,
      { reason },
    );
    expectStatus(response, 200);
  },
);

Then("{string} is no longer waiting for review", async function (this: KlikWorld, name: string) {
  const id = applicationId(this, name);
  this.merchant.adminApi = this.api;
  assert.equal(
    (await pendingApplications(this)).find((a) => a.id === id),
    undefined,
  );
});

Given("a network that has not sent partner applications yet", function (this: KlikWorld) {
  this.api.headers.set("x-forwarded-for", randomIp());
});

When("it sends {int} partner applications", async function (this: KlikWorld, count: number) {
  for (let i = 0; i < count; i += 1)
    expectStatus(await apply(this, this.api, `Rate Limit Test ${String(i)}`, PILOT_PIN), 201);
});

When("it sends one partner application more", async function (this: KlikWorld) {
  await apply(this, this.api, "Rate Limit Test extra", PILOT_PIN);
});

// ---------- store settings ----------

async function settings(world: KlikWorld, client: ApiClient = world.api) {
  const response = await client.request("GET", `/api/merchant/${merchantId(world)}/settings`);
  expectStatus(response, 200);
  return data<{
    hours: Record<string, { open: string; close: string }[]>;
    defaultPrepMinutes: number;
    acceptsCod: boolean;
    serviceRadiusKm: number | null;
    isOpen: boolean;
    closures: { id: string; closedOn: string; reason: string | null }[];
  }>(response);
}

async function saveSettings(
  world: KlikWorld,
  changes: Record<string, unknown>,
  client: ApiClient = world.api,
): Promise<ApiResponse> {
  const { hours, defaultPrepMinutes, acceptsCod, serviceRadiusKm } = await settings(world);
  const response = await client.request("PUT", `/api/merchant/${merchantId(world)}/settings`, {
    json: { hours, defaultPrepMinutes, acceptsCod, serviceRadiusKm, ...changes },
  });
  world.lastResponse = response;
  return response;
}

const LUNCH_AND_DINNER = [
  { open: "10:00", close: "14:00" },
  { open: "17:00", close: "21:00" },
];

When(
  "they save hours of 10:00–14:00 and 17:00–21:00 from Monday to Saturday, closed on Sunday",
  async function (this: KlikWorld) {
    const hours = Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => [day, LUNCH_AND_DINNER]),
    );
    expectStatus(await saveSettings(this, { hours: { ...hours, sun: [] } }), 200);
  },
);

When(
  "they set a {int} minute prep time, no cash on delivery and a {int} km delivery radius",
  async function (this: KlikWorld, minutes: number, km: number) {
    expectStatus(
      await saveSettings(this, {
        defaultPrepMinutes: minutes,
        acceptsCod: false,
        serviceRadiusKm: km,
      }),
      200,
    );
  },
);

Then(
  "the store settings show those hours, {int} minutes, no cash on delivery and {int} km",
  async function (this: KlikWorld, minutes: number, km: number) {
    const saved = await settings(this);
    assert.deepEqual(saved.hours.mon, LUNCH_AND_DINNER);
    assert.deepEqual(saved.hours.sat, LUNCH_AND_DINNER);
    assert.deepEqual(saved.hours.sun, []);
    assert.equal(saved.defaultPrepMinutes, minutes);
    assert.equal(saved.acceptsCod, false);
    assert.equal(saved.serviceRadiusKm, km);
  },
);

When("they set a {int} km delivery radius", async function (this: KlikWorld, km: number) {
  await saveSettings(this, { serviceRadiusKm: km });
});

When(
  "they close the store on Christmas Day for {string}",
  async function (this: KlikWorld, reason: string) {
    const response = await this.api.post(`/api/merchant/${merchantId(this)}/closures`, {
      closedOn: nextChristmas(),
      reason,
    });
    expectStatus(response, 201);
  },
);

Then("Christmas Day is listed as a closure", async function (this: KlikWorld) {
  const closure = (await settings(this)).closures.find((c) => c.closedOn === nextChristmas());
  assert.ok(closure, "Christmas Day is not listed");
});

When("they remove the Christmas Day closure", async function (this: KlikWorld) {
  const closure = (await settings(this)).closures.find((c) => c.closedOn === nextChristmas());
  assert.ok(closure);
  const response = await this.api.request(
    "DELETE",
    `/api/merchant/${merchantId(this)}/closures/${closure.id}`,
  );
  expectStatus(response, 200);
});

Then("Christmas Day is no longer listed", async function (this: KlikWorld) {
  assert.equal(
    (await settings(this)).closures.find((c) => c.closedOn === nextChristmas()),
    undefined,
  );
});

Given(
  "a staff member of {string} signed in with their authenticator app",
  async function (this: KlikWorld, name: string) {
    const id = await merchantByName(this, name);
    this.merchant.staffApi = (
      await signedInStaff(this, "merchant_staff", { merchantId: id })
    ).client;
  },
);

function staffApi(world: KlikWorld): ApiClient {
  assert.ok(world.merchant.staffApi, "No staff member signed in");
  return world.merchant.staffApi;
}

When("the staff member opens the store", async function (this: KlikWorld) {
  const response = await staffApi(this).request("PUT", `/api/merchant/${merchantId(this)}/open`, {
    json: { isOpen: true },
  });
  expectStatus(response, 200);
});

Then("the store is open", async function (this: KlikWorld) {
  assert.equal((await settings(this)).isOpen, true);
});

When("the staff member tries to change the prep time", async function (this: KlikWorld) {
  await saveSettings(this, { defaultPrepMinutes: 45 }, staffApi(this));
});

// ---------- menu ----------

async function addCategory(world: KlikWorld, name: string): Promise<string> {
  const response = await world.api.post(menuPath(world, "/categories"), { name });
  expectStatus(response, 201);
  return data<{ id: string }>(response).id;
}

async function categoryId(world: KlikWorld, name: string): Promise<string> {
  const category = (await menu(world)).filter((c) => c.name === name).at(-1);
  assert.ok(category, `No category ${name}`);
  return category.id;
}

When("they add the category {string}", async function (this: KlikWorld, name: string) {
  await addCategory(this, name);
});

When(
  /^they add "([^"]+)" to "([^"]+)" for ₱([\d.,]+) with a required "([^"]+)" choice of "([^"]+)" or "([^"]+)" \(\+₱([\d.,]+)\)$/,
  async function (
    this: KlikWorld,
    name: string,
    category: string,
    price: string,
    group: string,
    first: string,
    second: string,
    extra: string,
  ) {
    const response = await this.api.post(menuPath(this, "/items"), {
      categoryId: await categoryId(this, category),
      name,
      price,
      modifierGroups: [
        {
          name: group,
          required: true,
          minSelect: 1,
          maxSelect: 1,
          options: [{ name: first }, { name: second, priceDelta: extra }],
        },
      ],
    });
    expectStatus(response, 201);
    this.merchant.items.set(name, data<{ id: string }>(response).id);
  },
);

Then(
  "{string} costs {int} centavos on the menu",
  async function (this: KlikWorld, name: string, centavos: number) {
    assert.equal((await findItem(this, name)).priceCentavos, centavos);
  },
);

Then(
  "{string} has a required {string} choice with {string} at {int} centavos extra",
  async function (this: KlikWorld, name: string, group: string, option: string, centavos: number) {
    const found = (await findItem(this, name)).modifierGroups.find((g) => g.name === group);
    assert.ok(found?.required, `${group} is not a required choice`);
    assert.equal(found.options.find((o) => o.name === option)?.priceDeltaCentavos, centavos);
  },
);

When(
  "they add the categories {string} and {string}",
  async function (this: KlikWorld, first: string, second: string) {
    await addCategory(this, first);
    await addCategory(this, second);
  },
);

When("they move {string} to the top", async function (this: KlikWorld, name: string) {
  const ids = (await menu(this)).map((c) => c.id);
  const top = await categoryId(this, name);
  const response = await this.api.request("PUT", menuPath(this, "/categories/order"), {
    json: { categoryIds: [top, ...ids.filter((id) => id !== top)] },
  });
  expectStatus(response, 200);
});

Then("{string} is the first category on the menu", async function (this: KlikWorld, name: string) {
  assert.equal((await menu(this))[0]?.name, name);
});

Given(
  "the menu has {string} for ₱{int}",
  async function (this: KlikWorld, name: string, pesos: number) {
    const category = await addCategory(this, "Test Meals");
    const response = await this.api.post(menuPath(this, "/items"), {
      categoryId: category,
      name,
      price: String(pesos),
    });
    expectStatus(response, 201);
    this.merchant.items.set(name, data<{ id: string }>(response).id);
  },
);

When("they mark {string} as sold out", async function (this: KlikWorld, name: string) {
  const item = await findItem(this, name);
  const response = await this.api.request("PUT", menuPath(this, `/items/${item.id}/availability`), {
    json: { isAvailable: false },
  });
  expectStatus(response, 200);
});

Then(
  "the public store page shows {string} as sold out",
  async function (this: KlikWorld, name: string) {
    const [store] = await this.db.query<{ slug: string }>(
      `select slug from public.merchants where id = $1`,
      [merchantId(this)],
    );
    const visitor = new ApiClient(BASE_URL);
    const response = await visitor.request("GET", `/api/stores/${store?.slug ?? ""}`);
    expectStatus(response, 200);
    const id = this.merchant.items.get(name);
    const item = data<{ menu: MenuCategory[] }>(response)
      .menu.flatMap((c) => c.items)
      .find((candidate) => candidate.id === id);
    assert.equal(item?.isAvailable, false);
    const page = await visitor.request("GET", `/stores/${store?.slug ?? ""}`);
    assert.match(page.bodyText, /Sold out/);
  },
);

When(
  "the staff member tries to rename a category of {string}",
  async function (this: KlikWorld, name: string) {
    const target = await merchantByName(this, name);
    const categories = await this.db.query<{ id: string; name: string }>(
      `select id, name from public.menu_categories where merchant_id = $1 order by sort, id`,
      [target],
    );
    this.merchant.categoryNamesBefore = categories.map((c) => c.name);
    assert.ok(categories[0], `${name} has no categories`);
    this.lastResponse = await staffApi(this).request(
      "PATCH",
      `/api/merchant/${target}/menu/categories/${categories[0].id}`,
      { json: { name: "Hacked" } },
    );
  },
);

Then("the categories of {string} are unchanged", async function (this: KlikWorld, name: string) {
  const categories = await this.db.query<{ name: string }>(
    `select name from public.menu_categories where merchant_id = $1 order by sort, id`,
    [await merchantByName(this, name)],
  );
  assert.deepEqual(
    categories.map((c) => c.name),
    this.merchant.categoryNamesBefore,
  );
});

When("they ask to upload a {int} KB WebP photo", async function (this: KlikWorld, kb: number) {
  this.lastResponse = await this.api.post(menuPath(this, "/photos"), {
    contentType: "image/webp",
    size: kb * 1024,
  });
});

Then("they get an upload link for a file in their store's folder", function (this: KlikWorld) {
  expectStatus(this.response(), 201);
  const upload = data<{ path: string; uploadUrl: string }>(this.response());
  assert.match(upload.path, new RegExp(`^${merchantId(this)}/[0-9a-f-]{36}\\.webp$`));
  assert.match(upload.uploadUrl, /^https?:\/\//);
});

/** Bytes that start like a WebP file (RIFF….WEBP); Storage checks size and declared type. */
function webpBytes(kb: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(kb * 1024);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBPVP8 "), 8);
  return bytes;
}

async function putToLink(uploadUrl: string, bytes: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "image/webp", "x-upsert": "false" },
    body: bytes,
  });
}

Then("a {int} KB WebP photo uploads to that link", async function (this: KlikWorld, kb: number) {
  const { uploadUrl, path } = data<{ uploadUrl: string; path: string }>(this.response());
  const upload = await putToLink(uploadUrl, webpBytes(kb));
  assert.ok(upload.ok, `upload failed with ${String(upload.status)}: ${await upload.text()}`);
  const [object] = await this.db.query<{ size: string }>(
    `select (metadata->>'size') as size from storage.objects where bucket_id = 'menu-photos' and name = $1`,
    [path],
  );
  assert.equal(Number(object?.size), kb * 1024);
  this.merchant.cleanups.push(async () => {
    // Storage rows can only be removed through the Storage API.
    await adminClient().storage.from("menu-photos").remove([path]);
  });
});

Then(
  "storage refuses a {int} KB file even with an upload link",
  async function (this: KlikWorld, kb: number) {
    const link = await this.api.post(menuPath(this, "/photos"), {
      contentType: "image/webp",
      size: 100 * 1024,
    });
    expectStatus(link, 201);
    const upload = await putToLink(data<{ uploadUrl: string }>(link).uploadUrl, webpBytes(kb));
    assert.ok(!upload.ok, "Storage accepted a file above the 200 KB bucket limit");
  },
);

// ---------- AI import ----------

async function importFile(
  world: KlikWorld,
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
  filename: string,
) {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), filename);
  return world.api.request("POST", menuPath(world, "/import"), { body: form });
}

/** A 1×1 PNG: the fake menu reader used in tests ignores the pixels. */
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

When("they import a photo of their printed menu", async function (this: KlikWorld) {
  this.merchant.itemCountBefore = (await menu(this)).flatMap((c) => c.items).length;
  const response = await importFile(this, TINY_PNG, "image/png", "menu.png");
  expectStatus(response, 200);
  this.merchant.drafts = data(response);
});

Then(
  "they see draft items with prices and how sure the reader is about each",
  function (this: KlikWorld) {
    const drafts = this.merchant.drafts as
      { name: string; priceCentavos: number; confidence: number }[] | undefined;
    assert.ok(drafts && drafts.length > 0, "No drafts");
    for (const draft of drafts) {
      assert.ok(draft.priceCentavos > 0, `${draft.name} has no price`);
      assert.ok(draft.confidence >= 0 && draft.confidence <= 1, `${draft.name} confidence`);
    }
  },
);

Then("none of the drafts is on the menu yet", async function (this: KlikWorld) {
  assert.equal((await menu(this)).flatMap((c) => c.items).length, this.merchant.itemCountBefore);
});

When(
  "they confirm the drafts after changing the price of {string} to ₱{int}",
  async function (this: KlikWorld, name: string, pesos: number) {
    const items = (this.merchant.drafts ?? []).map((draft) => ({
      category: draft.category,
      name: draft.name,
      ...(draft.description ? { description: draft.description } : {}),
      price: draft.name === name ? String(pesos) : (draft.priceCentavos / 100).toFixed(2),
    }));
    const response = await this.api.post(menuPath(this, "/import/confirm"), { items });
    expectStatus(response, 201);
    const created = (await menu(this))
      .flatMap((c) => c.items)
      .filter((item) => item.name === name)
      .at(-1);
    if (created) this.merchant.items.set(name, created.id);
  },
);

Then("the menu has a {string} category", async function (this: KlikWorld, name: string) {
  assert.ok(
    (await menu(this)).some((c) => c.name === name),
    `No ${name} category`,
  );
});

When("they import a text file as their menu", async function (this: KlikWorld) {
  this.lastResponse = await importFile(
    this,
    new TextEncoder().encode("Adobo 120"),
    "text/plain",
    "menu.txt",
  );
});

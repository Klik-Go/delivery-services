import AxeBuilder from "@axe-core/playwright";
import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  authStackConfigured,
  E2E_PHONES,
  merchantIdByName,
  resetTestNumberLimits,
  signedInMerchant,
  signInWithPhone,
  sql,
} from "./support/auth";

// Needs the seeded database and Supabase Realtime (CI starts both).
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

const AYALA = { lat: 14.5547, lng: 121.0244 };
/** Each project uses its own store and rider, so the two runs never compete for a job. */
const SETUP = {
  "mobile-pixel-7": { store: "Merienda Corner", item: "Pancit Canton" },
  "desktop-chrome": { store: "Aling Nena's Karinderya", item: "Pinakbet" },
} as const;
type Project = keyof typeof SETUP;
/** A 1×1 JPEG for the delivery photo. */
const PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function storeFacts(name: string): Promise<{ id: string; lat: number; lng: number }> {
  const rows = await sql(
    `select id, extensions.st_y(location::extensions.geometry) as lat,
            extensions.st_x(location::extensions.geometry) as lng
       from public.merchants where name = $1`,
    [name],
  );
  const row = rows.rows[0] as { id: string; lat: number; lng: number } | undefined;
  if (!row) throw new Error(`No store ${name} (run pnpm db:reset)`);
  return row;
}

/** Makes the signed-in test number an approved rider in the store's zone, free and offline. */
async function approvedRider(userId: string, merchantId: string): Promise<string> {
  await sql(
    `insert into public.user_roles (user_id, role) select $1, 'rider'
      where not exists (select 1 from public.user_roles where user_id = $1 and role = 'rider')`,
    [userId],
  );
  const rows = await sql(
    `insert into public.riders (user_id, zone_id, vehicle_type, plate_no, status, is_online)
     select $1, zone_id, 'motorcycle', 'E2E 0001', 'active', false from public.merchants where id = $2
     on conflict (user_id) do update set status = 'active', is_online = false
     returning id`,
    [userId, merchantId],
  );
  const riderId = (rows.rows[0] as { id: string }).id;
  await sql(`update public.profiles set full_name = 'Ella Rider' where id = $1`, [userId]);
  // Earlier runs' cash is never remitted (Phase 10): give the rider a full limit of room.
  await sql(
    `update public.riders r set cash_limit_centavos = 300000 + coalesce((
        select sum(le.debit_centavos - le.credit_centavos) from public.ledger_entries le
         where le.account = 'rider_cash_on_hand' and le.party_id = r.id), 0)
      where r.id = $1`,
    [riderId],
  );
  await sql(
    `update public.dispatch_offers set status = 'expired' where rider_id = $1 and status = 'offered'`,
    [riderId],
  );
  await sql(
    `update public.orders set rider_id = null
      where rider_id = $1 and status in ('accepted', 'preparing', 'ready', 'picked_up')`,
    [riderId],
  );
  return riderId;
}

async function placeCodOrder(
  api: APIRequestContext,
  merchantId: string,
  item: string,
): Promise<{ id: string; code: string }> {
  const rows = await sql(`select id from public.menu_items where merchant_id = $1 and name = $2`, [
    merchantId,
    item,
  ]);
  const itemId = (rows.rows[0] as { id: string } | undefined)?.id;
  if (!itemId) throw new Error(`No ${item} (run pnpm db:reset)`);
  const response = await api.post("/api/orders", {
    headers: { "Idempotency-Key": `e2e-rider-${crypto.randomUUID()}` },
    data: {
      merchantId,
      items: [{ itemId, quantity: 2, optionIds: [] }],
      dropoff: AYALA,
      tipCentavos: 2000,
      paymentMethod: "cod",
      address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000111" },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const placed = (await response.json()) as { data: { orderId: string; code: string } };
  return { id: placed.data.orderId, code: placed.data.code };
}

async function slide(page: Page, name: string): Promise<void> {
  await page.getByRole("slider", { name }).fill("100");
}

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

test.describe("Feature: rider app, dispatch and live tracking", () => {
  test("Scenario: the nearest rider takes the job and the customer follows them on the map", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    const project = testInfo.project.name as Project;
    const { store: storeName, item } = SETUP[project];
    const phones = E2E_PHONES[project];
    const store = await storeFacts(storeName);
    const allDay = [{ open: "00:00", close: "23:59" }];
    await sql(
      `update public.merchants set hours = $2, is_open = true, accepts_cod = true where id = $1`,
      [
        store.id,
        JSON.stringify(
          Object.fromEntries(
            ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, allDay]),
          ),
        ),
      ],
    );
    const merchantId = await merchantIdByName(storeName);
    const owner = await signedInMerchant(baseURL ?? "", merchantId);

    // The rider's phone: Pixel 7 with GPS at the store.
    const riderContext: BrowserContext = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL: baseURL ?? "",
      geolocation: { latitude: store.lat + 0.0002, longitude: store.lng },
      permissions: ["geolocation"],
    });
    const riderUserId = await signInWithPhone(riderContext.request, phones.rider);
    await approvedRider(riderUserId, merchantId);
    const riderPage = await riderContext.newPage();
    await riderPage.goto("/rider");
    await expect(riderPage.getByTestId("rider-online")).toHaveText("You're offline");
    await riderPage.getByRole("button", { name: "Go online" }).click();
    await expect(riderPage.getByTestId("rider-online")).toHaveText("You're online");
    await expect(riderPage.getByText("Sharing your location", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(riderPage.getByTestId("waiting-for-jobs")).toBeVisible();

    // The customer orders and watches the order page.
    await signInWithPhone(page.request, phones.tracker);
    const order = await placeCodOrder(page.request, merchantId, item);
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId("order-status")).toHaveText("Sent to the store");

    const accepted = await owner.post(`/api/orders/${order.id}/accept`, {
      data: { prepMinutes: 10 },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);

    // The offer reaches the rider with the pay upfront and a 30-second countdown.
    const offer = riderPage.getByTestId("offer-card");
    await expect(offer).toBeVisible({ timeout: 10_000 });
    await expect(offer).toContainText(storeName);
    await expect(riderPage.getByTestId("offer-pay")).toContainText("Earn ₱");
    await expect(riderPage.getByTestId("cod-banner")).toContainText("Collect ₱");
    await expect(riderPage.getByTestId("offer-countdown")).toHaveText(/^(30|29|28|27|26|25)s$/);
    expect(await seriousViolations(riderPage)).toEqual([]);
    await shot(riderPage, `${project}-rider-offer`);
    await expect(page.getByTestId("finding-rider")).toBeVisible();

    await slide(riderPage, "Slide to accept");
    const job = riderPage.getByTestId("job-card");
    await expect(job).toBeVisible();
    await expect(riderPage.getByTestId("job-step")).toHaveText("Go to the store");
    await expect(riderPage.getByTestId("masked-contact")).toContainText("+63 ••• ••• 0111");
    await expect(riderPage.getByTestId("waze-link")).toHaveAttribute(
      "href",
      `https://waze.com/ul?ll=${store.lat.toFixed(6)},${store.lng.toFixed(6)}&navigate=yes`,
    );
    expect(await seriousViolations(riderPage)).toEqual([]);
    await shot(riderPage, `${project}-rider-job`);

    // The customer now sees the rider on the map with an arrival estimate.
    await expect(page.getByTestId("rider-on-map")).toContainText("Ella is delivering your order", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("tracking-eta")).toContainText("Arriving in about");

    // The rider rides off: the customer's map follows (positions are throttled to one per 7 s).
    await riderPage.waitForTimeout(7500);
    const moved = { latitude: (store.lat + AYALA.lat) / 2, longitude: (store.lng + AYALA.lng) / 2 };
    await riderContext.setGeolocation(moved);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/orders/${order.id}/tracking`);
          const body = (await response.json()) as {
            data: { rider: { location: { lat: number } | null } | null };
          };
          return body.data.rider?.location?.lat.toFixed(4);
        },
        { timeout: 20_000 },
      )
      .toBe(moved.latitude.toFixed(4));
    await expect(page.getByTestId("tracking-eta")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${project}-customer-map`);

    // Store → pickup → delivery with a photo.
    await slide(riderPage, "Slide: I'm at the store");
    await expect(riderPage.getByTestId("waiting-for-store")).toBeVisible();
    const ready = await owner.post(`/api/orders/${order.id}/ready`, { data: {} });
    expect(ready.status(), await ready.text()).toBe(200);
    await slide(riderPage, "Slide: I have the order");
    await expect(riderPage.getByTestId("job-step")).toHaveText("Deliver to the customer");
    await expect(page.getByTestId("order-status")).toHaveText("On the way", { timeout: 10_000 });
    await riderPage
      .getByLabel("Photo of the order at the door")
      .setInputFiles({ name: "proof.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    await slide(riderPage, "Slide: delivered");
    await expect(job).toBeHidden({ timeout: 10_000 });
    await expect(riderPage.getByTestId("earnings-today")).not.toHaveText("₱0.00");
    await shot(riderPage, `${project}-rider-earnings`);

    // Delivered: the map and the rider disappear for the customer.
    await expect(page.getByTestId("order-status")).toHaveText("Delivered", { timeout: 10_000 });
    await expect(page.getByTestId("tracking")).toBeHidden();

    // Offline: the app stops sharing and the server refuses positions.
    await riderPage.getByRole("button", { name: "Go offline" }).click();
    await expect(riderPage.getByTestId("rider-online")).toHaveText("You're offline");
    const refused = await riderContext.request.post("/api/rider/location", {
      data: { lat: AYALA.lat, lng: AYALA.lng },
    });
    expect(refused.status()).toBe(409);
    await riderContext.close();
    await owner.dispose();
  });
});

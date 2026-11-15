import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import pg from "pg";
import {
  authStackConfigured,
  E2E_PHONES,
  resetTestNumberLimits,
  signedInStaff,
  signInWithPhone,
  sql,
} from "./support/auth";

// Needs the seeded database (CI starts it).
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

const AYALA = { lat: 14.5547, lng: 121.0244 };
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
type Project = "mobile-pixel-7" | "desktop-chrome";
const RIDER: Record<Project, string> = {
  "mobile-pixel-7": "5eed0000-0000-4000-8000-000000000201",
  "desktop-chrome": "5eed0000-0000-4000-8000-000000000202",
};

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/**
 * A delivered order of 2 Kapeng Barako (less sugar) from Kape't Tinapay, as checkout, the store
 * and the rider would leave it (each status change goes through the database's transition guard).
 */
async function deliveredOrder(customerId: string, riderId: string): Promise<string> {
  const item = await sql(
    `select i.id as item_id, o.id as option_id from public.menu_items i
       join public.merchants m on m.id = i.merchant_id
       join public.modifier_groups g on g.menu_item_id = i.id
       join public.modifier_options o on o.modifier_group_id = g.id
      where m.slug = 'kapet-tinapay' and i.name = 'Kapeng Barako' and o.name = 'Less sugar'`,
  );
  const { item_id: itemId, option_id: optionId } = item.rows[0] as {
    item_id: string;
    option_id: string;
  };
  const order = await sql(
    `insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method, subtotal_centavos,
                                delivery_fee_centavos, total_centavos, address_snapshot, dropoff)
     select $1, m.id, m.zone_id, 'placed', 'cod', 12000, 3900, 15900,
            '{"label":"Office","landmark":"Blue tower lobby","contact_phone":"+639170000105"}',
            extensions.st_setsrid(extensions.st_makepoint($3, $2), 4326)::extensions.geography
       from public.merchants m where m.slug = 'kapet-tinapay' returning id`,
    [customerId, AYALA.lat, AYALA.lng],
  );
  const orderId = (order.rows[0] as { id: string }).id;
  await sql(
    `insert into public.order_items (order_id, menu_item_id, name_snapshot, unit_price_centavos, quantity,
                                     modifiers_snapshot, line_total_centavos)
     values ($1, $2, 'Kapeng Barako', 6000, 2, $3, 12000)`,
    [orderId, itemId, JSON.stringify([{ id: optionId, name: "Less sugar" }])],
  );
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('klikgo.actor_role', '', true)");
    for (const status of ["accepted", "preparing", "ready", "picked_up", "delivered"]) {
      await client.query(
        `update public.orders set status = $2::public.order_status,
                rider_id = case when $2 = 'picked_up' then $3::uuid else rider_id end
          where id = $1`,
        [orderId, status, riderId],
      );
    }
    await client.query("commit");
  } finally {
    await client.end();
  }
  return orderId;
}

test.beforeAll(async () => {
  const allDay = [{ open: "00:00", close: "23:59" }];
  const hours = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [day, allDay]),
  );
  await sql(
    "update public.merchants set hours = $1, is_open = true, accepts_cod = true where slug = 'kapet-tinapay'",
    [JSON.stringify(hours)],
  );
});

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

test.describe("Feature: ratings, order again and rewards", () => {
  test("Scenario: the customer rates a delivered order, orders it again and uses a voucher", async ({
    page,
  }, testInfo) => {
    const project = testInfo.project.name as Project;
    const customerId = await signInWithPhone(page.request, E2E_PHONES[project].regular);
    const pin = await page.request.put("/api/location", {
      data: { location: AYALA, label: "E2E pin" },
    });
    expect(pin.ok()).toBe(true);
    const orderId = await deliveredOrder(customerId, RIDER[project]);

    // Rate the store and the rider on the delivered order.
    await page.goto(`/orders/${orderId}`);
    const sheet = page.getByTestId("rating-sheet");
    await expect(sheet.getByRole("heading", { name: "How was your order?" })).toBeVisible();
    const store = sheet.locator('[data-rating="merchant"]');
    await store.getByRole("radio", { name: "5 stars" }).click();
    await store.getByRole("button", { name: "Tasty" }).click();
    await store.getByRole("button", { name: "Hot food" }).click();
    const rider = sheet.locator('[data-rating="rider"]');
    await rider.getByRole("radio", { name: "4 stars" }).click();
    await rider.getByRole("button", { name: "Friendly" }).click();
    await shot(page, `${project}-rating`);
    await sheet.getByRole("button", { name: "Send rating" }).click();
    await expect(sheet.getByRole("status")).toHaveText("Thanks! Your rating was saved.");
    await expect(sheet.getByRole("button", { name: "Update rating" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    // The order history lists it; "Order again" fills the cart with today's price.
    await page.goto("/orders");
    const row = page.locator("[data-testid=order-history] li").first();
    await expect(row).toContainText("2× Kapeng Barako");
    await shot(page, `${project}-order-history`);
    expect(await seriousViolations(page)).toEqual([]);
    await row.getByRole("button", { name: "Order again" }).click();
    await page.waitForURL(/\/cart$/);
    await expect(page.getByText("Kapeng Barako").first()).toBeVisible();

    // A free-delivery voucher from the stamp card is used at checkout from Rewards.
    await sql(
      `insert into public.promos (code, type, starts_at, ends_at, max_redemptions, owner_id, source, description)
       values ($1, 'free_delivery', now() - interval '1 minute', now() + interval '90 days', 1, $2, 'loyalty', 'Free delivery: 10 stamps collected')`,
      [
        `LOYALE2E${project === "desktop-chrome" ? "D" : "M"}${String(Date.now()).slice(-6)}`,
        customerId,
      ],
    );
    await page.goto("/rewards");
    await expect(page.getByTestId("referral-code")).toHaveText(/^[A-Z2-9]{8}$/);
    await expect(page.getByTestId("stamp-card")).toContainText("Stamp card");
    const voucher = page.locator("[data-testid=vouchers] li").first();
    await expect(voucher).toContainText("Free delivery");
    await shot(page, `${project}-rewards`);
    expect(await seriousViolations(page)).toEqual([]);
    await voucher.getByRole("link", { name: "Use at checkout" }).click();
    await page.waitForURL(/\/checkout\?promo=/);
    await expect(page.getByText(/applied/i).first()).toBeVisible();
  });

  test("Scenario: a low rating reaches the zone's coordinator, who marks it done", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const project = testInfo.project.name as Project;
    const customerId = await signInWithPhone(page.request, E2E_PHONES[project].regular);
    const orderId = await deliveredOrder(customerId, RIDER[project]);
    const rated = await page.request.post(`/api/orders/${orderId}/ratings`, {
      data: { merchant: { score: 1, tags: ["cold_food"], comment: "Cold when it arrived" } },
    });
    expect(rated.ok()).toBe(true);

    const zone = await sql("select id from public.zones where slug = 'makati'");
    const staff = await signedInStaff(baseURL ?? "", "coordinator", {
      zoneId: (zone.rows[0] as { id: string }).id,
    });
    const device = project === "desktop-chrome" ? {} : devices["Pixel 7"];
    const context = await browser.newContext({ ...device, baseURL: baseURL ?? "" });
    await context.addCookies((await staff.storageState()).cookies);
    const ops = await context.newPage();
    await ops.goto("/admin/tickets");
    const code = (await sql("select code from public.orders where id = $1", [orderId])).rows[0] as {
      code: string;
    };
    const ticket = ops.locator(`[data-ticket="${code.code}"]`);
    await expect(ticket).toContainText("rated 1/5");
    await expect(ticket).toContainText("Cold when it arrived");
    await shot(ops, `${project}-low-rating-ticket`);
    expect(await seriousViolations(ops)).toEqual([]);
    await ticket.getByLabel("What did you do?").fill("Called the store; sent a voucher");
    await ticket.getByRole("button", { name: "Mark as done" }).click();
    await expect(ticket).toHaveCount(0);
    await context.close();
  });
});

import AxeBuilder from "@axe-core/playwright";
import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  authStackConfigured,
  E2E_PHONES,
  merchantIdByName,
  resetTestNumberLimits,
  signedInMerchant,
  signedInStaff,
  signInWithPhone,
  sql,
} from "./support/auth";

// Needs the seeded database (CI starts it).
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

const AYALA = { lat: 14.5547, lng: 121.0244 };
const SHOTS = process.env.E2E_SCREENSHOT_DIR;
type Project = "mobile-pixel-7" | "desktop-chrome";
/** Each project hands its order to a different seeded rider, so parallel runs never collide. */
const RIDER: Record<Project, string> = {
  "mobile-pixel-7": "Rico Rider",
  "desktop-chrome": "Rosa Rider",
};
const PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
const DOCUMENTS = [
  "government_id",
  "drivers_license",
  "vehicle_registration",
  "selfie_with_id",
  "payout_account",
];

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function makatiId(): Promise<string> {
  const rows = await sql("select id from public.zones where slug = 'makati'");
  return (rows.rows[0] as { id: string }).id;
}

async function consolePage(
  browser: Browser,
  baseURL: string,
  testInfo: TestInfo,
  staff: APIRequestContext,
): Promise<Page> {
  const device =
    testInfo.project.name === "mobile-pixel-7" ? devices["Pixel 7"] : devices["Desktop Chrome"];
  const context = await browser.newContext({ ...device, baseURL });
  await context.addCookies((await staff.storageState()).cookies);
  return context.newPage();
}

async function acceptedOrder(
  customer: APIRequestContext,
  owner: APIRequestContext,
  merchantId: string,
): Promise<{ id: string; code: string }> {
  const rows = await sql(
    `select i.id as item, o.id as option from public.menu_items i
       join public.modifier_groups g on g.menu_item_id = i.id
       join public.modifier_options o on o.modifier_group_id = g.id
      where i.merchant_id = $1 and i.name = 'Kapeng Barako' and o.name = 'Less sugar'`,
    [merchantId],
  );
  const row = rows.rows[0] as { item: string; option: string };
  const placed = await customer.post("/api/orders", {
    headers: { "Idempotency-Key": `e2e-ops-${crypto.randomUUID()}` },
    data: {
      merchantId,
      items: [{ itemId: row.item, quantity: 2, optionIds: [row.option] }],
      dropoff: AYALA,
      tipCentavos: 0,
      paymentMethod: "cod",
      address: { label: "Office", landmark: "Blue tower lobby", contactPhone: "09170000111" },
    },
  });
  expect(placed.status(), await placed.text()).toBe(201);
  const order = ((await placed.json()) as { data: { orderId: string; code: string } }).data;
  const accepted = await owner.post(`/api/orders/${order.orderId}/accept`, {
    data: { prepMinutes: 15 },
  });
  expect(accepted.status(), await accepted.text()).toBe(200);
  return { id: order.orderId, code: order.code };
}

test.beforeAll(async () => {
  const allDay = [{ open: "00:00", close: "23:59" }];
  const hours = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, allDay]),
  );
  await sql(
    "update public.merchants set hours = $1, is_open = true, accepts_cod = true where slug = 'kapet-tinapay'",
    [JSON.stringify(hours)],
  );
});

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

test.describe("Feature: coordinator and admin console", () => {
  test("Scenario: the coordinator finds a live order, leaves a note and hands it to a rider", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90_000);
    const project = testInfo.project.name as Project;
    const merchantId = await merchantIdByName("Kape't Tinapay");
    const owner = await signedInMerchant(baseURL ?? "", merchantId);
    await signInWithPhone(page.request, E2E_PHONES[project].tracker);
    const order = await acceptedOrder(page.request, owner, merchantId);
    // Free the rider from any job an earlier run left behind.
    await sql(
      `update public.orders set rider_id = null where rider_id = (select r.id from public.riders r join public.profiles p on p.id = r.user_id where p.full_name = $1)
         and status in ('accepted', 'preparing', 'ready', 'picked_up')`,
      [RIDER[project]],
    );

    const coordinator = await signedInStaff(baseURL ?? "", "coordinator", {
      zoneId: await makatiId(),
    });
    const consoleTab = await consolePage(browser, baseURL ?? "", testInfo, coordinator);
    await consoleTab.goto("/admin");
    await expect(consoleTab.getByRole("heading", { level: 1, name: "Live orders" })).toBeVisible();
    const card = consoleTab.locator(`[data-code="${order.code}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator("[data-sla]")).toHaveText("On time");
    expect(await seriousViolations(consoleTab)).toEqual([]);
    await shot(consoleTab, `${project}-console-board`);

    await card.getByRole("link", { name: "Open" }).click();
    await expect(consoleTab.getByTestId("ops-order-status")).toHaveText("Being prepared");
    await expect(consoleTab.getByTestId("ops-history")).toContainText("Accepted by the store");

    await consoleTab
      .getByRole("textbox", { name: "Note" })
      .fill("Customer asked us to call on arrival");
    await consoleTab.getByRole("button", { name: "Add note" }).click();
    await expect(consoleTab.getByTestId("ops-notes")).toContainText(
      "Customer asked us to call on arrival",
    );

    const riderRow = await sql(
      "select r.id from public.riders r join public.profiles p on p.id = r.user_id where p.full_name = $1",
      [RIDER[project]],
    );
    await consoleTab
      .getByLabel("Choose a rider")
      .selectOption((riderRow.rows[0] as { id: string }).id);
    await consoleTab.locator("#assign-reason").fill("Rider is waiting at the store");
    await consoleTab.getByRole("button", { name: "Assign" }).click();
    await expect(consoleTab.getByRole("heading", { name: "Move to another rider" })).toBeVisible({
      timeout: 10_000,
    });
    expect(await seriousViolations(consoleTab)).toEqual([]);
    await shot(consoleTab, `${project}-console-order`);

    // Leave nothing assigned for the next run.
    await coordinator.post(`/api/admin/orders/${order.id}/cancel`, {
      data: { reason: "End of e2e run" },
    });
    await consoleTab.context().close();
    await owner.dispose();
    await coordinator.dispose();
  });

  test("Scenario: the coordinator reviews a new rider's documents and approves them", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(90_000);
    const project = testInfo.project.name as Project;
    const userId = await signInWithPhone(page.request, E2E_PHONES[project].applicant);
    await sql("delete from public.riders where user_id = $1", [userId]);
    await sql("delete from public.user_roles where user_id = $1 and role = 'rider'", [userId]);
    const name = project === "mobile-pixel-7" ? "Mika Applicant" : "Dina Applicant";

    // The applicant applies and uploads from the become-a-rider page's API.
    const applied = await page.request.post("/api/rider/application", {
      data: {
        zoneId: await makatiId(),
        vehicleType: "motorcycle",
        plateNo: "APP 1234",
        fullName: name,
        payoutAccountName: name,
      },
    });
    expect(applied.status(), await applied.text()).toBe(201);
    for (const type of DOCUMENTS) {
      const uploaded = await page.request.post("/api/rider/application/documents", {
        multipart: { type, file: { name: `${type}.jpg`, mimeType: "image/jpeg", buffer: PHOTO } },
      });
      expect(uploaded.status(), await uploaded.text()).toBe(201);
    }
    await page.goto("/become-a-rider");
    await expect(page.getByTestId("kyc-checklist").locator('[data-state="pending"]')).toHaveCount(
      5,
    );

    const coordinator = await signedInStaff(baseURL ?? "", "coordinator", {
      zoneId: await makatiId(),
    });
    const consoleTab = await consolePage(browser, baseURL ?? "", testInfo, coordinator);
    await consoleTab.goto("/admin/riders");
    const card = consoleTab.locator(`[data-rider="${name}"]`);
    await expect(card).toBeVisible();
    expect(await seriousViolations(consoleTab)).toEqual([]);
    await shot(consoleTab, `${project}-console-kyc`);

    // Viewing opens a 60-second signed link in a new tab.
    const popup = consoleTab.waitForEvent("popup");
    await card.locator('[data-doc="government_id"]').getByRole("button", { name: "View" }).click();
    expect((await popup).url()).toContain("/storage/v1/object/sign/rider-kyc/");

    for (const type of DOCUMENTS) {
      await card.locator(`[data-doc="${type}"]`).getByRole("button", { name: "Accept" }).click();
      await expect(card.locator(`[data-doc="${type}"] [data-state]`)).toHaveText("Accepted");
    }
    await card.getByRole("button", { name: "Approve rider" }).click();
    await expect(card).toBeHidden();
    await page.goto("/become-a-rider");
    await expect(page.getByRole("status")).toContainText("You're approved");
    await consoleTab.context().close();
    await coordinator.dispose();
  });

  test("Scenario: an admin opens zones, settings and staff", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const project = testInfo.project.name as Project;
    const admin = await signedInStaff(baseURL ?? "", "admin");
    const consoleTab = await consolePage(browser, baseURL ?? "", testInfo, admin);
    await consoleTab.goto("/admin/zones");
    await expect(consoleTab.locator('[data-zone="makati"]')).toBeVisible();
    await expect(consoleTab.locator('[data-rule="Up to 2 km"]')).toBeVisible();
    expect(await seriousViolations(consoleTab)).toEqual([]);
    await shot(consoleTab, `${project}-console-zones`);
    await consoleTab.goto("/admin/settings");
    await expect(consoleTab.locator('[data-flag="dispatch"]')).toBeVisible();
    expect(await seriousViolations(consoleTab)).toEqual([]);
    await consoleTab.goto("/admin/staff");
    await expect(consoleTab.getByRole("heading", { name: "Invite staff" })).toBeVisible();
    await expect(consoleTab.getByTestId("ops-staff")).toBeVisible();
    expect(await seriousViolations(consoleTab)).toEqual([]);
    await consoleTab.context().close();
    await admin.dispose();
  });
});

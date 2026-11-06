import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  authStackConfigured,
  E2E_PHONES,
  resetTestNumberLimits,
  signInWithPhone,
  sql,
} from "./support/auth";

// Needs the seeded local database and PAYMENT_GATEWAY=fake (the /dev/pay page); CI sets both.
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

const AYALA = { lat: 14.5547, lng: 121.0244 };
const peso = (amount: string): RegExp => new RegExp(`₱\\s?${amount.replace(".", "\\.")}`);

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

/** Signs in the project's test customer, sets the pin and fills the cart with 2 Kapeng Barako. */
async function readyToCheckout(page: Page, project: string): Promise<string> {
  const phones = E2E_PHONES[project as keyof typeof E2E_PHONES];
  const userId = await signInWithPhone(page.request, phones.customer);
  const pin = await page.request.put("/api/location", {
    data: { location: AYALA, label: "E2E pin" },
  });
  expect(pin.ok()).toBe(true);
  await page.goto("/s/kapet-tinapay");
  await page.getByRole("button", { name: /Kapeng Barako/ }).click();
  const sheet = page.getByRole("dialog", { name: "Kapeng Barako" });
  await sheet.getByLabel("Less sugar").check();
  await sheet.getByRole("button", { name: "More" }).click();
  await sheet.getByRole("button", { name: /Add to cart/ }).click();
  await page.getByRole("link", { name: /View cart/ }).click();
  await page.getByRole("link", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await page.getByLabel("Landmark for the rider").fill("Blue tower lobby, 3rd floor");
  await page.getByLabel("Contact number").fill("09170000105");
  return userId;
}

async function ordersSince(userId: string, since: Date): Promise<number> {
  const result = await sql(
    "select count(*)::int as n from public.orders where customer_id = $1 and created_at >= $2",
    [userId, since],
  );
  return (result.rows[0] as { n: number }).n;
}

test.beforeAll(async () => {
  // The seeded store keeps lunch and dinner hours; checkout tests run at any hour, so it stays
  // open all day for this run (a `pnpm db:reset` restores the seed).
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

test.describe("Feature: checkout", () => {
  // One test customer per project: its orders are counted, so its tests run one at a time.
  test.describe.configure({ mode: "serial" });

  test("Scenario: cash on delivery from one checkout screen goes straight to the store", async ({
    page,
  }, testInfo) => {
    await readyToCheckout(page, testInfo.project.name);
    const summary = page.getByTestId("checkout-summary");
    await expect(summary.getByText("Total", { exact: true }).locator("..")).toContainText(
      peso("179.00"),
    );
    await page.getByRole("button", { name: "₱20.00" }).click();
    await expect(summary.getByText("Rider tip").locator("..")).toContainText(peso("20.00"));
    await page.getByLabel("Cash on delivery").check();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole("button", { name: /Place order · ₱\s?199\.00/ }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Order KG-[A-Z2-9]{6}/ }),
    ).toBeVisible();
    await expect(page.getByTestId("order-status")).toHaveText("Sent to the store");
    await expect(page.getByText(/Cash on delivery · Not paid yet/)).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("Scenario: paying with GCash on the payment page sends the order to the store", async ({
    page,
  }, testInfo) => {
    await readyToCheckout(page, testInfo.project.name);
    await page.getByLabel("GCash").check();
    await page.getByRole("button", { name: /Place order · ₱\s?179\.00/ }).click();
    await page.waitForURL(/\/dev\/pay\?session=/);
    await expect(page.getByText(/Test mode: no real money moves/)).toBeVisible();
    await page.getByRole("button", { name: /Pay ₱\s?179\.00/ }).click();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}\?paid=1$/);
    await expect(page.getByTestId("order-status")).toHaveText("Sent to the store");
    await expect(page.getByText(/GCash · Paid/)).toBeVisible();
  });

  test("Scenario: double-tapping Place order creates one order", async ({ page }, testInfo) => {
    const userId = await readyToCheckout(page, testInfo.project.name);
    await page.getByLabel("Cash on delivery").check();
    const since = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: /Place order/ }).dblclick();
    await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
    expect(await ordersSince(userId, since)).toBe(1);
  });

  test("Scenario: checkout asks guests to sign in first", async ({ page }) => {
    await page.goto("/checkout");
    await page.waitForURL(/\/auth\/sign-in\?next=%2Fcheckout|\/auth\/sign-in\?next=\/checkout/);
  });
});

import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { agreeIfAsked, authStackConfigured, signedInStaff, sql } from "./support/auth";

// Needs the seeded database (CI starts it) and the placeholder code for fresh customers and riders.
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");
const PLACEHOLDER = process.env.PLACEHOLDER_OTP_CODE;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

/**
 * Each project shops in its own corner of Makati with its own budget, and its rider's float
 * covers only that budget, so the two runs never take each other's job.
 */
const SETUP = {
  "mobile-pixel-7": { at: { lat: 14.5588, lng: 121.0205 }, budget: 600, float: 700 },
  "desktop-chrome": { at: { lat: 14.545, lng: 121.035 }, budget: 800, float: 900 },
} as const;
type Project = keyof typeof SETUP;

/** A 1×1 JPEG for the receipt and the delivery photo. */
const PHOTO = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const network = (): string =>
  `10.${String(randomInt(0, 256))}.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`;
const mobile = (): string => `0918${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;

/** Signs a fresh number in with the placeholder code (the sign-in form) and agrees to the terms. */
async function signIn(page: Page, next: string): Promise<void> {
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Mobile number").fill(mobile());
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Digit 1").fill(PLACEHOLDER ?? "");
  await page.getByRole("button", { name: "Verify" }).click();
  await agreeIfAsked(page);
}

async function slide(page: Page, name: string): Promise<void> {
  await page.getByRole("slider", { name }).fill("100");
}

test.beforeAll(async ({ baseURL }) => {
  // Pabili is off by default; switch it on through the admin API (which also clears the cache).
  const admin = await signedInStaff(baseURL ?? "", "admin");
  const on = await admin.put("/api/admin/settings/flags/pabili", {
    data: {
      enabled: true,
      rollout: {
        max_item_centavos: 150_000,
        service_fee_centavos: 4_900,
        max_items: 20,
        max_trip_m: 5000,
      },
    },
  });
  expect(on.status(), await on.text()).toBe(200);
  await admin.dispose();
});

test.describe("Feature: Pabili, a rider buys a shopping list", () => {
  test("Scenario: a customer sends a list; a rider with enough float shops, sends the receipt and delivers", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(!PLACEHOLDER, "Needs PLACEHOLDER_OTP_CODE for fresh customers and riders");
    test.setTimeout(150_000);
    const project = testInfo.project.name as Project;
    const { at, budget, float } = SETUP[project];

    // The rider: a fresh, approved rider in Makati on a Pixel 7 at the shop.
    const riderContext = await browser.newContext({
      ...devices["Pixel 7"],
      baseURL: baseURL ?? "",
      geolocation: { latitude: at.lat + 0.0002, longitude: at.lng },
      permissions: ["geolocation"],
      extraHTTPHeaders: { "x-forwarded-for": network() },
    });
    const riderPage = await riderContext.newPage();
    await signIn(riderPage, "/rider");
    const me = (await (await riderContext.request.get("/api/me")).json()) as {
      data: { userId: string };
    };
    await sql(
      `insert into public.user_roles (user_id, role) values ($1, 'rider') on conflict do nothing`,
      [me.data.userId],
    );
    await sql(
      `insert into public.riders (user_id, zone_id, vehicle_type, plate_no, status, is_online)
       select $1, id, 'motorcycle', 'PAB 0001', 'active', false from public.zones where slug = 'makati'
       on conflict (user_id) do update set status = 'active'`,
      [me.data.userId],
    );
    await sql(`update public.profiles set full_name = 'Pia Rider' where id = $1`, [me.data.userId]);
    await riderPage.goto("/rider");
    await riderPage.getByRole("button", { name: "Go online" }).click();
    await expect(riderPage.getByText("Sharing your location", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const floatCard = riderPage.getByTestId("pabili-float");
    await expect(floatCard).toContainText("You don't take Pabili jobs.");
    await floatCard.getByLabel("Your float (₱, 0 = no Pabili)").fill(String(float));
    await floatCard.getByRole("button", { name: "Save" }).click();
    await expect(riderPage.getByTestId("pabili-float-current")).toContainText(
      `₱${String(float)}.00`,
    );
    expect(await seriousViolations(riderPage)).toEqual([]);

    // The customer writes the list on the Pabili page.
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": network() });
    await signIn(page, "/pabili");
    const pin = await page.request.put("/api/location", {
      data: { location: at, label: "E2E pin" },
    });
    expect(pin.ok()).toBe(true);
    await page.goto("/pabili");
    await expect(page.getByRole("heading", { level: 1, name: "Pabili" })).toBeVisible();
    await page.getByLabel("Store name").fill("Aling Nena Sari-sari");
    await page.getByLabel("How to find it (optional)").fill("Beside the chapel");
    await page.getByLabel("Item 1", { exact: true }).fill("Eggs (medium)");
    await page.getByLabel("How many").first().fill("12");
    await page.getByRole("button", { name: "Add an item" }).click();
    await page.getByLabel("Item 2", { exact: true }).fill("Pandesal");
    await page.getByLabel("How many").nth(1).fill("10");
    await page.getByLabel("Most the rider may spend on items (₱)").fill(String(budget));
    await page.getByLabel("Landmark for the rider").fill("Blue gate");
    await page.getByLabel("Contact number").fill("09170000199");
    await expect(page.getByTestId("pabili-max")).toContainText(`₱${String(budget + 88)}.00`, {
      timeout: 10_000,
    });
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${project}-pabili-form`);
    await page.getByRole("button", { name: /Send to a rider/ }).click();
    await page.waitForURL(/\/orders\//);
    await expect(page.getByTestId("pabili-panel")).toContainText(
      "Pabili from Aling Nena Sari-sari",
    );
    await expect(page.getByTestId("order-status")).toHaveText(
      /Finding a rider to buy your items|Your rider is shopping/,
    );

    // The rider gets the offer with the budget, accepts and shops.
    await expect(riderPage.getByTestId("offer-pabili")).toContainText(`₱${String(budget)}.00`, {
      timeout: 15_000,
    });
    await slide(riderPage, "Slide to accept");
    await expect(riderPage.getByTestId("job-step")).toHaveText("Go to the store");
    await expect(riderPage.getByTestId("pabili-budget")).toContainText(`₱${String(budget)}.00`);
    await slide(riderPage, "Slide: I'm at the store");
    await expect(riderPage.getByTestId("job-step")).toHaveText("Shopping");
    await expect(page.getByTestId("order-status")).toHaveText("Your rider is shopping", {
      timeout: 10_000,
    });
    const lines = riderPage.getByTestId("pabili-line");
    await lines.nth(0).getByRole("button", { name: "Bought" }).click();
    await lines.nth(1).getByRole("button", { name: "Not available" }).click();
    await riderPage.getByLabel("Receipt total (₱)").fill(String(budget + 1));
    await expect(riderPage.getByText(/over the customer's limit/)).toBeVisible();
    await riderPage.getByLabel("Receipt total (₱)").fill("312.50");
    await riderPage
      .getByLabel("Photo of the receipt")
      .setInputFiles({ name: "receipt.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    expect(await seriousViolations(riderPage)).toEqual([]);
    await shot(riderPage, `${project}-pabili-rider`);
    await slide(riderPage, "Slide: bought, send the receipt");
    await expect(riderPage.getByTestId("pabili-recorded")).toContainText("₱312.50");
    await expect(riderPage.getByTestId("cod-banner")).toContainText("₱400.50");

    // The customer sees the receipt total and what to pay at the door.
    await expect(page.getByTestId("pabili-to-pay")).toContainText("₱400.50", { timeout: 10_000 });
    await expect(page.getByTestId("pabili-receipt")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${project}-pabili-order`);

    // Pick up and deliver as usual.
    await slide(riderPage, "Slide: I have the order");
    await riderPage
      .getByLabel("Photo of the order at the door")
      .setInputFiles({ name: "proof.jpg", mimeType: "image/jpeg", buffer: PHOTO });
    await slide(riderPage, "Slide: delivered");
    await expect(riderPage.getByTestId("job-card")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId("order-status")).toHaveText("Delivered", { timeout: 10_000 });

    // Leave the rider offline and without a float for other runs.
    await riderPage.getByRole("button", { name: "Go offline" }).click();
    await sql(`update public.riders set pabili_float_centavos = 0 where user_id = $1`, [
      me.data.userId,
    ]);
    await riderContext.close();
  });
});

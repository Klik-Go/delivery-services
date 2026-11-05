import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authStackConfigured, resetTestNumberLimits, sql } from "./support/auth";

// Needs the seeded local database (Makati stores and menus); CI provides it.
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");

/** Ayala Avenue, Makati (in the pilot zone) and Kapitolyo, Pasig (not served yet). */
const AYALA = { lat: 14.5547, lng: 121.0244 };
const KAPITOLYO = { lat: 14.5707, lng: 121.0596 };
const WAITLIST_PHONE: Record<string, string> = {
  "mobile-pixel-7": "+639170000995",
  "desktop-chrome": "+639170000994",
};
const peso = (amount: string): RegExp => new RegExp(`₱\\s?${amount.replace(".", "\\.")}`);

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    // Leaflet's tile images and controls are third-party markup.
    .exclude(".leaflet-container")
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

/** Sets the delivery pin the way the address screen does (the cookie is shared with the page). */
async function deliverTo(page: Page, pin: { lat: number; lng: number }): Promise<void> {
  const response = await page.request.put("/api/location", {
    data: { location: pin, label: "E2E pin" },
  });
  expect(response.ok()).toBe(true);
}

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

test.describe("Feature: delivery address", () => {
  test("Scenario: a guest drops the pin in Makati and sees stores near them", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Where should we deliver/i })).toBeVisible();
    await page.getByRole("link", { name: "Set your delivery address" }).first().click();

    await expect(page.getByRole("heading", { level: 1, name: "Delivery address" })).toBeVisible();
    await expect(page.getByRole("application", { name: /Map/ })).toBeVisible();
    // Tiles come from the internet (not reachable in CI); the map itself must still render.
    await expect(page.locator(".leaflet-container")).toBeAttached();
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Deliver here" }).click();

    await page.waitForURL("/");
    await expect(page.getByText("Deliver to")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Near you" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Kape't Tinapay/ }).first()).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("Scenario: outside the service area the customer joins the waitlist", async ({
    page,
  }, testInfo) => {
    const phone = WAITLIST_PHONE[testInfo.project.name] ?? "+639170000993";
    await sql("delete from public.waitlist_signups where phone = $1", [phone]);
    await deliverTo(page, KAPITOLYO);

    await page.goto("/");
    await expect(page.getByText("We're not in your area yet — join the waitlist")).toBeVisible();
    await page.getByRole("link", { name: "Join the waitlist" }).click();

    await expect(page.getByRole("heading", { name: "Bring Klik Go to your area" })).toBeVisible();
    await page.getByLabel("Your name").fill("Lito Reyes");
    await page.getByLabel("Mobile number").fill(phone.replace("+63", "0"));
    await page.getByLabel("Barangay").fill("Kapitolyo");
    expect(await seriousViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Join the waitlist" }).click();

    await expect(page.getByText(/We'll text you when Klik Go opens/)).toBeVisible();
    const saved = await sql("select barangay from public.waitlist_signups where phone = $1", [
      phone,
    ]);
    expect(saved.rows).toEqual([{ barangay: "Kapitolyo" }]);
    await sql("delete from public.waitlist_signups where phone = $1", [phone]);
  });
});

test.describe("Feature: store page and cart", () => {
  test.beforeEach(async ({ page }) => {
    await deliverTo(page, AYALA);
  });

  test("Scenario: choosing a sugar level and seeing the cart priced by Klik Go", async ({
    page,
  }) => {
    await page.goto("/s/kapet-tinapay");
    await expect(page.getByRole("heading", { level: 1, name: "Kape't Tinapay" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Menu" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByRole("button", { name: /Kapeng Barako/ }).click();
    const sheet = page.getByRole("dialog", { name: "Kapeng Barako" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Required · Pick 1")).toBeVisible();
    await sheet.getByLabel("Less sugar").check();
    await sheet.getByRole("button", { name: "More" }).click();
    expect(await seriousViolations(page)).toEqual([]);
    await sheet.getByRole("button", { name: /Add to cart · ₱\s?120\.00/ }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole("link", { name: /View cart.*2 items/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
    const quote = page.getByTestId("quote");
    await expect(quote.getByText("Subtotal", { exact: true }).locator("..")).toContainText(
      peso("120.00"),
    );
    await expect(quote.getByText("Delivery fee", { exact: true }).locator("..")).toContainText(
      peso("39.00"),
    );
    await expect(quote.getByText("Small-order fee", { exact: true }).locator("..")).toContainText(
      peso("20.00"),
    );
    await expect(quote.getByText("Total", { exact: true }).locator("..")).toContainText(
      peso("179.00"),
    );
    await expect(page.getByText("Less sugar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("Scenario: adding from a second store asks before replacing the cart", async ({ page }) => {
    await page.goto("/s/kapet-tinapay");
    await page.getByRole("button", { name: /Pandesal/ }).click();
    await page.getByRole("button", { name: /Add to cart/ }).click();
    await expect(page.getByRole("link", { name: /View cart.*1 item/ })).toBeVisible();

    await page.goto("/s/aling-nenas-karinderya");
    await page.getByRole("button", { name: /Adobong Manok/ }).click();
    await page.getByLabel(/Garlic rice/).check();
    await page.getByRole("button", { name: /Add to cart/ }).click();
    const prompt = page.getByRole("dialog", { name: "Start a new cart?" });
    await expect(prompt.getByText("Your cart has items from Kape't Tinapay")).toBeVisible();
    await prompt.getByRole("button", { name: "Keep my cart" }).click();

    await page.goto("/cart");
    await expect(page.getByRole("link", { name: "Kape't Tinapay" })).toBeVisible();
    await expect(page.getByTestId("line-total")).toHaveText([peso("40.00")]);

    await page.goto("/s/aling-nenas-karinderya");
    await page.getByRole("button", { name: /Adobong Manok/ }).click();
    await page.getByLabel(/Garlic rice/).check();
    await page.getByRole("button", { name: /Add to cart/ }).click();
    await page.getByRole("button", { name: "Start new cart" }).click();

    await page.goto("/cart");
    await expect(page.getByRole("link", { name: "Aling Nena's Karinderya" })).toBeVisible();
    await expect(page.getByTestId("line-total")).toHaveText([peso("105.00")]);
  });

  test("Scenario: searching for a dish finds the store that sells it", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("searchbox", { name: "Search dishes or stores" }).fill("barako");
    const dishes = page.getByRole("list", { name: "Dishes: Kape't Tinapay" });
    await expect(dishes.getByText("Kapeng Barako")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});

test.describe("Feature: installable app", () => {
  test("Scenario: the app can be installed from a store page and has an offline page", async ({
    page,
  }) => {
    await page.goto("/s/aling-nenas-karinderya");
    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toMatchObject({ name: "Klik Go", display: "standalone" });

    // The service worker registers in production builds (what e2e runs against).
    await expect
      .poll(() =>
        page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration())),
      )
      .toBe(true);
    await page.evaluate(() => navigator.serviceWorker.ready);

    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
      installabilityErrors: { errorId: string }[];
    };
    // Playwright contexts are always incognito, where Chrome never offers install; every other
    // check (manifest, icons, start URL, service worker) must pass.
    expect(
      installabilityErrors.map((e) => e.errorId).filter((id) => id !== "in-incognito"),
    ).toEqual([]);

    const offline = await page.request.get("/offline");
    expect(offline.ok()).toBe(true);
  });
});

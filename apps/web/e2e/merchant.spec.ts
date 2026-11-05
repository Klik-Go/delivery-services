import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  authStackConfigured,
  merchantIdByName,
  resetTestNumberLimits,
  signedInMerchant,
  sql,
} from "./support/auth";

// Needs the local Supabase stack (Auth + DB) and MENU_PARSER=fake on the server; CI provides both.
test.skip(!authStackConfigured(), "Supabase Auth is not configured for this run");

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

/** Each project works on its own seeded store so the phone and desktop runs never collide. */
const STORE_FOR: Record<string, string> = {
  "mobile-pixel-7": "Silog Express",
  "desktop-chrome": "Merienda Corner",
};

async function seriousViolations(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("Feature: merchant onboarding", () => {
  test("Scenario: a store applies on the partner page and is told what happens next", async ({
    page,
  }) => {
    await page.goto("/partners");
    await expect(
      page.getByRole("heading", { level: 1, name: "Become a Klik Go partner" }),
    ).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);

    await page.getByLabel("Store name").fill(`E2E Lugawan ${Date.now()}`);
    await page.getByLabel("Owner's name").fill("Ben Santos");
    await page.getByLabel("Mobile number").fill("0917 555 0199");
    await page.getByLabel("Email").fill(`e2e-apply-${Date.now()}@example.test`);
    await page.getByLabel("Barangay").fill("Poblacion");
    await page.getByLabel("City or municipality").fill("Placeholder City");
    await expect(page.getByRole("application", { name: /Map/ })).toBeVisible();
    await page.getByRole("button", { name: "Send application" }).click();

    await expect(page.getByRole("heading", { name: "Application sent" })).toBeVisible();
    await expect(page.getByText(/within 2 working days/)).toBeVisible();
  });
});

test.describe("Feature: menu management", () => {
  // Both tests change the same seeded store and clean up after themselves: run them one by one.
  test.describe.configure({ mode: "serial" });
  let merchantId: string;
  let before: string[];
  let itemsBefore: string[];

  test.beforeEach(async ({ context, baseURL }, testInfo) => {
    merchantId = await merchantIdByName(STORE_FOR[testInfo.project.name] ?? "Silog Express");
    const rows = await sql(`select id from public.menu_categories where merchant_id = $1`, [
      merchantId,
    ]);
    before = rows.rows.map((row) => (row as { id: string }).id);
    const items = await sql(`select id from public.menu_items where merchant_id = $1`, [
      merchantId,
    ]);
    itemsBefore = items.rows.map((row) => (row as { id: string }).id);
    const api = await signedInMerchant(baseURL ?? "", merchantId);
    await context.addCookies((await api.storageState()).cookies);
  });

  test.afterEach(async () => {
    // Leave the seeded store as we found it.
    await sql(
      `delete from public.menu_items where merchant_id = $1 and not (id = any($2::uuid[]))`,
      [merchantId, itemsBefore],
    );
    await sql(
      `delete from public.menu_categories where merchant_id = $1 and not (id = any($2::uuid[]))`,
      [merchantId, before],
    );
    await sql(`update public.menu_items set is_available = true where merchant_id = $1`, [
      merchantId,
    ]);
  });

  test("Scenario: an owner adds a dish with a required choice and marks it sold out", async ({
    page,
  }) => {
    const category = `E2E Meals ${Date.now()}`;
    await page.goto(`/merchant?store=${merchantId}`);
    await page.getByRole("link", { name: /^Menu/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Menu" })).toBeVisible();

    await page.getByLabel("New category").fill(category);
    await page.getByRole("button", { name: "Add category" }).click();
    const section = page.getByRole("region", { name: category });
    await expect(section).toBeVisible();

    await section.getByRole("button", { name: "Add item" }).click();
    const editor = section.getByRole("form", { name: "Add item" });
    await editor.getByLabel("Name", { exact: true }).fill("Tapsilog");
    await editor.getByLabel("Price (₱)").fill("120.50");
    await editor.getByRole("button", { name: /Add a choice/ }).click();
    await editor.getByLabel("Choice name").fill("Rice");
    await editor.getByLabel("Option", { exact: true }).nth(0).fill("Plain rice");
    await editor.getByLabel("Option", { exact: true }).nth(1).fill("Garlic rice");
    await editor.getByLabel("Extra (₱)", { exact: true }).nth(1).fill("15");
    // The editor fits a phone screen: no sideways scrolling.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await editor.getByRole("button", { name: "Save item" }).click();

    // The editor stays open for the next dish; the saved one is listed with its price.
    await expect(section.getByText("Tapsilog", { exact: true })).toBeVisible();
    await expect(section.getByText("₱120.50 · Rice")).toBeVisible();
    await editor.getByRole("button", { name: "Cancel" }).click();
    expect(await seriousViolations(page)).toEqual([]);

    await section.getByRole("button", { name: "Mark sold out" }).click();
    await expect(section.getByText("Sold out", { exact: true })).toBeVisible();
  });

  test("Scenario: imported drafts reach the menu only after the merchant confirms", async ({
    page,
  }) => {
    await page.goto(`/merchant/menu/import?store=${merchantId}`);
    await page.getByLabel("Menu photo").setInputFiles({
      name: "menu.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await page.getByRole("button", { name: "Read my menu" }).click();
    await expect(page.getByRole("heading", { name: "Check the items" })).toBeVisible();
    await expect(page.getByText("Please check · 62% sure")).toBeVisible();

    const count = await sql(
      `select count(*)::int as n from public.menu_items where merchant_id = $1`,
      [merchantId],
    );
    expect((count.rows[0] as { n: number }).n).toBeGreaterThan(0);
    await page.getByLabel("Halo-halo: price").fill("85");
    await page.getByLabel("Keep Pork Sinigang").uncheck();
    await page.getByRole("button", { name: "Add 3 items to my menu" }).click();
    await expect(page.getByText("Added 3 items to your menu.")).toBeVisible();

    const halo = await sql(
      `select price_centavos from public.menu_items where merchant_id = $1 and name = 'Halo-halo' order by created_at desc limit 1`,
      [merchantId],
    );
    expect((halo.rows[0] as { price_centavos: number }).price_centavos).toBe(8500);
  });
});

import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { authStackConfigured, signedInStaff, sql } from "./support/auth";

// Needs the seeded database (CI starts it) and the placeholder code for fresh customers.
test.skip(!authStackConfigured(), "The seeded database is not configured for this run");
const PLACEHOLDER = process.env.PLACEHOLDER_OTP_CODE;
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

async function adminPage(browser: Browser, baseURL: string, project: string): Promise<Page> {
  const admin = await signedInStaff(baseURL, "admin");
  const context = await browser.newContext({
    ...(project === "desktop-chrome" ? {} : devices["Pixel 7"]),
    baseURL,
  });
  await context.addCookies((await admin.storageState()).cookies);
  return context.newPage();
}

const network = (): string =>
  `10.${String(randomInt(0, 256))}.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`;

test.describe("Feature: invite-only pilot", () => {
  test("Scenario: an admin makes codes; a new customer joins with one from a flyer link", async ({
    browser,
    baseURL,
    page,
    context,
  }, testInfo) => {
    test.skip(!PLACEHOLDER, "Needs PLACEHOLDER_OTP_CODE for a fresh customer");
    const project = testInfo.project.name;
    const admin = await adminPage(browser, baseURL ?? "", project);
    await admin.goto("/admin/invites");
    await admin.getByLabel("Batch name (e.g. Flyers Poblacion)").fill(`E2E flyers ${project}`);
    await admin.getByLabel("How many", { exact: true }).fill("3");
    await admin.getByRole("button", { name: "Create codes" }).click();
    const codes = admin.getByTestId("new-codes");
    await expect(codes).toBeVisible();
    const code = ((await codes.locator("p.font-mono").textContent()) ?? "").trim().split(/\s+/)[0] ?? "";
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    await expect(admin.getByRole("listitem").filter({ hasText: code })).toContainText("not used");
    expect(await seriousViolations(admin)).toEqual([]);
    await shot(admin, `${project}-invites`);
    await admin.context().close();

    // The flyer's QR code opens /join?code=…; sign-in comes first and brings them back.
    await context.setExtraHTTPHeaders({ "x-forwarded-for": network() });
    const local = `0918${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
    await page.goto(`/join?code=${code}`);
    await page.waitForURL(/\/auth\/sign-in/);
    await page.getByLabel("Mobile number").fill(local);
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByLabel("Digit 1").fill(PLACEHOLDER ?? "");
    await page.getByRole("button", { name: "Verify" }).click();
    await page.waitForURL((url) => url.pathname === "/consent" || url.pathname === "/join");
    if (new URL(page.url()).pathname === "/consent") {
      await page.getByRole("checkbox", { name: /terms of service/ }).check();
      await page.getByRole("checkbox", { name: /privacy notice/ }).check();
      await page.getByRole("button", { name: "Agree and continue" }).click();
    }
    await page.waitForURL((url) => url.pathname === "/join");
    await expect(page.getByRole("heading", { level: 1, name: "Enter your invite code" })).toBeVisible();
    await expect(page.getByLabel("Invite code")).toHaveValue(code);
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${project}-join`);
    await page.getByRole("button", { name: "Start ordering" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    const used = (
      await sql("select redeemed_at is not null as used from public.pilot_invites where code = $1", [code])
    ).rows[0] as { used: boolean };
    expect(used.used).toBe(true);
  });

  test("Scenario: an admin reviews the KPIs", async ({ browser, baseURL }, testInfo) => {
    const project = testInfo.project.name;
    const admin = await adminPage(browser, baseURL ?? "", project);
    await admin.goto("/admin/kpis");
    const table = admin.getByTestId("kpi-table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "30 days" })).toBeVisible();
    await expect(admin.locator('[data-kpi="confirm"]')).toContainText("< 180s");
    await expect(admin.getByRole("heading", { name: "Last 14 days" })).toBeVisible();
    expect(await seriousViolations(admin)).toEqual([]);
    await shot(admin, `${project}-kpis`);
    await admin.context().close();
  });
});

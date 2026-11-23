import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";
import { authStackConfigured, signedInStaff, sql } from "./support/auth";

// Needs the seeded database (CI starts it) and the placeholder sign-in code for fresh customers.
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

/** A brand-new customer signs in through the screens with the placeholder code. */
async function newCustomerSignsIn(page: Page): Promise<string> {
  const local = `0918${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  await page.goto("/auth/sign-in");
  await page.getByLabel("Mobile number").fill(local);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Digit 1").fill(PLACEHOLDER ?? "");
  await page.getByRole("button", { name: "Verify" }).click();
  return `+63${local.slice(1)}`;
}

test.describe("Feature: your data, your choice", () => {
  test.beforeEach(async ({ context }) => {
    // Each test is its own network, so the sign-in limits never meet.
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `10.${String(randomInt(0, 256))}.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`,
    });
  });

  test("Scenario: the privacy notice and terms are public and readable", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Privacy notice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Template for lawyer review");
    await expect(page.getByRole("heading", { name: "Your rights" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${testInfo.project.name}-privacy-notice`);
    await page.goto("/legal/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });

  test("Scenario: a new customer agrees, downloads their data, then deletes the account", async ({
    page,
  }, testInfo) => {
    test.skip(!PLACEHOLDER, "Needs PLACEHOLDER_OTP_CODE for a fresh customer");
    const phone = await newCustomerSignsIn(page);

    await page.waitForURL((url) => url.pathname === "/consent");
    await expect(
      page.getByRole("heading", { level: 1, name: "Before you continue" }),
    ).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${testInfo.project.name}-consent`);
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await expect(page.getByText("Tick both boxes to continue.")).toBeVisible();
    await page.getByRole("checkbox", { name: /terms of service/ }).check();
    await page.getByRole("checkbox", { name: /privacy notice/ }).check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await page.waitForURL((url) => url.pathname === "/");

    await page.getByRole("link", { name: "Your account" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your account" })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${testInfo.project.name}-account`);

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download my data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^klikgo-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    const chunks: Buffer[] = [];
    for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      profile: { phone: string };
      consents: unknown[];
    };
    expect(exported.profile.phone).toBe(phone);
    expect(exported.consents).toHaveLength(2);

    await page.getByLabel("Type DELETE to confirm").fill("delete");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText("Type DELETE to confirm.")).toBeVisible();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByRole("status")).toContainText("Your account is deleted");
    const left = (
      await sql("select count(*)::int as n from public.profiles where phone = $1", [phone])
    ).rows[0] as { n: number };
    expect(left.n).toBe(0);
    await page.goto("/account");
    await page.waitForURL(/\/auth\/sign-in\?next=(%2F|\/)account/);
  });
});

test.describe("Feature: system status", () => {
  test("Scenario: an admin sees job lag, schedules, webhooks and missed deadlines", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const admin = await signedInStaff(baseURL ?? "", "admin");
    const context = await browser.newContext({
      ...(testInfo.project.name === "desktop-chrome" ? {} : devices["Pixel 7"]),
      baseURL: baseURL ?? "",
    });
    await context.addCookies((await admin.storageState()).cookies);
    const page = await context.newPage();
    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { level: 2, name: "Background jobs" })).toBeVisible();
    await expect(page.getByTestId("system-webhooks")).toBeVisible();
    await expect(page.getByTestId("system-sla")).toBeVisible();
    await expect(page.getByText("merchant-sla")).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
    await shot(page, `${testInfo.project.name}-system-status`);
    await context.close();
  });
});

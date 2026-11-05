import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  apiSession,
  authStackConfigured,
  E2E_PHONES,
  resetTestNumberLimits,
  signedInAdmin,
  signInWithPhone,
  sql,
  TEST_OTP_CODE,
  totpCode,
} from "./support/auth";

// Needs the local Supabase stack (Auth + DB); CI starts it. Skipped otherwise.
test.skip(!authStackConfigured(), "Supabase Auth is not configured for this run");

test.beforeEach(async () => {
  await resetTestNumberLimits();
});

function phonesFor(project: string) {
  return E2E_PHONES[project as keyof typeof E2E_PHONES];
}

test.describe("Feature: phone sign-in", () => {
  test("Scenario: a customer signs up with a one-time code and lands on Home", async ({
    page,
  }, testInfo) => {
    const phone = phonesFor(testInfo.project.name).customer;
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sign in or sign up" })).toBeVisible();
    await page.getByLabel("Mobile number").fill(`0${phone.slice(3)}`);
    await page.getByRole("button", { name: "Send code" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Enter your code" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend code in \d+s/ })).toBeDisabled();
    await page.getByLabel("Digit 1").fill(TEST_OTP_CODE);
    await page.getByRole("button", { name: "Verify" }).click();

    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.getByText(`Signed in as ${phone}`)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("the sign-in screens have no serious accessibility violations", async ({ page }) => {
    for (const path of ["/auth/sign-in", "/auth/staff", "/auth/verify?phone=%2B639170000105"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(serious, `${path}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
    }
  });
});

test.describe("Feature: staff invitation with two-factor sign-in", () => {
  test("Scenario: invite → set password → enrol authenticator → merchant dashboard", async ({
    page,
    baseURL,
  }) => {
    const admin = await signedInAdmin(baseURL ?? "");
    const merchant = await sql(
      `select id from public.merchants where slug = 'aling-nenas-karinderya'`,
    );
    const merchantId = (merchant.rows[0] as { id: string } | undefined)?.id;
    const invite = await admin.post("/api/admin/invites", {
      data: {
        email: `e2e-owner-${Date.now()}@example.test`,
        role: "merchant_owner",
        merchantId,
      },
    });
    expect(invite.status()).toBe(201);
    const { data } = (await invite.json()) as { data: { invitePath: string } };

    await page.goto(data.invitePath);
    await expect(
      page.getByRole("heading", { level: 1, name: "Choose your password" }),
    ).toBeVisible();
    const password = `e2e ${Date.now()} memorable phrase`;
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password").fill(password);
    await page.getByRole("button", { name: "Save password" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Set up your authenticator app" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Set up authenticator app" }).click();
    await expect(
      page.getByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").textContent()) ?? "";
    await page.getByLabel("Digit 1").fill(totpCode(secret.trim()));
    await page.getByRole("button", { name: "Verify" }).click();

    await page.waitForURL((url) => url.pathname === "/merchant");
    await expect(page.getByText("Merchant dashboard", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Aling Nena's Karinderya" }),
    ).toBeVisible();
  });
});

test.describe("Feature: each role only reaches its own screens", () => {
  test("a rider is refused the merchant dashboard and admin console (403) but opens the rider app", async ({
    baseURL,
  }, testInfo) => {
    const api = await apiSession(baseURL ?? "");
    const userId = await signInWithPhone(api, phonesFor(testInfo.project.name).rider);
    await sql(
      `insert into public.user_roles (user_id, role) values ($1, 'rider') on conflict do nothing`,
      [userId],
    );
    expect((await api.get("/merchant", { maxRedirects: 0 })).status()).toBe(403);
    expect((await api.get("/admin", { maxRedirects: 0 })).status()).toBe(403);
    expect((await api.get("/rider", { maxRedirects: 0 })).status()).toBe(200);
  });

  test("a visitor who is not signed in is sent to sign in", async ({ page }) => {
    await page.goto("/rider");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Frider/);
  });
});

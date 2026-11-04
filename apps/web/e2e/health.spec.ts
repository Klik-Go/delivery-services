import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Mirrors features/health.feature so the same business scenario is proven in a real browser
// on both the Pixel 7 and desktop projects.
test.describe("Feature: Platform health", () => {
  test("Scenario: A customer opens Klik Go and sees the brand", async ({ page }) => {
    // Given the platform is running / When I open the home page
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Then I see the Klik Go brand
    await expect(page.getByRole("heading", { level: 1, name: "Klik Go" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Klik Go logo" })).toBeVisible();
    await expect(page).toHaveTitle(/Klik Go/);
    await expect(page.getByText("Delivered to your door, wherever you are.")).toBeVisible();
  });

  test("Scenario: Monitoring checks that the platform is healthy", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: unknown;
      error: unknown;
      meta: { requestId: string };
    };
    expect(body.data).toEqual({ status: "ok" });
    expect(body.error).toBeNull();
    expect(body.meta.requestId).toBe(response.headers()["x-request-id"]);
  });

  test("the home page fits a 360px phone without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the home page has no serious accessibility violations", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });

  test("the page runs with a strict CSP and no console errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });

  test("the language can be switched to Filipino", async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "fil", url: baseURL ?? "http://localhost:3000" },
    ]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fil");
    await expect(page.getByRole("heading", { level: 1, name: "Klik Go" })).toBeVisible();
  });
});

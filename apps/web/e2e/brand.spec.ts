import { expect, test } from "@playwright/test";

// The KGo brand (docs/BRAND.md) must survive refactors: icons, wordmark typeface, theme colour.
test.describe("Klik Go brand", () => {
  test("serves the KGo favicon and app icons", async ({ request }) => {
    for (const [path, type] of [
      ["/icon.svg", "image/svg+xml"],
      ["/apple-icon.png", "image/png"],
      ["/brand/klik-go-logo.svg", "image/svg+xml"],
      ["/brand/icon-512.png", "image/png"],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toContain(type);
    }
  });

  test("shows the wordmark in Lilita One, the logo typeface", async ({ page }) => {
    await page.goto("/");
    // Compact masthead: Lilita wordmark (h1 lockup) on turmeric over ink.
    const wordmark = page.getByRole("heading", { level: 1, name: "Klik Go" });
    await expect(wordmark).toHaveCSS("font-family", /lilita/i);
    await expect(wordmark).toHaveCSS("color", "rgb(255, 212, 59)"); // #ffd43b
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() =>
      [...document.fonts].some((font) => /lilita/i.test(font.family) && font.status === "loaded"),
    );
    expect(loaded).toBe(true);
  });

  test("tints the browser chrome with the logo blue", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#228be6");
  });

  test("loads Inter for UI and JetBrains Mono for figures", async ({ page }) => {
    await page.goto("/dev/ui");
    await page.evaluate(() => document.fonts.ready);
    const families = await page.evaluate(() =>
      [...document.fonts].map((font) => font.family.toLowerCase()),
    );
    expect(families.some((family) => family.includes("inter"))).toBe(true);
    expect(families.some((family) => family.includes("jetbrains"))).toBe(true);
    const price = page.locator(".font-mono").first();
    await expect(price).toHaveCSS("font-variant-numeric", /tabular-nums/);
  });
});

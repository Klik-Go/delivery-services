import type { Page } from "@playwright/test";

/**
 * After a sign-in, a person who has not agreed to the current terms and privacy notice is sent to
 * /consent first (Phase 11). Ticks both boxes and continues when that happens.
 */
export async function agreeIfAsked(page: Page): Promise<void> {
  await page.waitForURL(
    (url) => !["/auth/verify", "/auth/mfa", "/auth/set-password"].includes(url.pathname),
  );
  if (new URL(page.url()).pathname !== "/consent") return;
  await page.getByRole("checkbox", { name: /terms of service/ }).check();
  await page.getByRole("checkbox", { name: /privacy notice/ }).check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.waitForURL((url) => url.pathname !== "/consent");
}

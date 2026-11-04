import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = Boolean(process.env.CI);

/** E2E runs against the production build (`next start`) on a phone and a desktop. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  ...(IS_CI ? { workers: 2 } : {}),
  reporter: IS_CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile-pixel-7", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: "pnpm start",
          url: `${BASE_URL}/api/health`,
          reuseExistingServer: !IS_CI,
          timeout: 120_000,
          env: { PORT: String(PORT) },
        },
      }),
});

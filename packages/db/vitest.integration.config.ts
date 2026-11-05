import { defineConfig } from "vitest/config";

/**
 * Integration tests against the local Supabase database (`pnpm db:start && pnpm db:reset`).
 * Each test runs in a transaction that is rolled back, so tests never change the seed data.
 */
export default defineConfig({
  test: {
    name: "db-integration",
    include: ["test/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

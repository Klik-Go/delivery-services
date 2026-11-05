import { defineConfig } from "vitest/config";

/** Repository tests against the local Supabase database (`pnpm db:start && pnpm db:reset`). */
export default defineConfig({
  test: {
    name: "adapters-db",
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

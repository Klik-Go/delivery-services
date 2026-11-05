import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "adapters",
    include: ["src/**/*.test.ts"],
    // Repository tests need the local Supabase database: `pnpm test:db`.
    exclude: ["src/**/*.db.test.ts"],
    environment: "node",
  },
});

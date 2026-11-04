import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "adapters", include: ["src/**/*.test.ts"], environment: "node" },
});

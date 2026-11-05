import { defineConfig } from "vitest/config";

/**
 * One Vitest run for the whole monorepo. Coverage thresholds follow docs/BUSINESS.md §10.4.6:
 * domain services ≥ 90% lines.
 */
export default defineConfig({
  test: {
    projects: ["packages/*", "apps/web"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.ts", "apps/web/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/index.ts",
        "**/*.d.ts",
        "packages/db/**",
        "apps/web/src/app/**",
        "apps/web/src/i18n/**",
      ],
      thresholds: {
        "packages/core/src/**": { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});

import { defineProject } from "vitest/config";

export default defineProject({
  esbuild: { jsx: "automatic" },
  test: { name: "ui", include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});

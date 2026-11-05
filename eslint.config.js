// Root config lints repo-level TypeScript (features/, scripts/, test configs).
// Each workspace package has its own eslint.config.js.
import { createConfig } from "@klikgo/config/eslint";

export default [
  { ignores: ["apps/**", "packages/**", "supabase/**"] },
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["features/**/*.ts", "scripts/**"],
    rules: { "no-console": "off" },
  },
];

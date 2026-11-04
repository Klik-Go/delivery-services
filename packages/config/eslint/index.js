// Shared ESLint flat config for every workspace package.
// Architectural boundaries are enforced here (not just documented) so agents
// cannot quietly put framework code in packages/core or call adapters from UI.
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const IGNORES = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/coverage/**",
  "**/playwright-report/**",
  "**/test-results/**",
  "**/generated/**",
  "**/next-env.d.ts",
  "**/*.config.js",
  "**/*.config.mjs",
];

/** Framework/infrastructure imports banned from the pure domain layer. */
const CORE_FORBIDDEN_IMPORTS = [
  "next",
  "next/*",
  "react",
  "react-dom",
  "@prisma/*",
  "@supabase/*",
  "pino",
  "pg",
  "@klikgo/adapters",
  "@klikgo/adapters/*",
  "@klikgo/db",
  "@klikgo/db/*",
  "@klikgo/ui",
  "@klikgo/ui/*",
];

/**
 * Builds the flat config for a package.
 * @param {{ tsconfigRootDir: string, next?: boolean, react?: boolean, layer?: "core" | "adapters" | "web" | "tooling" }} options
 * @returns {import("eslint").Linter.Config[]}
 */
export function createConfig({ tsconfigRootDir, next = false, react = false, layer = "tooling" }) {
  /** @type {import("eslint").Linter.Config[]} */
  const configs = [
    { ignores: IGNORES },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/explicit-module-boundary-types": "error",
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/no-floating-promises": "error",
        eqeqeq: ["error", "always"],
        "no-console": "error",
      },
    },
    {
      files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
      ...tseslint.configs.disableTypeChecked,
      rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        "@typescript-eslint/explicit-module-boundary-types": "off",
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/e2e/**", "**/features/**"],
      rules: {
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/unbound-method": "off",
      },
    },
  ];

  if (react || next) {
    configs.push({
      files: ["**/*.tsx"],
      languageOptions: { globals: { ...globals.browser } },
      plugins: { "react-hooks": reactHooks },
      rules: reactHooks.configs.recommended.rules,
    });
  }

  if (next) {
    configs.push({
      plugins: { "@next/next": nextPlugin },
      rules: {
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs["core-web-vitals"].rules,
      },
    });
  }

  if (layer === "core") {
    configs.push({
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: CORE_FORBIDDEN_IMPORTS,
                message:
                  "packages/core is framework-free. Depend on a port (interface) and implement it in packages/adapters.",
              },
            ],
          },
        ],
      },
    });
  }

  if (layer === "web") {
    configs.push({
      // UI code must reach domain logic through /api/* or the server container, never adapters directly.
      files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@klikgo/adapters", "@klikgo/adapters/*", "@klikgo/db", "@klikgo/db/*"],
                message:
                  "Components never touch adapters or the database. Go through a route handler or src/server.",
              },
            ],
          },
        ],
      },
    });
  }

  configs.push(prettier);
  return configs;
}

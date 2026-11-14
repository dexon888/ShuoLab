import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      ".wrangler/",
      "node_modules/",
      "playwright-report/",
      "test-results/",
      "src/server/db/migrations/",
      "private-data/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/client/**/*.{ts,tsx}", "test/client/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**", "*.config.{js,ts}", "test/**"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
);

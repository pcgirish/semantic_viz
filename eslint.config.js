import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/build/**", "**/node_modules/**", "docs/mock/**"],
  },
  {
    // Build scripts run directly under Node.
    files: ["packages/*/scripts/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly", process: "readonly" } },
  },
);

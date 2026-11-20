import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "storage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts (such as the fixture generator) run outside TypeScript.
    files: ["**/*.mjs"],
    languageOptions: { globals: { URL: "readonly", console: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

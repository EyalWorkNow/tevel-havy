import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignore generated output and vendored files
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".venv-sidecar/**",
      "eslint.config.mjs",
      "vite.config.*",
      "scripts/validate-local-reasoning.mjs",
    ],
  },
  // Base recommended rules for all TS/TSX files
  ...tseslint.configs.recommended,
  {
    rules: {
      // JSX short-circuit rendering (`condition && <Cmp />`) is intentional —
      // allow it while still catching truly unused expressions.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true },
      ],

      // `const self = this` is a legacy-safe pattern in a few service files.
      "@typescript-eslint/no-this-alias": "warn",

      // Downgrade noisy stylistic rules to warnings so they surface in review
      // but never block a PR.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",

      // Unsafe operations are pre-existing; skip them until strict mode is adopted.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
);

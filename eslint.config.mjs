import tseslint from "typescript-eslint";
export default [
  { ignores: ["node_modules/**", "dist/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

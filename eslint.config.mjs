import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["tests/**/*.{ts,tsx,mjs}", "src/**/__tests__/**/*.{ts,tsx,mjs}"],
    rules: {
      "@next/next/no-assign-module-variable": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  globalIgnores([
    ".next*/**",
    ".entire/**",
    ".playwright-cli/**",
    ".tmp/**",
    "artifact-storage-root/**",
    "desktop-bundle/**",
    "dist-desktop/**",
    "out/**",
    "build/**",
    "graphify-out/**",
    "output/**",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
    "next-env.d.ts",
  ]),
]);

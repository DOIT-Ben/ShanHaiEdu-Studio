import type { NextConfig } from "next";

const runtimeTraceExcludes = [
  "./.env*",
  "./**/.env*",
  "./.tmp/**/*",
  "./*.db*",
  "./**/*.db*",
  "./*.md",
  "./data/**/*",
  "./desktop-bundle/**/*",
  "./dist-desktop/**/*",
  "./docs/**/*",
  "./electron-builder.config.cjs",
  "./graphify-out/**/*",
  "./next.config.ts",
  "./output/**/*",
  "./playwright.config.ts",
  "./playwright-report/**/*",
  "./postcss.config.mjs",
  "./prisma.config.ts",
  "./test-results/**/*",
  "./tests/**/*",
  "./tsconfig.json",
  "./vitest.config.ts",
  "./API台账系统/**/*",
];

const runtimeTraceIncludes = ["./API台账系统/manifest.json"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingExcludes: {
    "/api/**/*": runtimeTraceExcludes,
    instrumentation: runtimeTraceExcludes,
  },
  outputFileTracingIncludes: {
    "/api/**/*": runtimeTraceIncludes,
    instrumentation: runtimeTraceIncludes,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;


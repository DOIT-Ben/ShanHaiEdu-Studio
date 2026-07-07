import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingExcludes: {
    "/api/**/*": [
      "./.env",
      "./.tmp/**/*",
      "./*.db",
      "./*.md",
      "./data/**/*",
      "./desktop-bundle/**/*",
      "./dist-desktop/**/*",
      "./docs/**/*",
      "./electron-builder.config.cjs",
      "./next.config.ts",
      "./playwright.config.ts",
      "./playwright-report/**/*",
      "./postcss.config.mjs",
      "./prisma.config.ts",
      "./test-results/**/*",
      "./tests/**/*",
      "./tsconfig.json",
      "./vitest.config.ts",
    ],
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


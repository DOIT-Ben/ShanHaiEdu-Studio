import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.E2E_PORT ?? "3117", 10);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const workers = Number.parseInt(process.env.PLAYWRIGHT_WORKERS ?? "2", 10);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  workers,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/e2e-stage1-results.json" }],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results/e2e",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "file:./dev.db",
      NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: process.env.NEXT_PUBLIC_WORKBENCH_DATA_SOURCE ?? "dev",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "chromium-narrow",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "firefox-desktop",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});

import { defineConfig } from "vitest/config";

const maxWorkers = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? "2", 10);

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});

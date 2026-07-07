import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDatabasePath = path.join(root, ".tmp", "test-workbench.db");
const env = {
  ...process.env,
  DATABASE_URL: "file:./.tmp/test-workbench.db",
  VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? "1",
};

fs.rmSync(testDatabasePath, { force: true });

run(npxCommand(), ["prisma", "generate"], { shell: process.platform === "win32" });
run(process.execPath, ["scripts/init-sqlite-schema.mjs"]);
run(process.execPath, ["--test", "tests/*.test.mjs"]);
run(npxCommand(), ["vitest", "run", "--maxWorkers=1"], { shell: process.platform === "win32" });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: options.shell ?? false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

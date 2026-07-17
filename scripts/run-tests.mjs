import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeTestDatabasePath = path.join(root, ".tmp", "node-test-workbench.db");
const vitestDatabasePath = path.join(root, ".tmp", "vitest-test-workbench.db");
const baseEnv = {
  ...process.env,
  VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? "1",
};
const nodeTestEnv = suiteEnv("node-test-workbench.db");
const vitestEnv = suiteEnv("vitest-test-workbench.db");

run(npxCommand(), ["prisma", "generate"], { shell: process.platform === "win32", env: nodeTestEnv });
initializeTestDatabase(nodeTestDatabasePath, nodeTestEnv);
run(process.execPath, ["--test", "tests/*.test.mjs"], { env: nodeTestEnv });
initializeTestDatabase(vitestDatabasePath, vitestEnv);
run(npxCommand(), ["vitest", "run", "--maxWorkers=1"], { shell: process.platform === "win32", env: vitestEnv });

function initializeTestDatabase(databasePath, env) {
  fs.rmSync(databasePath, { force: true });
  run(process.execPath, ["scripts/init-sqlite-schema.mjs"], { env });
}

function suiteEnv(databaseFileName) {
  return {
    ...baseEnv,
    DATABASE_URL: `file:./.tmp/${databaseFileName}`,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? baseEnv,
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

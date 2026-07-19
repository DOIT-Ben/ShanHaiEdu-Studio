import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseRelativePath = "test-results/stage33-e2e.db";
const databasePath = path.join(root, databaseRelativePath);
const port = process.env.E2E_PORT ?? "3117";
const env = {
  ...process.env,
  DATABASE_URL: `file:./${databaseRelativePath}`,
  E2E_BASE_URL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
  E2E_PORT: port,
  PLAYWRIGHT_WORKERS: process.env.PLAYWRIGHT_WORKERS ?? "1",
};

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

await run(process.execPath, ["scripts/init-sqlite-schema.mjs"], env);
await run(process.execPath, [
  "node_modules/@playwright/test/cli.js",
  "test",
  "tests/e2e/stage33-client-exe-readiness.spec.ts",
  "--project=chromium-desktop",
], env);

function run(command, args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: childEnv,
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

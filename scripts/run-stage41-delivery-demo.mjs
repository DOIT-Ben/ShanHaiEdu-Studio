import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseRelativePath = "test-results/stage41-delivery-demo.db";
const databasePath = path.join(root, databaseRelativePath);
const reportJsonPath = path.join(root, "test-results/stage41-delivery-demo-report.json");
const reportMarkdownPath = path.join(root, "test-results/stage41-delivery-demo-report.md");
const e2ePort = process.env.E2E_PORT ?? String(await findAvailablePort());

const env = {
  ...process.env,
  DATABASE_URL: `file:./${databaseRelativePath}`,
  E2E_PORT: e2ePort,
  NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: "api",
  PLAYWRIGHT_WORKERS: process.env.PLAYWRIGHT_WORKERS ?? "1",
};

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
fs.rmSync(reportJsonPath, { force: true });
fs.rmSync(reportMarkdownPath, { force: true });

await run(process.execPath, ["scripts/init-sqlite-schema.mjs"], env);
await run(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/stage41-auto-delivery-demo.spec.ts",
    "--project=chromium-desktop",
  ],
  env,
);

const report = JSON.parse(fs.readFileSync(reportJsonPath, "utf8"));
if (report?.ok !== true) {
  throw new Error("stage41_delivery_demo_report_not_ok");
}
if (!fs.existsSync(reportMarkdownPath)) {
  throw new Error("stage41_delivery_demo_markdown_report_missing");
}

console.log(
  JSON.stringify({
    ok: true,
    stage: "M41",
    mode: report.mode,
    projectId: report.projectId,
    e2ePort,
    reportJson: path.relative(root, reportJsonPath),
    reportMarkdown: path.relative(root, reportMarkdownPath),
    packageEntries: report.packageEntries,
  }),
);

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

async function findAvailablePort() {
  const preferredStart = 3127;
  const preferredEnd = 3199;

  for (let port = preferredStart; port <= preferredEnd; port += 1) {
    if (await canBind(port)) {
      return port;
    }
  }

  throw new Error(`stage41_no_available_e2e_port_${preferredStart}_${preferredEnd}`);
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

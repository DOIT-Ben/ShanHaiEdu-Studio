import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SHANHAI_DEPLOY_DEMO_PREFLIGHT_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportJsonPath = path.join(root, "test-results", "deploy-demo-preflight-report.json");
const reportMarkdownPath = path.join(root, "test-results", "deploy-demo-preflight-report.md");
const serverEntry = path.join(root, ".next", "standalone", "server.js");
const port = process.env.DEPLOY_DEMO_PORT ?? String(await findAvailablePort());
const baseUrl = `http://127.0.0.1:${port}`;
const commandEnv = {
  ...process.env,
  DATABASE_URL: normalizeDatabaseUrlForStandalone(process.env.DATABASE_URL),
};

fs.rmSync(reportJsonPath, { force: true });
fs.rmSync(reportMarkdownPath, { force: true });
fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });

await run("npm", ["run", "preflight:production"]);
await run("npm", ["run", "db:init"]);
await run("npm", ["run", "build"]);

if (!fs.existsSync(serverEntry)) {
  throw new Error("deploy_demo_standalone_server_missing");
}

const server = startStandaloneServer();
try {
  const httpChecks = await waitForHttpSmoke();
  const report = {
    ok: httpChecks.every((item) => item.ok),
    stage: "M42",
    mode: "deploy-demo-readiness",
    baseUrl,
    server: ".next/standalone/server.js",
    checks: [
      check("production-preflight", true, "Production preflight command completed."),
      check("database-init", true, "SQLite schema initialization completed."),
      check("production-build", true, "Production build completed and standalone server exists."),
      ...httpChecks,
    ],
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(reportMarkdownPath, renderMarkdownReport(report), "utf8");

  if (!report.ok) {
    throw new Error("deploy_demo_preflight_report_not_ok");
  }

  console.log(
    JSON.stringify({
      ok: true,
      stage: report.stage,
      mode: report.mode,
      baseUrl,
      reportJson: path.relative(root, reportJsonPath),
      reportMarkdown: path.relative(root, reportMarkdownPath),
      checks: report.checks.map((item) => ({ id: item.id, ok: item.ok })),
    }),
  );
} finally {
  await stopServer(server);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: commandEnv,
      stdio: "inherit",
      shell: process.platform === "win32",
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

function normalizeDatabaseUrlForStandalone(databaseUrl) {
  if (!databaseUrl?.startsWith("file:")) return databaseUrl;
  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath || path.isAbsolute(rawPath)) return databaseUrl;
  return `file:${path.resolve(root, rawPath)}`;
}

function startStandaloneServer() {
  return spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...commandEnv,
      HOSTNAME: "127.0.0.1",
      PORT: port,
      NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: process.env.NEXT_PUBLIC_WORKBENCH_DATA_SOURCE ?? "api",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
}

async function waitForHttpSmoke() {
  await waitForServerReady();
  return [
    await requestCheck("http-root", "/", "Root page responds with HTTP 200."),
    await requestCheck("http-project-list", "/api/workbench/projects", "Workbench project list API responds with HTTP 200."),
  ];
}

async function waitForServerReady() {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`deploy_demo_server_not_ready: ${lastError}`);
}

async function requestCheck(id, pathname, detail) {
  try {
    const response = await fetch(`${baseUrl}${pathname}`);
    return check(id, response.status === 200, `${detail} status=${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return check(id, false, `${detail} error=${message}`);
  }
}

async function stopServer(server) {
  if (server.exitCode !== null) return;

  server.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function findAvailablePort() {
  const preferredStart = 3207;
  const preferredEnd = 3299;

  for (let candidate = preferredStart; candidate <= preferredEnd; candidate += 1) {
    if (await canBind(candidate)) {
      return candidate;
    }
  }

  throw new Error(`deploy_demo_no_available_port_${preferredStart}_${preferredEnd}`);
}

function canBind(candidate) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port: candidate }, () => {
      server.close(() => resolve(true));
    });
  });
}

function check(id, ok, detail) {
  return { id, ok, detail };
}

function renderMarkdownReport(report) {
  const checks = report.checks.map((item) => `- ${item.ok ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`).join("\n");
  return `# M42 部署演示准备报告

- 状态：${report.ok ? "通过" : "失败"}
- 模式：${report.mode}
- 服务入口：${report.baseUrl}
- 生产服务：${report.server}
- 生成时间：${report.generatedAt}

## 检查项

${checks}
`;
}

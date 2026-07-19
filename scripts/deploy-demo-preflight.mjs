import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
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
const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shanhai-deploy-demo-shared-"));
const databasePath = path.join(sharedRoot, "data", "production.db");
const artifactRoot = path.join(sharedRoot, "artifacts");
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
fs.mkdirSync(artifactRoot);
const commandEnv = {
  ...process.env,
  SHANHAI_AUTH_MODE: "password",
  NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
  SHANHAI_TRUST_PROXY: "1",
  SHANHAI_APP_INSTANCE_COUNT: "1",
  SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
  NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
  SHANHAI_BOOTSTRAP_ADMIN_EMAIL: "deploy_demo_admin",
  SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME: "部署验收管理员",
  SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD: randomBytes(24).toString("base64url"),
  DATABASE_URL: `file:${databasePath}`,
  ARTIFACT_STORAGE_ROOT: artifactRoot,
};

fs.rmSync(reportJsonPath, { force: true });
fs.rmSync(reportMarkdownPath, { force: true });
fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });

let server;
try {
  await run("npm", ["run", "db:init"], {}, { quiet: true });
  await run(process.execPath, ["scripts/bootstrap-admin.mjs"], { SHANHAI_BOOTSTRAP_ADMIN_CONFIRM: "CREATE_ADMIN" }, { quiet: true });
  await run("npm", ["run", "preflight:production"]);
  await run("npm", ["run", "build"]);

  if (!fs.existsSync(serverEntry)) {
    throw new Error("deploy_demo_standalone_server_missing");
  }

  server = startStandaloneServer();
  const httpChecks = await waitForHttpSmoke();
  const report = {
    ok: httpChecks.every((item) => item.ok),
    stage: "V1-10B",
    mode: "isolated-standalone-rehearsal",
    baseUrl,
    server: ".next/standalone/server.js",
    checks: [
      check("database-init", true, "SQLite schema initialization completed."),
      check("admin-bootstrap", true, "Password administrator bootstrap completed."),
      check("production-preflight", true, "Production preflight command completed."),
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
  if (server) await stopServer(server);
  cleanupSharedRoot();
}

function run(command, args, envOverrides = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const isWindowsNpm = process.platform === "win32" && command === "npm";
    const executable = isWindowsNpm ? (process.env.ComSpec || "cmd.exe") : command;
    const executableArgs = isWindowsNpm ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
    const child = spawn(executable, executableArgs, {
      cwd: root,
      env: { ...commandEnv, ...envOverrides },
      stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
    });

    if (options.quiet) {
      child.stdout.on("data", () => undefined);
      child.stderr.on("data", () => undefined);
    }

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

function startStandaloneServer() {
  return spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...commandEnv,
      HOSTNAME: "127.0.0.1",
      PORT: port,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
}

async function waitForHttpSmoke() {
  await waitForServerReady();
  return [
    await healthCheck("http-health", "/api/health", 200),
    await requestCheck("http-root", "/", 200, "Root page responds with HTTP 200."),
    await requestCheck(
      "http-project-list",
      "/api/workbench/projects",
      401,
      "Unauthenticated project API is denied in password mode.",
    ),
    await requestCheck(
      "http-registration",
      "/api/auth/register",
      403,
      "Public registration is disabled.",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    ),
  ];
}

async function healthCheck(id, pathname, expectedStatus) {
  try {
    const response = await fetch(`${baseUrl}${pathname}`);
    const body = await response.json();
    const ok = response.status === expectedStatus && body?.status === "ok" &&
      body?.checks?.database === "ok" && body?.checks?.artifactStorage === "ok";
    return check(id, ok, `Health readiness expectedStatus=${expectedStatus} status=${response.status}`);
  } catch {
    return check(id, false, "Health readiness request failed.");
  }
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

async function requestCheck(id, pathname, expectedStatus, detail, options) {
  try {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    return check(id, response.status === expectedStatus, `${detail} expectedStatus=${expectedStatus} status=${response.status}`);
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
  return `# V1-10B 隔离 Standalone 发布 Rehearsal 报告

- 状态：${report.ok ? "通过" : "失败"}
- 模式：${report.mode}
- 服务入口：${report.baseUrl}
- 生产服务：${report.server}
- 生成时间：${report.generatedAt}

## 检查项

${checks}
`;
}

function cleanupSharedRoot() {
  const resolved = path.resolve(sharedRoot);
  const tempRoot = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("shanhai-deploy-demo-shared-")) {
    throw new Error("deploy_demo_shared_cleanup_boundary_invalid");
  }
  fs.rmSync(sharedRoot, { recursive: true, force: true });
}

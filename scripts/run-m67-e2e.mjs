import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = `${process.pid}-${Date.now()}`;
const tempRoot = path.join(root, "test-results", `m67-e2e-${runId}`);
const databasePath = path.join(tempRoot, "m67.sqlite");
const artifactRoot = path.join(tempRoot, "artifact-storage");
const playwrightOutput = path.join(tempRoot, "playwright-output");
const generatedConfigPath = path.join(tempRoot, "playwright.config.mjs");
const isolatedAppRoot = path.join(tempRoot, "next-app");
const admin = {
  email: process.env.M67_E2E_ADMIN_EMAIL ?? "m67-admin@example.test",
  password: process.env.M67_E2E_ADMIN_PASSWORD ?? "M67 admin password 2026!",
  displayName: "M67 验收管理员",
};
const teacher = {
  email: process.env.M67_E2E_TEACHER_EMAIL ?? "m67-teacher@example.test",
  password: process.env.M67_E2E_TEACHER_PASSWORD ?? "M67 teacher password 2026!",
  displayName: "M67 验收教师",
};

const ownedChildren = new Set();
let nextServer;
let cleanupPromise;
let serverLogTail = [];

process.once("SIGINT", () => void stopFromSignal(130));
process.once("SIGTERM", () => void stopFromSignal(143));

try {
  fs.mkdirSync(artifactRoot, { recursive: true });
  const port = await reservePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const env = createEnvironment(baseURL, port);

  await runCommand(process.execPath, ["scripts/init-sqlite-schema.mjs"], env, 60_000);
  await seedUsers(env);
  assertSeededUsers();
  writePlaywrightConfig(baseURL);
  prepareIsolatedNextApp();

  nextServer = startNextServer(env, port);
  await waitForServer(baseURL, nextServer, 120_000);

  await runCommand(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "tests/e2e/beta-feedback-center.spec.ts",
      "--config",
      generatedConfigPath,
      "--project=chromium-desktop",
      "--project=chromium-narrow",
      "--workers=1",
    ],
    env,
    Number.parseInt(process.env.M67_E2E_TIMEOUT_MS ?? "360000", 10),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverLogTail.length > 0) {
    console.error("M67 Next dev log tail:\n" + serverLogTail.join(""));
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}

function createEnvironment(baseURL, port) {
  return {
    ...process.env,
    DATABASE_URL: `file:${databasePath}`,
    ARTIFACT_STORAGE_ROOT: artifactRoot,
    NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: "api",
    NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
    SHANHAI_AUTH_MODE: "password",
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_LOGIN_CLIENT_RATE_LIMIT: "200",
    SHANHAI_LOGIN_ACCOUNT_RATE_LIMIT: "100",
    NEXT_PUBLIC_APP_VERSION: "m67-e2e",
    SHANHAI_DB_INIT_SKIP_DOTENV: "1",
    PLAYWRIGHT_WORKERS: "1",
    E2E_PORT: String(port),
    E2E_BASE_URL: baseURL,
    M67_E2E_ADMIN_EMAIL: admin.email,
    M67_E2E_ADMIN_PASSWORD: admin.password,
    M67_E2E_TEACHER_EMAIL: teacher.email,
    M67_E2E_TEACHER_PASSWORD: teacher.password,
    CI: "1",
  };
}

async function seedUsers(env) {
  const adminScript = path.resolve(root, process.env.M67_ADMIN_BOOTSTRAP_SCRIPT ?? "scripts/bootstrap-admin.mjs");
  const teacherScript = path.resolve(root, process.env.M67_TEACHER_INVITE_SCRIPT ?? "scripts/invite-user.mjs");
  const available = [fs.existsSync(adminScript), fs.existsSync(teacherScript)];

  if (available.every(Boolean)) {
    await runCommand(process.execPath, [adminScript], {
      ...env,
      SHANHAI_BOOTSTRAP_ADMIN_EMAIL: admin.email,
      SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD: admin.password,
      SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME: admin.displayName,
      SHANHAI_BOOTSTRAP_ADMIN_CONFIRM: "CREATE_ADMIN",
    }, 60_000);
    await runCommand(process.execPath, [teacherScript], {
      ...env,
      SHANHAI_INVITE_USER_EMAIL: teacher.email,
      SHANHAI_INVITE_USER_INITIAL_PASSWORD: teacher.password,
      SHANHAI_INVITE_USER_DISPLAY_NAME: teacher.displayName,
    }, 60_000);
    return;
  }

  if (available.some(Boolean)) {
    throw new Error("M67 seed contract is incomplete: bootstrap-admin.mjs and invite-user.mjs must be provided together.");
  }

  console.warn("M67 seed scripts are not present; using the isolated SQLite compatibility seed.");
  const db = new Database(databasePath);
  try {
    const insert = db.prepare(`
      INSERT INTO "LocalUser" ("id", "displayName", "role", "authMode", "email", "passwordHash", "updatedAt")
      VALUES (?, ?, ?, 'password', ?, ?, CURRENT_TIMESTAMP)
    `);
    insert.run("m67-admin", admin.displayName, "admin", admin.email, await hashPassword(admin.password));
    insert.run("m67-teacher", teacher.displayName, "teacher", teacher.email, await hashPassword(teacher.password));
  } finally {
    db.close();
  }
}

function assertSeededUsers() {
  const db = new Database(databasePath, { readonly: true });
  try {
    const rows = db.prepare(`SELECT "email", "role", "authMode" FROM "LocalUser" WHERE "email" IN (?, ?)`).all(admin.email, teacher.email);
    const byEmail = new Map(rows.map((row) => [row.email, row]));
    if (byEmail.get(admin.email)?.role !== "admin" || byEmail.get(admin.email)?.authMode !== "password") {
      throw new Error("M67 administrator seed did not create a password-auth admin.");
    }
    if (byEmail.get(teacher.email)?.role !== "teacher" || byEmail.get(teacher.email)?.authMode !== "password") {
      throw new Error("M67 teacher seed did not create a password-auth teacher.");
    }
  } finally {
    db.close();
  }
}

function startNextServer(env, port) {
  const child = spawn(
    process.execPath,
    [path.join(root, "node_modules/next/dist/bin/next"), "dev", isolatedAppRoot, "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    },
  );
  const capture = (chunk) => {
    serverLogTail.push(chunk.toString());
    if (serverLogTail.length > 80) serverLogTail = serverLogTail.slice(-80);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    child.m67SpawnError = error;
    capture(Buffer.from(`Next dev spawn failed: ${error.message}\n`));
  });
  return child;
}

function prepareIsolatedNextApp() {
  fs.mkdirSync(isolatedAppRoot, { recursive: true });
  for (const directory of ["src", "public"]) {
    const source = path.join(root, directory);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(isolatedAppRoot, directory), { recursive: true });
  }
  for (const file of ["package.json", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs"]) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(isolatedAppRoot, file));
  }
  fs.writeFileSync(path.join(isolatedAppRoot, "next.config.mjs"), `
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  distDir: ".next-m67",
};
export default nextConfig;
`, "utf8");
}

async function waitForServer(baseURL, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.m67SpawnError) throw child.m67SpawnError;
    if (child.exitCode !== null) {
      throw new Error(`M67 Next dev exited before readiness with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(`${baseURL}/api/auth/me`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200 || response.status === 401) return;
    } catch {
      // The dedicated server is still compiling or binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`M67 Next dev did not become ready within ${timeoutMs}ms.`);
}

function writePlaywrightConfig(baseURL) {
  const testDir = path.join(root, "tests", "e2e");
  const config = `
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ${JSON.stringify(testDir)},
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: ${JSON.stringify(playwrightOutput)},
  use: {
    baseURL: ${JSON.stringify(baseURL)},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-narrow", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
`;
  fs.writeFileSync(generatedConfigPath, config, "utf8");
}

function runCommand(command, args, env, timeoutMs) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  ownedChildren.add(child);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stopProcessTree(child).finally(() => reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} ${args.join(" ")} exited with ${code ?? signal}.`));
    });
  }).finally(() => ownedChildren.delete(child));
}

async function reservePort() {
  const requested = Number.parseInt(process.env.M67_E2E_PORT ?? "0", 10);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: requested }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function cleanup() {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const activeChildren = new Set([nextServer, ...ownedChildren].filter(Boolean));
      await Promise.all([...activeChildren].map((child) => stopProcessTree(child)));
      fs.rmSync(tempRoot, { recursive: true, force: true });
    })();
  }
  return cleanupPromise;
}

async function stopFromSignal(code) {
  await cleanup();
  process.exit(code);
}

async function stopProcessTree(child) {
  if (!isOwnedProcess(child) || !child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function isOwnedProcess(child) {
  return child === nextServer || ownedChildren.has(child);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await new Promise((resolve, reject) => {
    nodeScrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
  return ["scrypt", "v=1", "N=16384", "r=8", "p=1", "keylen=64", salt.toString("base64url"), key.toString("base64url")].join("$");
}

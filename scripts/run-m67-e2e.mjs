import "dotenv/config";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createHash, randomBytes, scrypt as nodeScrypt } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createV1_9RunManifestV2Digest,
  deriveV1_9ExternalCodexOrchestrationCount,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
} from "./lib/v1-9-e2e-contract.mjs";
import { assertCurrentV1_9BaselineLock } from "./lib/v1-9-baseline-lock.mjs";
import { sanitizeEvidenceText } from "./lib/evidence-sanitizer.mjs";
import {
  assertM67CanonicalOwnedDescendant,
  assertM67FrozenRunStorageState,
  cleanM67OwnedFrozenAppCaches,
  prepareM67FrozenApp,
  resolveM67FrozenAppRoot,
  resolveM67FrozenPlaywrightSpecPath,
  resolveM67FrozenRunIdentity,
  verifyM67FrozenApp,
  verifyM67FrozenAppBeforeCacheCleanup,
} from "./lib/m67-frozen-app.mjs";
import {
  createRunnerShutdownAuthority,
  installRunnerShutdownIpcHandler,
} from "./lib/runner-shutdown-authority.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = `${process.pid}-${Date.now()}`;
const configuredRunRoot = resolveRunRoot(process.env.M67_E2E_RUN_ROOT);
const tempRoot = configuredRunRoot ?? path.join(root, "test-results", `m67-e2e-${runId}`);
const databasePath = path.join(tempRoot, "m67.sqlite");
const artifactRoot = path.join(tempRoot, "artifact-storage");
const evidenceRoot = path.join(tempRoot, "evidence");
const playwrightOutput = path.join(tempRoot, `playwright-output-${runId}`);
const generatedConfigPath = path.join(tempRoot, `playwright.config-${runId}.mjs`);
const configuredFrozenAppRoot = resolveM67FrozenAppRoot(process.env.M67_E2E_FROZEN_APP_ROOT, tempRoot);
const frozenRunIdentity = resolveM67FrozenRunIdentity(process.env, configuredFrozenAppRoot);
const resumeExistingRun = frozenRunIdentity?.mode === "resume";
const isolatedAppRoot = configuredFrozenAppRoot ?? path.join(tempRoot, `next-app-${runId}`);
const frozenAppMarkerPath = configuredFrozenAppRoot
  ? path.join(configuredFrozenAppRoot, ".m67-frozen-app.json")
  : null;
const frozenBaselineLock = resolveFrozenBaselineLock();
const preserveRunDirectory = Boolean(configuredRunRoot) || process.env.M67_E2E_PRESERVE_RUN_DIR === "1";
const requestedSpec = resolveRequestedSpec(process.env.M67_E2E_SPEC ?? "tests/e2e/beta-feedback-center.spec.ts");
const playwrightSpecPath = resolveM67FrozenPlaywrightSpecPath(requestedSpec, configuredFrozenAppRoot);
const requestedProjects = resolveRequestedProjects(process.env.M67_E2E_PROJECTS);
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
const secondTeacher = {
  email: process.env.M67_E2E_SECOND_TEACHER_EMAIL ?? "m67-teacher-b@example.test",
  password: process.env.M67_E2E_SECOND_TEACHER_PASSWORD ?? "M67 second teacher password 2026!",
  displayName: "M67 验收教师乙",
};
const browserRestrictedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

let nextServer;
let cleanupPromise;
let serverLogTail = [];
const mainAgentFailureDiagnostics = [];
let frozenAppPrepared = false;
let terminalSummaryStatus = null;
const shutdownAuthority = createRunnerShutdownAuthority({
  postStop: verifyFrozenAppAfterOwnedProcessesStop,
});
const detachShutdownIpc = installRunnerShutdownIpcHandler(shutdownAuthority);

process.once("SIGINT", () => void stopFromSignal(130, "SIGINT"));
process.once("SIGTERM", () => void stopFromSignal(143, "SIGTERM"));

try {
  assertM67FrozenRunStorageState({
    identity: frozenRunIdentity,
    databasePath,
    artifactRoot,
    appRoot: isolatedAppRoot,
  });
  assertFrozenBaselineCurrent();
  fs.mkdirSync(artifactRoot, { recursive: true });
  const port = await reservePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const env = createEnvironment(baseURL, port);

  await runCommand(process.execPath, ["scripts/init-sqlite-schema.mjs"], env, 60_000);
  if (!resumeExistingRun) await seedUsers(env);
  assertSeededUsers();
  writePlaywrightConfig(baseURL);
  prepareIsolatedNextApp();
  frozenAppPrepared = Boolean(configuredFrozenAppRoot);
  if (frozenAppPrepared) {
    verifyFrozenAppIntegrity();
    assertFrozenBaselineCurrent();
  }

  nextServer = startNextServer(env, port);
  await waitForServer(baseURL, nextServer, 120_000);

  await runCommand(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      playwrightSpecPath,
      "--config",
      generatedConfigPath,
      ...requestedProjects.map((project) => `--project=${project}`),
      "--workers=1",
    ],
    env,
    resolvePlaywrightCommandTimeoutMs(requestedSpec, process.env.M67_E2E_TIMEOUT_MS),
  );
  await stopNextServerAndVerifyFrozenApp("completed");
  writeSanitizedSummary("passed");
} catch (error) {
  let failure = error;
  try {
    await stopNextServerAndVerifyFrozenApp("failure");
  } catch (shutdownError) {
    failure = new AggregateError([error, shutdownError], "M67 shutdown integrity verification failed.");
  }
  writeSanitizedSummary("failed");
  console.error(sanitizeDiagnosticText(failure instanceof Error ? failure.message : failure));
  if (serverLogTail.length > 0) {
    console.error("M67 Next dev log tail:\n" + serverLogTail.join(""));
  }
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    writeSanitizedSummary("failed");
    console.error(sanitizeDiagnosticText(cleanupError instanceof Error ? cleanupError.message : cleanupError));
    process.exitCode = 1;
  }
  detachShutdownIpc();
}

function createEnvironment(baseURL, port) {
  const deterministicFixture = process.env.M67_E2E_DETERMINISTIC === "1";
  return {
    ...process.env,
    DATABASE_URL: `file:${databasePath}`,
    ARTIFACT_STORAGE_ROOT: artifactRoot,
    M67_E2E_EVIDENCE_DIR: evidenceRoot,
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
    M67_E2E_SECOND_TEACHER_EMAIL: secondTeacher.email,
    M67_E2E_SECOND_TEACHER_PASSWORD: secondTeacher.password,
    ...(deterministicFixture ? {
      SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT: "1",
      SHANHAI_E2E_DETERMINISTIC_RUNTIME: "1",
    } : {}),
    CI: "1",
  };
}

function resolveRunRoot(value) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/");
  if (!normalized) return null;
  if (!/^test-results\/[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) {
    throw new Error("M67_E2E_RUN_ROOT must stay inside the repository test-results directory.");
  }
  const testResultsRoot = path.resolve(root, "test-results");
  const resolved = path.resolve(root, normalized);
  try {
    return assertM67CanonicalOwnedDescendant(testResultsRoot, resolved, true);
  } catch {
    throw new Error("M67_E2E_RUN_ROOT must name an owned child directory of test-results.");
  }
}

function resolveFrozenBaselineLock() {
  if (!frozenRunIdentity) return null;
  const configuredRepositoryRoot = String(process.env.SHANHAI_V1_9_REPOSITORY_ROOT ?? "").trim();
  if (!configuredRepositoryRoot) throw new Error("M67 frozen repository root is required.");
  try {
    const expectedRoot = fs.realpathSync(root);
    const configuredRoot = fs.realpathSync(path.resolve(configuredRepositoryRoot));
    const normalizePath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalizePath(configuredRoot) !== normalizePath(expectedRoot)) {
      throw new Error("M67 frozen repository root is invalid.");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "M67 frozen repository root is invalid.") throw error;
    throw new Error("M67 frozen repository root is invalid.");
  }
  const configuredManifestPath = String(process.env.V1_9_E2E_MANIFEST_PATH ?? "").trim();
  if (!configuredManifestPath) throw new Error("M67 frozen run manifest path is required.");
  const manifestPath = path.resolve(configuredManifestPath);
  if (path.dirname(manifestPath) !== path.resolve(tempRoot) || path.basename(manifestPath) !== "run-manifest.json") {
    throw new Error("M67 frozen run manifest path is invalid.");
  }
  try {
    assertM67CanonicalOwnedDescendant(tempRoot, manifestPath, false);
    const manifestBytes = fs.readFileSync(manifestPath);
    const fileDigest = createHash("sha256").update(manifestBytes).digest("hex");
    const manifest = normalizeV1_9RunManifestV2(JSON.parse(manifestBytes.toString("utf8")));
    const actualRelativeRunRoot = path.relative(root, tempRoot).replaceAll("\\", "/");
    if (fileDigest !== frozenRunIdentity.manifestSha256 ||
        createV1_9RunManifestV2Digest(manifest) !== frozenRunIdentity.manifestSha256 ||
        manifest.runId !== frozenRunIdentity.runId ||
        manifest.relativeRunRoot !== actualRelativeRunRoot) {
      throw new Error("M67 frozen run manifest identity is invalid.");
    }
    return manifest.baselineLock;
  } catch (error) {
    if (error instanceof Error && error.message === "M67 frozen run manifest identity is invalid.") throw error;
    throw new Error("M67 frozen run manifest identity is invalid.");
  }
}

function assertFrozenBaselineCurrent() {
  if (!frozenBaselineLock) return null;
  const currentManifestBaselineLock = resolveFrozenBaselineLock();
  if (JSON.stringify(currentManifestBaselineLock) !== JSON.stringify(frozenBaselineLock)) {
    throw new Error("M67 frozen run manifest identity is invalid.");
  }
  return assertCurrentV1_9BaselineLock(currentManifestBaselineLock, { cwd: root, env: process.env });
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
    await runCommand(process.execPath, [teacherScript], {
      ...env,
      SHANHAI_INVITE_USER_EMAIL: secondTeacher.email,
      SHANHAI_INVITE_USER_INITIAL_PASSWORD: secondTeacher.password,
      SHANHAI_INVITE_USER_DISPLAY_NAME: secondTeacher.displayName,
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
    insert.run("m67-teacher-b", secondTeacher.displayName, "teacher", secondTeacher.email, await hashPassword(secondTeacher.password));
  } finally {
    db.close();
  }
}

function assertSeededUsers() {
  const db = new Database(databasePath, { readonly: true });
  try {
    const rows = db.prepare(`SELECT "email", "role", "authMode" FROM "LocalUser" WHERE "email" IN (?, ?, ?)`).all(admin.email, teacher.email, secondTeacher.email);
    const byEmail = new Map(rows.map((row) => [row.email, row]));
    if (byEmail.get(admin.email)?.role !== "admin" || byEmail.get(admin.email)?.authMode !== "password") {
      throw new Error("M67 administrator seed did not create a password-auth admin.");
    }
    if (byEmail.get(teacher.email)?.role !== "teacher" || byEmail.get(teacher.email)?.authMode !== "password") {
      throw new Error("M67 teacher seed did not create a password-auth teacher.");
    }
    if (byEmail.get(secondTeacher.email)?.role !== "teacher" || byEmail.get(secondTeacher.email)?.authMode !== "password") {
      throw new Error("M67 second teacher seed did not create a password-auth teacher.");
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
      cwd: isolatedAppRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    },
  );
  const capture = captureServerOutput;
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    child.m67SpawnError = error;
    capture(Buffer.from(`Next dev spawn failed: ${error.message}\n`));
  });
  shutdownAuthority.track(child, { label: "m67-next-server" });
  return child;
}

function prepareIsolatedNextApp() {
  const nextConfigContents = [
    "const nextConfig = {",
    "  reactStrictMode: true,",
    '  allowedDevOrigins: ["127.0.0.1"],',
    '  distDir: ".next-m67",',
    "};",
    "export default nextConfig;",
    "",
  ].join("\n");

  if (!configuredFrozenAppRoot) {
    fs.mkdirSync(isolatedAppRoot, { recursive: true });
    for (const directory of ["src", "public"]) {
      const source = path.join(root, directory);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(isolatedAppRoot, directory), { recursive: true });
    }
    for (const file of ["package.json", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs"]) {
      const source = path.join(root, file);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(isolatedAppRoot, file));
    }
    fs.writeFileSync(path.join(isolatedAppRoot, "next.config.mjs"), nextConfigContents, "utf8");
    return;
  }

  prepareM67FrozenApp({
    sourceRoot: root,
    runRoot: tempRoot,
    appRoot: isolatedAppRoot,
    markerPath: frozenAppMarkerPath,
    identity: frozenRunIdentity,
    requestedSpec,
    nextConfigContents,
    assertBaselineCurrent: assertFrozenBaselineCurrent,
  });
}

function verifyFrozenAppIntegrity() {
  if (!configuredFrozenAppRoot || !frozenAppMarkerPath) return null;
  return verifyM67FrozenApp(createFrozenAppVerificationInput());
}

function createFrozenAppVerificationInput() {
  return {
    sourceRoot: root,
    runRoot: tempRoot,
    appRoot: isolatedAppRoot,
    markerPath: frozenAppMarkerPath,
    identity: frozenRunIdentity,
    requestedSpec,
  };
}

function stopNextServerAndVerifyFrozenApp(reason) {
  return shutdownAuthority.shutdown({ reason });
}

function verifyFrozenAppAfterOwnedProcessesStop() {
  if (!frozenAppPrepared) return;
  verifyM67FrozenAppBeforeCacheCleanup(createFrozenAppVerificationInput());
  cleanM67OwnedFrozenAppCaches(isolatedAppRoot, tempRoot);
  verifyFrozenAppIntegrity();
  assertFrozenBaselineCurrent();
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
  const testDir = configuredFrozenAppRoot
    ? path.join(isolatedAppRoot, "tests", "e2e")
    : path.join(root, "tests", "e2e");
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

function resolveRequestedSpec(value) {
  const normalized = value.replaceAll("\\", "/");
  if (!/^tests\/e2e\/[a-z0-9._-]+\.spec\.ts$/i.test(normalized)) {
    throw new Error("M67_E2E_SPEC must name one spec directly under tests/e2e.");
  }
  return normalized;
}

function resolvePlaywrightCommandTimeoutMs(spec, configuredValue) {
  const configured = Number.parseInt(configuredValue ?? "360000", 10);
  const requestedTimeout = Number.isFinite(configured) && configured > 0 ? configured : 360_000;
  const specFloor = spec === "tests/e2e/v1-9r-two-user-main-agent.spec.ts" ? 1_560_000 : 0;
  return Math.max(requestedTimeout, specFloor);
}

function resolveRequestedProjects(value) {
  const allowed = new Set(["chromium-desktop", "chromium-narrow"]);
  const projects = (value ?? "chromium-desktop,chromium-narrow").split(",").map((item) => item.trim()).filter(Boolean);
  if (projects.length === 0 || projects.some((project) => !allowed.has(project))) {
    throw new Error("M67_E2E_PROJECTS contains an unsupported project.");
  }
  return [...new Set(projects)];
}

function captureServerOutput(chunk) {
  const text = chunk.toString();
  serverLogTail.push(sanitizeEvidenceText(text));
  if (serverLogTail.length > 80) serverLogTail = serverLogTail.slice(-80);
  for (const match of text.matchAll(/\[main-agent-failure\]\s+(\{[^\r\n]*\})/g)) {
    try {
      const parsed = JSON.parse(match[1]);
      mainAgentFailureDiagnostics.push({
        phase: sanitizeDiagnosticText(parsed.phase),
        reason: sanitizeDiagnosticText(parsed.reason),
        errorName: sanitizeDiagnosticText(parsed.errorName),
        summary: sanitizeDiagnosticText(parsed.summary),
      });
    } catch {
      mainAgentFailureDiagnostics.push({
        phase: "unknown",
        reason: "diagnostic_parse_failed",
        errorName: "Error",
        summary: "Main Agent failure diagnostic could not be parsed.",
      });
    }
  }
}

function sanitizeDiagnosticText(value) {
  return sanitizeEvidenceText(value, { maxStringLength: 600 });
}

function writeSanitizedSummary(status) {
  if (!requestedSpec.includes("v1-9")) return;
  if (terminalSummaryStatus === "failed" || terminalSummaryStatus === status) return;
  terminalSummaryStatus = status;
  const uniqueProductRun = requestedSpec.includes("v1-9-unique-real-product");
  const summaryPath = uniqueProductRun
    ? path.join(tempRoot, "v1-9-summary.json")
    : path.join(root, "test-results", "v1-9r-two-user-summary.json");
  const orchestration = readV1_9OrchestrationLedger();
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify({
    status,
    completedAt: new Date().toISOString(),
    spec: requestedSpec,
    projects: requestedProjects,
    fixture: process.env.M67_E2E_DETERMINISTIC === "1"
      ? "isolated-sqlite-explicit-deterministic-fixture"
      : "isolated-sqlite-with-configured-product-main-agent",
    providerChannel: resolveProviderChannel(process.env),
    preservedRunDirectory: preserveRunDirectory
      ? path.relative(root, tempRoot).replaceAll("\\", "/")
      : null,
    externalCodexOrchestrationCount: orchestration.count,
    externalCodexOrchestrationSource: orchestration.source,
    failureDiagnostics: mainAgentFailureDiagnostics,
  }, null, 2) + "\n", "utf8");
}

function readV1_9OrchestrationLedger() {
  const configuredStatePath = process.env.V1_9_E2E_STATE_PATH?.trim();
  if (configuredStatePath) {
    const resolvedStatePath = path.resolve(configuredStatePath);
    const stateRelative = path.relative(tempRoot, resolvedStatePath);
    if (
      !stateRelative ||
      stateRelative.startsWith("..") ||
      path.isAbsolute(stateRelative) ||
      path.basename(resolvedStatePath) !== "run-state.json"
    ) {
      return { count: null, source: "run_state_path_rejected" };
    }
    try {
      const state = normalizeV1_9RunState(JSON.parse(fs.readFileSync(resolvedStatePath, "utf8")));
      return {
        count: state.ledger.violations.filter((entry) => entry.orchestrationImpact === true).length,
        source: "run_state_mutation_ledger",
      };
    } catch {
      return { count: null, source: "run_state_unreadable" };
    }
  }

  const configuredManifestPath = process.env.V1_9_E2E_MANIFEST_PATH?.trim();
  if (!configuredManifestPath) return { count: null, source: "manifest_not_configured" };
  const resolved = path.resolve(configuredManifestPath);
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.basename(resolved) !== "run-manifest.json") {
    return { count: null, source: "manifest_path_rejected" };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
    return {
      count: deriveV1_9ExternalCodexOrchestrationCount(manifest),
      source: "legacy_run_manifest_mutation_ledger",
    };
  } catch {
    return { count: null, source: "manifest_unreadable" };
  }
}

function resolveProviderChannel(env) {
  const channel = env.AGENT_BRAIN_CHANNEL?.trim().toLowerCase() || "primary";
  return ["primary", "third", "fallback"].includes(channel) ? channel : "invalid";
}

function runCommand(command, args, env, timeoutMs) {
  return shutdownAuthority.runCommand(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeoutMs,
    label: path.basename(command),
  }).then(() => undefined);
}

async function reservePort() {
  const requested = Number.parseInt(process.env.M67_E2E_PORT ?? "0", 10);
  if (requested > 0 && browserRestrictedPorts.has(requested)) {
    throw new Error(`M67_E2E_PORT ${requested} is browser-restricted.`);
  }
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: requested }, () => {
        const address = server.address();
        const reservedPort = typeof address === "object" && address ? address.port : 0;
        server.close((error) => error ? reject(error) : resolve(reservedPort));
      });
    });
    if (!browserRestrictedPorts.has(port)) return port;
    if (requested > 0) throw new Error(`M67_E2E_PORT ${requested} is browser-restricted.`);
  }
}

function cleanup() {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      await shutdownAuthority.shutdown({ reason: "cleanup" });
      if (!preserveRunDirectory) await removeOwnedTempRoot();
    })();
  }
  return cleanupPromise;
}

async function removeOwnedTempRoot() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !["EBUSY", "EPERM"].includes(error.code) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

async function stopFromSignal(code, signal) {
  let failure;
  try {
    await shutdownAuthority.shutdown({ reason: "signal", signal });
    if (!preserveRunDirectory) await removeOwnedTempRoot();
  } catch (error) {
    failure = error;
  }
  writeSanitizedSummary("failed");
  if (failure) console.error(sanitizeDiagnosticText(failure instanceof Error ? failure.message : failure));
  detachShutdownIpc();
  process.exit(code);
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

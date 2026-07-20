import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  assertM67CanonicalOwnedDescendant,
  cleanM67OwnedFrozenAppCaches,
  prepareM67FrozenApp,
  verifyM67FrozenApp,
  verifyM67FrozenAppBeforeCacheCleanup,
} from "./m67-frozen-app.mjs";
import { sanitizeEvidenceText } from "./evidence-sanitizer.mjs";

export const M67_BROWSER_RESTRICTED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

export function createM67RunnerEnvironment(input) {
  const deterministicFixture = input.env.M67_E2E_DETERMINISTIC === "1";
  return {
    ...input.env,
    DATABASE_URL: `file:${input.databasePath}`,
    ARTIFACT_STORAGE_ROOT: input.artifactRoot,
    M67_E2E_EVIDENCE_DIR: input.evidenceRoot,
    NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
    SHANHAI_AUTH_MODE: "password",
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_LOGIN_CLIENT_RATE_LIMIT: "200",
    SHANHAI_LOGIN_ACCOUNT_RATE_LIMIT: "100",
    NEXT_PUBLIC_APP_VERSION: "m67-e2e",
    SHANHAI_DB_INIT_SKIP_DOTENV: "1",
    PLAYWRIGHT_WORKERS: "1",
    E2E_PORT: String(input.port),
    E2E_BASE_URL: input.baseURL,
    M67_E2E_ADMIN_EMAIL: input.admin.email,
    M67_E2E_ADMIN_PASSWORD: input.admin.password,
    M67_E2E_TEACHER_EMAIL: input.teacher.email,
    M67_E2E_TEACHER_PASSWORD: input.teacher.password,
    M67_E2E_SECOND_TEACHER_EMAIL: input.secondTeacher.email,
    M67_E2E_SECOND_TEACHER_PASSWORD: input.secondTeacher.password,
    ...(deterministicFixture ? { SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT: "1" } : {}),
    CI: "1",
  };
}

export function resolveM67ProviderChannel(env) {
  const channel = env.AGENT_BRAIN_CHANNEL?.trim().toLowerCase() || "primary";
  return ["primary", "third", "fallback"].includes(channel) ? channel : "invalid";
}

export function resolveM67PlaywrightCommandTimeoutMs(spec, configuredValue) {
  const configured = Number.parseInt(configuredValue ?? "360000", 10);
  const requestedTimeout = Number.isFinite(configured) && configured > 0 ? configured : 360_000;
  const specFloor = spec === "tests/e2e/v1-9r-two-user-main-agent.spec.ts" ? 1_560_000 : 0;
  return Math.max(requestedTimeout, specFloor);
}

export function createM67RunnerCommandRunner(input) {
  return (command, args, env, timeoutMs) => input.shutdownAuthority.runCommand(command, args, {
    cwd: input.root,
    env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeoutMs,
    label: input.path.basename(command),
  }).then(() => undefined);
}

export function createM67RunnerCleanup(input) {
  let cleanupPromise;
  return () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        await input.shutdownAuthority.shutdown({ reason: "cleanup" });
        if (!input.preserveRunDirectory) await input.removeOwnedTempRoot();
      })();
    }
    return cleanupPromise;
  };
}

export function sanitizeM67DiagnosticText(value, dependencies = {}) {
  return (dependencies.sanitizeEvidenceText ?? sanitizeEvidenceText)(String(value ?? ""));
}

export function createM67ServerOutputCapture(input, dependencies = {}) {
  const sanitize = dependencies.sanitizeEvidenceText ?? sanitizeEvidenceText;
  return (chunk) => {
    const rawText = String(chunk);
    input.serverLogTail.push(sanitize(rawText));
    if (input.serverLogTail.length > 80) input.serverLogTail.shift();
    for (const match of rawText.matchAll(/\[main-agent-failure\]\s+(\{[^\r\n]*\})/g)) {
      try {
        const detail = JSON.parse(match[1]);
        input.mainAgentFailureDiagnostics.push({
          phase: sanitizeM67DiagnosticText(detail.phase ?? "", { sanitizeEvidenceText: sanitize }),
          reason: sanitizeM67DiagnosticText(detail.reason ?? "", { sanitizeEvidenceText: sanitize }),
          errorName: sanitizeM67DiagnosticText(detail.errorName ?? "", { sanitizeEvidenceText: sanitize }),
          summary: sanitizeM67DiagnosticText(detail.summary ?? "", { sanitizeEvidenceText: sanitize }),
        });
      } catch {
        input.mainAgentFailureDiagnostics.push({
          phase: "unknown",
          reason: "diagnostic_parse_failed",
          errorName: "Error",
          summary: "Main Agent failure diagnostic could not be parsed.",
        });
      }
    }
  };
}

export async function reserveM67Port(input = {}, dependencies = {}) {
  const requested = Number.parseInt(input.requestedPort ?? "0", 10);
  const restrictedPorts = dependencies.restrictedPorts ?? M67_BROWSER_RESTRICTED_PORTS;
  const network = dependencies.net ?? net;
  if (requested > 0 && restrictedPorts.has(requested)) {
    throw new Error(`M67_E2E_PORT ${requested} is browser-restricted.`);
  }
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const server = network.createServer();
      server.unref();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: requested }, () => {
        const address = server.address();
        const reservedPort = typeof address === "object" && address ? address.port : 0;
        server.close((error) => error ? reject(error) : resolve(reservedPort));
      });
    });
    if (!restrictedPorts.has(port)) return port;
    if (requested > 0) throw new Error(`M67_E2E_PORT ${requested} is browser-restricted.`);
  }
}

export function startM67NextServer(input, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess;
  if (typeof spawnProcess !== "function") throw new Error("M67 Next spawn function is required.");
  const child = spawnProcess(
    input.nodeExecutable,
    [input.nextCliPath, "dev", input.isolatedAppRoot, "--hostname", "127.0.0.1", "--port", String(input.port)],
    {
      cwd: input.isolatedAppRoot,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    },
  );
  child.stdout.on("data", input.captureServerOutput);
  child.stderr.on("data", input.captureServerOutput);
  child.once("error", (error) => {
    child.m67SpawnError = error;
    input.captureServerOutput(Buffer.from(`Next dev spawn failed: ${error.message}\n`));
  });
  input.shutdownAuthority.track(child, { label: "m67-next-server" });
  return child;
}

export function prepareM67IsolatedNextApp(input, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const pathApi = dependencies.pathApi ?? path;
  if (!input.configuredFrozenAppRoot) {
    fileSystem.mkdirSync(input.isolatedAppRoot, { recursive: true });
    for (const directory of ["src", "public"]) {
      const source = pathApi.join(input.root, directory);
      if (fileSystem.existsSync(source)) fileSystem.cpSync(source, pathApi.join(input.isolatedAppRoot, directory), { recursive: true });
    }
    for (const file of ["package.json", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs"]) {
      const source = pathApi.join(input.root, file);
      if (fileSystem.existsSync(source)) fileSystem.copyFileSync(source, pathApi.join(input.isolatedAppRoot, file));
    }
    fileSystem.writeFileSync(pathApi.join(input.isolatedAppRoot, "next.config.mjs"), input.nextConfigContents, "utf8");
    return;
  }
  (dependencies.prepareFrozenApp ?? prepareM67FrozenApp)({
    sourceRoot: input.root,
    runRoot: input.tempRoot,
    appRoot: input.isolatedAppRoot,
    markerPath: input.frozenAppMarkerPath,
    identity: input.frozenRunIdentity,
    requestedSpec: input.requestedSpec,
    nextConfigContents: input.nextConfigContents,
    assertBaselineCurrent: input.assertFrozenBaselineCurrent,
  });
}

export function createM67FrozenAppVerificationInput(input) {
  return {
    sourceRoot: input.root,
    runRoot: input.tempRoot,
    appRoot: input.isolatedAppRoot,
    markerPath: input.frozenAppMarkerPath,
    identity: input.frozenRunIdentity,
    requestedSpec: input.requestedSpec,
  };
}

export function verifyM67FrozenAppAfterOwnedProcessesStop(input, dependencies = {}) {
  if (!input.frozenAppPrepared) return;
  const verificationInput = input.createVerificationInput();
  (dependencies.verifyBeforeCacheCleanup ?? verifyM67FrozenAppBeforeCacheCleanup)(verificationInput);
  (dependencies.cleanOwnedCaches ?? cleanM67OwnedFrozenAppCaches)(input.isolatedAppRoot, input.tempRoot);
  (dependencies.verifyFrozenApp ?? verifyM67FrozenApp)(verificationInput);
  input.assertFrozenBaselineCurrent();
}

export function resolveM67FrozenBaselineLock(input, dependencies = {}) {
  if (!input.frozenRunIdentity) return null;
  const fileSystem = dependencies.fileSystem ?? fs;
  const pathApi = dependencies.pathApi ?? path;
  const hash = dependencies.createHash ?? createHash;
  const assertOwned = dependencies.assertCanonicalOwnedDescendant ?? assertM67CanonicalOwnedDescendant;
  const normalizeManifest = dependencies.normalizeManifest;
  const manifestDigest = dependencies.createManifestDigest;
  const configuredRepositoryRoot = String(input.env.SHANHAI_V1_9_REPOSITORY_ROOT ?? "").trim();
  if (!configuredRepositoryRoot) throw new Error("M67 frozen repository root is required.");
  try {
    const expectedRoot = fileSystem.realpathSync(input.root);
    const configuredRoot = fileSystem.realpathSync(pathApi.resolve(configuredRepositoryRoot));
    const normalizePath = (value) => input.platform === "win32" ? value.toLowerCase() : value;
    if (normalizePath(configuredRoot) !== normalizePath(expectedRoot)) throw new Error("M67 frozen repository root is invalid.");
  } catch (error) {
    if (error instanceof Error && error.message === "M67 frozen repository root is invalid.") throw error;
    throw new Error("M67 frozen repository root is invalid.");
  }
  const configuredManifestPath = String(input.env.V1_9_E2E_MANIFEST_PATH ?? "").trim();
  if (!configuredManifestPath) throw new Error("M67 frozen run manifest path is required.");
  const manifestPath = pathApi.resolve(configuredManifestPath);
  if (pathApi.dirname(manifestPath) !== pathApi.resolve(input.tempRoot) || pathApi.basename(manifestPath) !== "run-manifest.json") {
    throw new Error("M67 frozen run manifest path is invalid.");
  }
  try {
    assertOwned(input.tempRoot, manifestPath, false, { fileSystem });
    const manifestBytes = fileSystem.readFileSync(manifestPath);
    const fileDigest = hash("sha256").update(manifestBytes).digest("hex");
    const manifest = normalizeManifest(JSON.parse(manifestBytes.toString("utf8")));
    const actualRelativeRunRoot = pathApi.relative(input.root, input.tempRoot).replaceAll("\\", "/");
    if (fileDigest !== input.frozenRunIdentity.manifestSha256 ||
        manifestDigest(manifest) !== input.frozenRunIdentity.manifestSha256 ||
        manifest.runId !== input.frozenRunIdentity.runId ||
        manifest.relativeRunRoot !== actualRelativeRunRoot) {
      throw new Error("M67 frozen run manifest identity is invalid.");
    }
    return manifest.baselineLock;
  } catch (error) {
    if (error instanceof Error && error.message === "M67 frozen run manifest identity is invalid.") throw error;
    throw new Error("M67 frozen run manifest identity is invalid.");
  }
}

export function assertM67FrozenBaselineCurrent(input) {
  if (!input.frozenBaselineLock) return null;
  const currentManifestBaselineLock = input.resolveFrozenBaselineLock();
  if (JSON.stringify(currentManifestBaselineLock) !== JSON.stringify(input.frozenBaselineLock)) {
    throw new Error("M67 frozen run manifest identity is invalid.");
  }
  return input.assertCurrentBaselineLock(currentManifestBaselineLock, { cwd: input.root, env: input.env });
}

export function readM67V1_9OrchestrationLedger(input, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const pathApi = dependencies.pathApi ?? path;
  const normalizeRunState = dependencies.normalizeRunState;
  const deriveExternalCodexCount = dependencies.deriveExternalCodexCount;
  const configuredStatePath = String(input.env.V1_9_E2E_STATE_PATH ?? "").trim();
  if (configuredStatePath) {
    const resolved = pathApi.resolve(configuredStatePath);
    const relative = pathApi.relative(input.tempRoot, resolved);
    if (!relative || relative.startsWith("..") || pathApi.isAbsolute(relative) || pathApi.basename(resolved) !== "run-state.json") {
      return { count: null, source: "run_state_path_rejected" };
    }
    try {
      const state = normalizeRunState(JSON.parse(fileSystem.readFileSync(resolved, "utf8")));
      return {
        count: Array.isArray(state.ledger?.violations)
          ? state.ledger.violations.filter((entry) => entry.orchestrationImpact === true).length
          : null,
        source: "run_state_mutation_ledger",
      };
    } catch {
      return { count: null, source: "run_state_unreadable" };
    }
  }
  const configuredManifestPath = String(input.env.V1_9_E2E_MANIFEST_PATH ?? "").trim();
  if (!configuredManifestPath) return { count: null, source: "manifest_not_configured" };
  const resolved = pathApi.resolve(configuredManifestPath);
  const relative = pathApi.relative(input.tempRoot, resolved);
  if (!relative || relative.startsWith("..") || pathApi.isAbsolute(relative) || pathApi.basename(resolved) !== "run-manifest.json") {
    return { count: null, source: "manifest_path_rejected" };
  }
  try {
    const manifest = JSON.parse(fileSystem.readFileSync(resolved, "utf8"));
    return { count: deriveExternalCodexCount(manifest), source: "legacy_run_manifest_mutation_ledger" };
  } catch {
    return { count: null, source: "manifest_unreadable" };
  }
}

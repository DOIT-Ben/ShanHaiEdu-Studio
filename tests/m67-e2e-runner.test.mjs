import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs, {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sanitizeEvidenceText } from "../scripts/lib/evidence-sanitizer.mjs";
import {
  M67_FROZEN_APP_MARKER_SCHEMA_VERSION,
  assertM67CanonicalOwnedDescendant,
  assertM67FrozenRunStorageState,
  cleanM67OwnedFrozenAppCaches,
  createM67FrozenAppContract,
  digestM67FrozenAppEntries,
  prepareM67FrozenApp,
  resolveM67FrozenAppRoot,
  resolveM67FrozenPlaywrightSpecPath,
  resolveM67FrozenRunIdentity,
} from "../scripts/lib/m67-frozen-app.mjs";

const root = process.cwd();
const runnerSource = readFileSync(path.join(root, "scripts", "run-m67-e2e.mjs"), "utf8");
const v19rSpecSource = readFileSync(path.join(root, "tests", "e2e", "v1-9r-two-user-main-agent.spec.ts"), "utf8");

test("runCommand delegates init, bootstrap, invite, and Playwright children to one shutdown authority", async () => {
  assert.match(runnerSource, /createRunnerShutdownAuthority/);
  assert.doesNotMatch(runnerSource, /const ownedChildren = new Set\(\)/);
  assert.match(runnerSource, /SHANHAI_BOOTSTRAP_ADMIN_CONFIRM:\s*"CREATE_ADMIN"/);
  for (const commandMarker of [
    "scripts/init-sqlite-schema.mjs",
    "bootstrap-admin.mjs",
    "invite-user.mjs",
    "node_modules/@playwright/test/cli.js",
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(commandMarker)));
  }

  const calls = [];
  const runCommand = compileFunction("runCommand", {
    shutdownAuthority: {
      runCommand(...args) {
        calls.push(args);
        return Promise.resolve({ code: 0, signal: null });
      },
    },
    root,
    path,
  });
  await runCommand("node", ["fake-script.mjs"], { TEST_ENV: "1" }, 1_000);
  assert.deepEqual(calls, [["node", ["fake-script.mjs"], {
    cwd: root,
    env: { TEST_ENV: "1" },
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeoutMs: 1_000,
    label: "node",
  }]]);
});

test("cleanup calls share one promise and remove tempRoot only after shared shutdown completes", async () => {
  assert.match(runnerSource, /let cleanupPromise/);
  let releaseShutdown;
  const pendingShutdown = new Promise((resolve) => { releaseShutdown = resolve; });
  const shutdownCalls = [];
  const removals = [];
  const cleanup = compileFunction("cleanup", {
    cleanupPromise: undefined,
    preserveRunDirectory: false,
    shutdownAuthority: {
      shutdown(request) {
        shutdownCalls.push(request);
        return pendingShutdown;
      },
    },
    removeOwnedTempRoot: async () => removals.push("removed"),
  });

  const firstCleanup = cleanup();
  const concurrentCleanup = cleanup();
  assert.equal(concurrentCleanup, firstCleanup);
  assert.deepEqual(shutdownCalls, [{ reason: "cleanup" }]);
  assert.equal(removals.length, 0);

  releaseShutdown();
  await firstCleanup;
  assert.deepEqual(removals, ["removed"]);
});

test("explicit evidence preservation keeps the isolated run directory after owned processes stop", async () => {
  const removals = [];
  const cleanup = compileFunction("cleanup", {
    cleanupPromise: undefined,
    preserveRunDirectory: true,
    shutdownAuthority: { shutdown: async () => ({}) },
    removeOwnedTempRoot: async () => removals.push("removed"),
  });

  await cleanup();

  assert.deepEqual(removals, []);
  assert.match(runnerSource, /M67_E2E_PRESERVE_RUN_DIR/);
});

test("keeps sanitized R5 snapshots and provider channel attribution inside each isolated run", () => {
  assert.match(runnerSource, /M67_E2E_EVIDENCE_DIR:\s*evidenceRoot/);
  assert.match(runnerSource, /providerChannel:\s*resolveProviderChannel\(process\.env\)/);
  assert.match(v19rSpecSource, /process\.env\.M67_E2E_EVIDENCE_DIR/);
  assert.match(v19rSpecSource, /path\.resolve\(evidenceRoot\(\),/);

  const resolveProviderChannel = compileFunction("resolveProviderChannel", {});
  assert.equal(resolveProviderChannel({}), "primary");
  assert.equal(resolveProviderChannel({ AGENT_BRAIN_CHANNEL: " fallback " }), "fallback");
  assert.equal(resolveProviderChannel({ OPENAI_API_KEY: "configured", AGENT_BRAIN_CHANNEL: "fallback" }), "fallback");
  assert.equal(resolveProviderChannel({ OPENAI_API_KEY: "configured", AGENT_BRAIN_CHANNEL: "fallback-typo" }), "invalid");
});

test("M67 has no independent taskkill path and exposes IPC shutdown through the shared authority", () => {
  assert.match(runnerSource, /installRunnerShutdownIpcHandler\(shutdownAuthority\)/);
  assert.match(runnerSource, /shutdownAuthority\.track\(child, \{ label: "m67-next-server" \}\)/);
  assert.doesNotMatch(runnerSource, /taskkill\.exe/);
});

test("captures only sanitized Main Agent failure diagnostics before isolated cleanup", () => {
  const serverLogTail = [];
  const mainAgentFailureDiagnostics = [];
  const sanitizeDiagnosticText = compileFunction("sanitizeDiagnosticText", { sanitizeEvidenceText });
  const captureServerOutput = compileFunction("captureServerOutput", {
    serverLogTail,
    mainAgentFailureDiagnostics,
    sanitizeDiagnosticText,
    sanitizeEvidenceText,
  });

  captureServerOutput(Buffer.from(
    '[main-agent-failure] {"phase":"agent_tool_loop","reason":"adapter_failed","errorName":"Error","summary":"request failed at https://example.invalid with token=private"}\n',
  ));

  assert.equal(mainAgentFailureDiagnostics.length, 1);
  assert.deepEqual(mainAgentFailureDiagnostics[0], {
    phase: "agent_tool_loop",
    reason: "adapter_failed",
    errorName: "Error",
    summary: "request failed at [redacted-url] with token=[redacted]",
  });
  assert.match(runnerSource, /writeSanitizedSummary\("failed"\)/);
  assert.match(
    runnerSource,
    /console\.error\(sanitizeDiagnosticText\(failure instanceof Error \? failure\.message : failure\)\)/,
  );
});

test("sanitizes ordinary Next stdout and stderr before retaining the server log tail", () => {
  const serverLogTail = [];
  const mainAgentFailureDiagnostics = [];
  const rawLog = "教师可读：结构候选已保存 token=private API_KEY=private credential=private sk-live-private https://private.example/v1 C:\\Users\\Teacher\\private.txt /home/teacher/private.txt\n";
  const sanitizedLog = "教师可读：结构候选已保存 token=[redacted] API_KEY=[redacted] credential=[redacted] [redacted] [redacted-url] [redacted-path] [redacted-path]\n";
  const sanitizerCalls = [];
  const captureServerOutput = compileFunction("captureServerOutput", {
    serverLogTail,
    mainAgentFailureDiagnostics,
    sanitizeDiagnosticText: (value) => String(value),
    sanitizeEvidenceText(value) {
      sanitizerCalls.push(String(value));
      return sanitizedLog;
    },
  });

  captureServerOutput(Buffer.from(rawLog));

  assert.deepEqual(sanitizerCalls, [rawLog]);
  assert.deepEqual(serverLogTail, [sanitizedLog]);
  assert.match(serverLogTail[0], /教师可读：结构候选已保存/);
  assert.doesNotMatch(serverLogTail[0], /private\.example|sk-live-private|C:\\Users\\Teacher|\/home\/teacher/);
});

test("skips browser-restricted ports before starting the isolated Next server", () => {
  assert.match(runnerSource, /const browserRestrictedPorts = new Set/);
  assert.match(runnerSource, /1719, 1720, 1723, 2049/);
  const reservePortSource = extractFunction("reservePort");
  assert.match(reservePortSource, /browserRestrictedPorts\.has\(port\)/);
  assert.match(reservePortSource, /browserRestrictedPorts\.has\(requested\)/);
});

test("keeps the V1-9R runner alive longer than the spec-level timeout", () => {
  const resolvePlaywrightCommandTimeoutMs = compileFunction("resolvePlaywrightCommandTimeoutMs", {});

  assert.equal(resolvePlaywrightCommandTimeoutMs(
    "tests/e2e/v1-9r-two-user-main-agent.spec.ts",
    "900000",
  ), 1_560_000);
  assert.equal(resolvePlaywrightCommandTimeoutMs(
    "tests/e2e/v1-9r-two-user-main-agent.spec.ts",
    "1800000",
  ), 1_800_000);
  assert.equal(resolvePlaywrightCommandTimeoutMs("tests/e2e/beta-feedback-center.spec.ts", undefined), 360_000);
});

test("keeps a configured frozen Next app root inside the canonical owned M67 run root", (t) => {
  assert.match(runnerSource, /M67_E2E_FROZEN_APP_ROOT/);
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-path-"));
  const runRoot = path.join(fixtureRoot, "run");
  const outsideRoot = path.join(fixtureRoot, "outside");
  mkdirSync(runRoot);
  mkdirSync(outsideRoot);

  try {
    const frozenRoot = path.join(runRoot, "frozen-next-app");
    assert.equal(resolveM67FrozenAppRoot("", runRoot), null);
    assert.equal(resolveM67FrozenAppRoot("frozen-next-app", runRoot), frozenRoot);
    assert.equal(resolveM67FrozenAppRoot(frozenRoot, runRoot), frozenRoot);
    assert.throws(() => resolveM67FrozenAppRoot(runRoot, runRoot), /owned child directory/);
    assert.throws(
      () => resolveM67FrozenAppRoot(path.join(runRoot, "..", "outside-next-app"), runRoot),
      /owned child directory/,
    );

    const redirectedParent = path.join(runRoot, "redirected");
    try {
      fs.symlinkSync(outsideRoot, redirectedParent, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return;
    }
    assert.throws(
      () => resolveM67FrozenAppRoot(path.join(redirectedParent, "frozen-next-app"), runRoot),
      /symbolic link|junction|reparse|canonical owned child/i,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects a linked ancestor for owned roots and digest bases without rejecting a physical volume chain", (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-ancestor-link-"));
  const physicalRoot = path.join(fixtureRoot, "physical");
  const linkedRoot = path.join(fixtureRoot, "linked");
  const ownerRoot = path.join(physicalRoot, "owner");
  const candidateRoot = path.join(ownerRoot, "run");
  const sourceRoot = path.join(physicalRoot, "source");

  try {
    mkdirSync(candidateRoot, { recursive: true });
    mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
    writeFileSync(path.join(sourceRoot, "src", "version.txt"), "source-v1", "utf8");

    const volumeRoot = path.parse(fixtureRoot).root;
    assert.equal(
      assertM67CanonicalOwnedDescendant(volumeRoot, fixtureRoot, false),
      path.resolve(fixtureRoot),
    );
    const physicalDigest = digestM67FrozenAppEntries(sourceRoot, ["src"]);
    assert.match(physicalDigest, /^[a-f0-9]{64}$/);

    try {
      fs.symlinkSync(physicalRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return;
    }

    assert.throws(
      () => assertM67CanonicalOwnedDescendant(
        path.join(linkedRoot, "owner"),
        path.join(linkedRoot, "owner", "run"),
        false,
      ),
      /symbolic link|junction|reparse|canonical/i,
    );
    assert.throws(
      () => digestM67FrozenAppEntries(path.join(linkedRoot, "source"), ["src"]),
      /symbolic link|junction|reparse|canonical/i,
    );

    if (process.platform === "win32") {
      const extendedFixtureRoot = `\\\\?\\${fixtureRoot}`;
      assert.equal(
        assertM67CanonicalOwnedDescendant(path.parse(extendedFixtureRoot).root, extendedFixtureRoot, false),
        path.resolve(extendedFixtureRoot),
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("requires explicit V1-9 frozen run identity instead of inferring resume from SQLite", () => {
  const manifestSha256 = "a".repeat(64);
  assert.equal(resolveM67FrozenRunIdentity({}, null), null);
  assert.deepEqual(resolveM67FrozenRunIdentity({
    V1_9_RUN_MODE: "start-new",
    V1_9_E2E_RUN_ID: "v1-9-fresh-run",
    V1_9_E2E_MANIFEST_SHA256: manifestSha256,
  }, "configured-root"), { mode: "start-new", runId: "v1-9-fresh-run", manifestSha256 });
  assert.deepEqual(resolveM67FrozenRunIdentity({
    V1_9_RUN_MODE: "resume",
    V1_9_E2E_RUN_ID: "v1-9-resume-run",
    V1_9_E2E_MANIFEST_SHA256: manifestSha256,
  }, "configured-root"), { mode: "resume", runId: "v1-9-resume-run", manifestSha256 });
  assert.throws(
    () => resolveM67FrozenRunIdentity({ V1_9_RUN_MODE: "resume" }, "configured-root"),
    /frozen run identity/i,
  );
});

test("fails closed when explicit fresh or resume mode disagrees with owned storage", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-storage-"));
  const databasePath = path.join(fixtureRoot, "m67.sqlite");
  const artifactRoot = path.join(fixtureRoot, "artifact-storage");
  const isolatedAppRoot = path.join(fixtureRoot, "next-app-frozen");
  try {
    const freshInput = {
      identity: { mode: "start-new", runId: "v1-9-fresh", manifestSha256: "a".repeat(64) },
      databasePath,
      artifactRoot,
      appRoot: isolatedAppRoot,
    };
    assert.doesNotThrow(() => assertM67FrozenRunStorageState(freshInput));
    writeFileSync(databasePath, "not-empty", "utf8");
    assert.throws(() => assertM67FrozenRunStorageState(freshInput), /fresh frozen run storage is not empty/i);
    rmSync(databasePath, { force: true });

    const resumeInput = {
      identity: { mode: "resume", runId: "v1-9-resume", manifestSha256: "b".repeat(64) },
      databasePath,
      artifactRoot,
      appRoot: isolatedAppRoot,
    };
    assert.throws(() => assertM67FrozenRunStorageState(resumeInput), /resume frozen run storage is incomplete/i);
    writeFileSync(databasePath, "sqlite", "utf8");
    mkdirSync(artifactRoot);
    mkdirSync(isolatedAppRoot);
    assert.doesNotThrow(() => assertM67FrozenRunStorageState(resumeInput));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("binds the frozen baseline to repository root, run root, run id, and immutable manifest bytes", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-manifest-"));
  const repositoryRoot = path.join(fixtureRoot, "repository");
  const tempRoot = path.join(repositoryRoot, "test-results", "v1-9-fixture");
  const manifestPath = path.join(tempRoot, "run-manifest.json");
  const baselineLock = { schemaVersion: "v1-9-baseline-lock.v1", runtimeSourceDigest: "a".repeat(64) };
  const manifest = {
    schemaVersion: "v1-9-run-manifest.v2",
    runId: "v1-9-fixture",
    relativeRunRoot: "test-results/v1-9-fixture",
    baselineLock,
  };
  const canonicalDigest = (value) => createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`)
    .digest("hex");

  try {
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const identity = {
      mode: "start-new",
      runId: manifest.runId,
      manifestSha256: canonicalDigest(manifest),
    };
    const fakeProcess = {
      platform: process.platform,
      env: {
        SHANHAI_V1_9_REPOSITORY_ROOT: repositoryRoot,
        V1_9_E2E_MANIFEST_PATH: manifestPath,
      },
    };
    const resolveFrozenBaselineLock = compileFunction("resolveFrozenBaselineLock", {
      frozenRunIdentity: identity,
      process: fakeProcess,
      fs,
      path,
      root: repositoryRoot,
      tempRoot,
      createHash,
      normalizeV1_9RunManifestV2: (value) => value,
      createV1_9RunManifestV2Digest: canonicalDigest,
      assertM67CanonicalOwnedDescendant,
    });

    assert.deepEqual(resolveFrozenBaselineLock(), baselineLock);

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n `, "utf8");
    assert.throws(() => resolveFrozenBaselineLock(), /manifest identity is invalid/i);

    manifest.relativeRunRoot = "test-results/v1-9-other";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    identity.manifestSha256 = canonicalDigest(manifest);
    assert.throws(() => resolveFrozenBaselineLock(), /manifest identity is invalid/i);

    fakeProcess.env.SHANHAI_V1_9_REPOSITORY_ROOT = fixtureRoot;
    assert.throws(() => resolveFrozenBaselineLock(), /repository root is invalid/i);

    let manifestReads = 0;
    let baselineChecks = 0;
    const assertFrozenBaselineCurrent = compileFunction("assertFrozenBaselineCurrent", {
      frozenBaselineLock: baselineLock,
      resolveFrozenBaselineLock() {
        manifestReads += 1;
        return baselineLock;
      },
      assertCurrentV1_9BaselineLock(value) {
        baselineChecks += 1;
        return value;
      },
      root: repositoryRoot,
      process: fakeProcess,
    });
    assert.deepEqual(assertFrozenBaselineCurrent(), baselineLock);
    assert.equal(manifestReads, 1);
    assert.equal(baselineChecks, 1);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("cleans only owned transient Next caches before frozen-tree verification", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-cache-"));
  const isolatedAppRoot = path.join(fixtureRoot, "next-app-frozen");
  mkdirSync(path.join(isolatedAppRoot, ".next-m67"), { recursive: true });
  mkdirSync(path.join(isolatedAppRoot, ".tmp"), { recursive: true });
  mkdirSync(path.join(isolatedAppRoot, "node_modules"), { recursive: true });
  writeFileSync(path.join(isolatedAppRoot, ".next-m67", "stale.js"), "stale", "utf8");
  writeFileSync(path.join(isolatedAppRoot, ".tmp", "stale.tmp"), "stale", "utf8");

  try {
    cleanM67OwnedFrozenAppCaches(isolatedAppRoot, fixtureRoot);
    assert.equal(fs.existsSync(path.join(isolatedAppRoot, ".next-m67")), false);
    assert.equal(fs.existsSync(path.join(isolatedAppRoot, ".tmp")), false);
    assert.equal(fs.existsSync(path.join(isolatedAppRoot, "node_modules")), true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects a linked transient cache instead of deleting through it", (t) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-cache-link-"));
  const isolatedAppRoot = path.join(fixtureRoot, "next-app-frozen");
  const outsideRoot = path.join(fixtureRoot, "outside");
  mkdirSync(isolatedAppRoot);
  mkdirSync(outsideRoot);
  writeFileSync(path.join(outsideRoot, "must-remain.txt"), "retained", "utf8");

  try {
    assert.throws(
      () => cleanM67OwnedFrozenAppCaches(isolatedAppRoot, outsideRoot),
      /canonical owned child|direct owned child|not a canonical owned child/i,
    );
    try {
      fs.symlinkSync(outsideRoot, path.join(isolatedAppRoot, ".next-m67"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
      return;
    }
    assert.throws(
      () => cleanM67OwnedFrozenAppCaches(isolatedAppRoot, fixtureRoot),
      /symbolic link|junction|reparse/i,
    );
    assert.equal(readFileSync(path.join(outsideRoot, "must-remain.txt"), "utf8"), "retained");

    rmSync(path.join(isolatedAppRoot, ".next-m67"), { force: true });
    mkdirSync(path.join(isolatedAppRoot, ".next-m67"));
    fs.symlinkSync(
      outsideRoot,
      path.join(isolatedAppRoot, ".next-m67", "nested-redirect"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => cleanM67OwnedFrozenAppCaches(isolatedAppRoot, fixtureRoot),
      /symbolic link|junction|reparse/i,
    );
    assert.equal(readFileSync(path.join(outsideRoot, "must-remain.txt"), "utf8"), "retained");
    assert.equal(fs.existsSync(path.join(isolatedAppRoot, ".next-m67")), true);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("starts Next with the frozen app as process cwd", () => {
  const calls = [];
  const child = new FakeChild(401);
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const spawn = (...args) => {
    calls.push(args);
    return child;
  };
  const isolatedAppRoot = path.join(root, "test-results", "v1-9-fixture", "next-app-frozen");
  const tracked = [];
  const startNextServer = compileFunction("startNextServer", {
    spawn,
    path,
    root,
    isolatedAppRoot,
    captureServerOutput: () => undefined,
    shutdownAuthority: { track: (...args) => tracked.push(args) },
  });

  startNextServer({ TEST_ENV: "1" }, 32123);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].cwd, isolatedAppRoot);
  assert.deepEqual(tracked, [[child, { label: "m67-next-server" }]]);
});

test("freezes the complete V1-9 app and observer dependency closure", () => {
  const contract = createM67FrozenAppContract("tests/e2e/v1-9-unique-real-product.spec.ts");
  for (const entry of [
    "config",
    "fixtures",
    "package-lock.json",
    "tests/e2e/support/feedback.ts",
    "tests/e2e/support/redline.ts",
    "scripts/lib/v1-9-e2e-contract.mjs",
    "scripts/lib/evidence-sanitizer.mjs",
    "scripts/lib/v1-9-final-package-selection.mjs",
  ]) {
    assert.equal(contract.copiedEntries.includes(entry), true, `${entry} must be frozen`);
  }
  assert.equal(contract.requiredFiles.includes("tests/e2e/v1-9-unique-real-product.spec.ts"), true);
  assert.equal(contract.frozenEntries.includes("next.config.mjs"), true);
  assert.equal(
    resolveM67FrozenPlaywrightSpecPath("tests/e2e/v1-9-unique-real-product.spec.ts", "C:\\owned-app"),
    path.join("C:\\owned-app", "tests", "e2e", "v1-9-unique-real-product.spec.ts"),
  );
  assert.throws(
    () => resolveM67FrozenPlaywrightSpecPath("../outside.spec.ts", "C:\\owned-app"),
    /spec path is invalid/i,
  );
});

test("computes a deterministic byte digest for frozen Next app entries", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-digest-"));
  const sourceA = path.join(fixtureRoot, "source-a");
  const sourceB = path.join(fixtureRoot, "source-b");
  const frozenSourceEntries = ["src", "public", "package.json", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs"];

  try {
    writeAppSourceFixture(sourceA, "same-bytes");
    writeAppSourceFixture(sourceB, "same-bytes");
    mkdirSync(path.join(sourceA, "src", "nested"), { recursive: true });
    mkdirSync(path.join(sourceB, "src", "nested"), { recursive: true });
    writeFileSync(path.join(sourceA, "src", "nested", "z.txt"), "z", "utf8");
    writeFileSync(path.join(sourceA, "src", "nested", "a.txt"), "a", "utf8");
    writeFileSync(path.join(sourceB, "src", "nested", "a.txt"), "a", "utf8");
    writeFileSync(path.join(sourceB, "src", "nested", "z.txt"), "z", "utf8");

    const digestA = digestM67FrozenAppEntries(sourceA, frozenSourceEntries);
    const digestB = digestM67FrozenAppEntries(sourceB, frozenSourceEntries);
    assert.match(digestA, /^[a-f0-9]{64}$/);
    assert.equal(digestA, digestB);

    writeFileSync(path.join(sourceB, "src", "nested", "a.txt"), "changed", "utf8");
    assert.notEqual(digestM67FrozenAppEntries(sourceB, frozenSourceEntries), digestA);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("freezes the current Next app once with run-bound source, copy and full-tree digests", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-next-app-"));
  const sourceRoot = path.join(fixtureRoot, "source");
  const runRoot = path.join(fixtureRoot, "run");
  const frozenRoot = path.join(runRoot, "frozen-next-app");
  const markerPath = path.join(frozenRoot, ".m67-frozen-app.json");
  const manifestSha256 = "a".repeat(64);
  const nextConfigContents = createFrozenNextConfig();

  try {
    writeAppSourceFixture(sourceRoot, "source-v1");
    mkdirSync(runRoot);
    const freshIdentity = { mode: "start-new", runId: "v1-9-fixture", manifestSha256 };
    prepareM67FrozenApp({
      sourceRoot,
      runRoot,
      appRoot: frozenRoot,
      markerPath,
      identity: freshIdentity,
      requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
      nextConfigContents,
      assertBaselineCurrent: () => undefined,
    });
    assert.equal(readFileSync(path.join(frozenRoot, "src", "version.txt"), "utf8"), "source-v1");
    const markerBeforeResume = readFileSync(markerPath, "utf8");
    const marker = JSON.parse(markerBeforeResume);
    assert.equal(marker.schemaVersion, M67_FROZEN_APP_MARKER_SCHEMA_VERSION);
    assert.equal(marker.runId, "v1-9-fixture");
    assert.equal(marker.manifestSha256, manifestSha256);
    assert.deepEqual(marker.copiedEntries, marker.frozenEntries.filter((entry) => entry !== "next.config.mjs"));
    assert.match(marker.sourceEntriesDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(marker.copiedEntriesDigest, marker.sourceEntriesDigest);
    assert.match(marker.frozenEntriesDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(readFileSync(path.join(frozenRoot, "scripts", "lib", "v1-9-e2e-contract.mjs"), "utf8"), "contract-v1");
    assert.equal(readFileSync(path.join(frozenRoot, "tests", "e2e", "v1-9-unique-real-product.spec.ts"), "utf8"), "spec-v1");
    assert.equal(readFileSync(path.join(frozenRoot, "tests", "e2e", "support", "redline.ts"), "utf8"), "redline-v1");
    assert.equal(readFileSync(path.join(frozenRoot, "config", "node-contract.json"), "utf8"), "node-contract-v1");
    assert.equal(readFileSync(path.join(frozenRoot, "fixtures", "coze.json"), "utf8"), "coze-fixture-v1");

    const resumeIdentity = { mode: "resume", runId: "v1-9-fixture", manifestSha256 };
    const prepareResume = () => prepareM67FrozenApp({
      sourceRoot,
      runRoot,
      appRoot: frozenRoot,
      markerPath,
      identity: resumeIdentity,
      requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
      nextConfigContents,
      assertBaselineCurrent: () => undefined,
    });

    prepareResume();
    assert.equal(readFileSync(path.join(frozenRoot, "src", "version.txt"), "utf8"), "source-v1");
    assert.equal(readFileSync(markerPath, "utf8"), markerBeforeResume);
    assert.throws(
      () => prepareM67FrozenApp({
        sourceRoot,
        runRoot: fixtureRoot,
        appRoot: frozenRoot,
        markerPath,
        identity: resumeIdentity,
        requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
        nextConfigContents,
        assertBaselineCurrent: () => undefined,
      }),
      /direct owned child/i,
    );
    assert.throws(
      () => prepareM67FrozenApp({
        sourceRoot,
        runRoot,
        appRoot: frozenRoot,
        markerPath: path.join(runRoot, "outside-marker.json"),
        identity: resumeIdentity,
        requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
        nextConfigContents,
        assertBaselineCurrent: () => undefined,
      }),
      /marker path is invalid/i,
    );

    const wrongIdentity = { mode: "resume", runId: "v1-9-other", manifestSha256 };
    const prepareWrongRunResume = () => prepareM67FrozenApp({
      sourceRoot,
      runRoot,
      appRoot: frozenRoot,
      markerPath,
      identity: wrongIdentity,
      requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
      nextConfigContents,
      assertBaselineCurrent: () => undefined,
    });
    mkdirSync(path.join(frozenRoot, ".next-m67"));
    mkdirSync(path.join(frozenRoot, ".tmp"));
    writeFileSync(path.join(frozenRoot, ".next-m67", "crash-cache.js"), "stale", "utf8");
    writeFileSync(path.join(frozenRoot, ".tmp", "crash-state"), "stale", "utf8");
    assert.throws(() => prepareWrongRunResume(), /frozen app marker identity mismatch on resume/i);
    assert.equal(readFileSync(path.join(frozenRoot, ".next-m67", "crash-cache.js"), "utf8"), "stale");
    assert.equal(readFileSync(path.join(frozenRoot, ".tmp", "crash-state"), "utf8"), "stale");
    assert.doesNotThrow(() => prepareResume());
    assert.equal(fs.existsSync(path.join(frozenRoot, ".next-m67")), false);
    assert.equal(fs.existsSync(path.join(frozenRoot, ".tmp")), false);

    mkdirSync(path.join(frozenRoot, "node_modules"));
    assert.throws(() => prepareResume(), /unexpected entry: node_modules/i);
    rmSync(path.join(frozenRoot, "node_modules"), { recursive: true, force: true });
    writeFileSync(path.join(frozenRoot, "injected.txt"), "injected", "utf8");
    assert.throws(() => prepareResume(), /unexpected entry: injected\.txt/i);
    rmSync(path.join(frozenRoot, "injected.txt"), { force: true });

    writeFileSync(path.join(sourceRoot, "src", "version.txt"), "source-v2", "utf8");
    assert.throws(() => prepareResume(), /content digest mismatch on resume/);
    writeFileSync(path.join(sourceRoot, "src", "version.txt"), "source-v1", "utf8");

    writeFileSync(path.join(frozenRoot, "src", "version.txt"), "tampered", "utf8");
    assert.throws(() => prepareResume(), /content digest mismatch on resume/);
    writeFileSync(path.join(frozenRoot, "src", "version.txt"), "source-v1", "utf8");

    const nextCacheWitness = Buffer.from("next-cache-must-remain", "utf8");
    const tmpCacheWitness = Buffer.from("tmp-cache-must-remain", "utf8");
    for (const digestField of ["sourceEntriesDigest", "copiedEntriesDigest", "frozenEntriesDigest"]) {
      const nextCachePath = path.join(frozenRoot, ".next-m67");
      const tmpCachePath = path.join(frozenRoot, ".tmp");
      mkdirSync(nextCachePath);
      mkdirSync(tmpCachePath);
      writeFileSync(path.join(nextCachePath, "witness.bin"), nextCacheWitness);
      writeFileSync(path.join(tmpCachePath, "witness.bin"), tmpCacheWitness);
      writeFileSync(markerPath, JSON.stringify({
        ...marker,
        [digestField]: `sha256:${"0".repeat(64)}`,
      }), "utf8");

      assert.throws(() => prepareResume(), /content digest mismatch on resume/);
      assert.deepEqual(readFileSync(path.join(nextCachePath, "witness.bin")), nextCacheWitness);
      assert.deepEqual(readFileSync(path.join(tmpCachePath, "witness.bin")), tmpCacheWitness);
      rmSync(nextCachePath, { recursive: true, force: true });
      rmSync(tmpCachePath, { recursive: true, force: true });
    }
    writeFileSync(markerPath, markerBeforeResume, "utf8");

    rmSync(frozenRoot, { recursive: true, force: true });
    assert.throws(() => prepareResume(), /frozen app root is missing on resume/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("fails a fresh freeze when source bytes change and removes the owned staging tree", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-source-drift-"));
  const sourceRoot = path.join(fixtureRoot, "source");
  const runRoot = path.join(fixtureRoot, "run");
  const frozenRoot = path.join(runRoot, "frozen-next-app");
  const markerPath = path.join(frozenRoot, ".m67-frozen-app.json");

  try {
    writeAppSourceFixture(sourceRoot, "source-v1");
    mkdirSync(runRoot);
    let mutated = false;
    const mutatingFs = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "cpSync") return Reflect.get(target, property, receiver);
        return (...args) => {
          target.cpSync(...args);
          if (!mutated) {
            mutated = true;
            writeFileSync(path.join(sourceRoot, "src", "version.txt"), "source-v2", "utf8");
          }
        };
      },
    });
    const frozenRunIdentity = {
      mode: "start-new",
      runId: "v1-9-source-drift",
      manifestSha256: "b".repeat(64),
    };
    const prepareFresh = () => prepareM67FrozenApp({
      sourceRoot,
      runRoot,
      appRoot: frozenRoot,
      markerPath,
      identity: frozenRunIdentity,
      requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
      nextConfigContents: createFrozenNextConfig(),
      assertBaselineCurrent: () => undefined,
    }, { fileSystem: mutatingFs });

    assert.throws(() => prepareFresh(), /source changed while freezing/);
    assert.equal(fs.existsSync(frozenRoot), false);
    assert.equal(fs.existsSync(markerPath), false);
    assert.deepEqual(fs.readdirSync(runRoot), []);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects a destination copy mismatch and never publishes the final frozen root", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-copy-drift-"));
  const sourceRoot = path.join(fixtureRoot, "source");
  const runRoot = path.join(fixtureRoot, "run");
  const frozenRoot = path.join(runRoot, "frozen-next-app");
  const markerPath = path.join(frozenRoot, ".m67-frozen-app.json");

  try {
    writeAppSourceFixture(sourceRoot, "source-v1");
    mkdirSync(runRoot);
    let mutated = false;
    const mutatingFs = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "cpSync") return Reflect.get(target, property, receiver);
        return (...args) => {
          target.cpSync(...args);
          if (!mutated) {
            mutated = true;
            writeFileSync(path.join(String(args[1]), "version.txt"), "destination-tampered", "utf8");
          }
        };
      },
    });
    const frozenRunIdentity = {
      mode: "start-new",
      runId: "v1-9-copy-drift",
      manifestSha256: "c".repeat(64),
    };
    const prepareFresh = () => prepareM67FrozenApp({
      sourceRoot,
      runRoot,
      appRoot: frozenRoot,
      markerPath,
      identity: frozenRunIdentity,
      requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
      nextConfigContents: createFrozenNextConfig(),
      assertBaselineCurrent: () => undefined,
    }, { fileSystem: mutatingFs });

    assert.throws(() => prepareFresh(), /frozen app copy digest mismatch/i);
    assert.equal(fs.existsSync(frozenRoot), false);
    assert.deepEqual(fs.readdirSync(runRoot), []);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("checks the immutable manifest baseline before copying and after a successful fresh freeze", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-frozen-baseline-"));
  const sourceRoot = path.join(fixtureRoot, "source");
  const runRoot = path.join(fixtureRoot, "run");
  const frozenRoot = path.join(runRoot, "frozen-next-app");
  const markerPath = path.join(frozenRoot, ".m67-frozen-app.json");
  const identity = { mode: "start-new", runId: "v1-9-baseline", manifestSha256: "d".repeat(64) };

  try {
    writeAppSourceFixture(sourceRoot, "source-v1");
    mkdirSync(runRoot);
    let copyCalls = 0;
    const observingFs = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "cpSync") return Reflect.get(target, property, receiver);
        return (...args) => {
          copyCalls += 1;
          return target.cpSync(...args);
        };
      },
    });
    assert.throws(
      () => prepareM67FrozenApp({
        sourceRoot,
        runRoot,
        appRoot: frozenRoot,
        markerPath,
        identity,
        requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
        nextConfigContents: createFrozenNextConfig(),
        assertBaselineCurrent() {
          throw new Error("baseline drift before freeze");
        },
      }, { fileSystem: observingFs }),
      /baseline drift before freeze/,
    );
    assert.equal(copyCalls, 0);
    assert.equal(fs.existsSync(frozenRoot), false);

    let publishingChecks = 0;
    assert.throws(
      () => prepareM67FrozenApp({
        sourceRoot,
        runRoot,
        appRoot: frozenRoot,
        markerPath,
        identity,
        requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
        nextConfigContents: createFrozenNextConfig(),
        assertBaselineCurrent() {
          publishingChecks += 1;
          if (publishingChecks === 2) throw new Error("baseline drift before publish");
        },
      }),
      /baseline drift before publish/,
    );
    assert.equal(publishingChecks, 2);
    assert.equal(fs.existsSync(frozenRoot), false);
    assert.deepEqual(fs.readdirSync(runRoot), []);

    let baselineChecks = 0;
    prepareM67FrozenApp({
      sourceRoot,
      runRoot,
      appRoot: frozenRoot,
      markerPath,
      identity,
      requestedSpec: "tests/e2e/v1-9-unique-real-product.spec.ts",
      nextConfigContents: createFrozenNextConfig(),
      assertBaselineCurrent() {
        baselineChecks += 1;
      },
    });
    assert.equal(baselineChecks, 2);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("runs the V1-9 observer from the frozen tree with a clean dist cache and final integrity check", () => {
  assert.match(runnerSource, /resolveM67FrozenPlaywrightSpecPath/);
  assert.match(runnerSource, /cleanM67OwnedFrozenAppCaches/);
  assert.match(runnerSource, /verifyM67FrozenApp/);
  assert.match(runnerSource, /assertCurrentV1_9BaselineLock/);
  const topLevelStart = runnerSource.indexOf("try {");
  const topLevelEnd = runnerSource.indexOf("\n} catch (error)", topLevelStart);
  const topLevelRun = runnerSource.slice(topLevelStart, topLevelEnd);
  const prepareIndex = topLevelRun.indexOf("prepareIsolatedNextApp();");
  const firstBaselineIndex = topLevelRun.indexOf("assertFrozenBaselineCurrent();");
  const finalBaselineIndex = topLevelRun.lastIndexOf("assertFrozenBaselineCurrent();");
  const startNextIndex = topLevelRun.indexOf("startNextServer(env, port)");
  assert.ok(firstBaselineIndex < prepareIndex);
  assert.ok(prepareIndex < finalBaselineIndex);
  assert.ok(finalBaselineIndex < startNextIndex);

  const stopSequence = extractFunction("stopNextServerAndVerifyFrozenApp");
  assert.match(stopSequence, /shutdownAuthority\.shutdown/);
  const postStopSequence = extractFunction("verifyFrozenAppAfterOwnedProcessesStop");
  assert.ok(postStopSequence.indexOf("verifyM67FrozenAppBeforeCacheCleanup") < postStopSequence.indexOf("cleanM67OwnedFrozenAppCaches"));
  assert.ok(postStopSequence.indexOf("cleanM67OwnedFrozenAppCaches") < postStopSequence.indexOf("verifyFrozenAppIntegrity()"));
  assert.ok(postStopSequence.indexOf("verifyFrozenAppIntegrity()") < postStopSequence.indexOf("assertFrozenBaselineCurrent()"));
});

test("keeps the legacy unconfigured isolated app refresh behavior", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-unconfigured-next-app-"));
  const sourceRoot = path.join(fixtureRoot, "source");
  const isolatedRoot = path.join(fixtureRoot, "isolated");

  try {
    writeAppSourceFixture(sourceRoot, "current-source");
    mkdirSync(path.join(isolatedRoot, "src"), { recursive: true });
    writeFileSync(path.join(isolatedRoot, "src", "version.txt"), "stale-source", "utf8");
    const prepareUnconfigured = compileFunction("prepareIsolatedNextApp", {
      fs,
      path,
      isolatedAppRoot: isolatedRoot,
      root: sourceRoot,
      configuredFrozenAppRoot: null,
      resumeExistingRun: true,
      frozenAppMarkerPath: null,
      frozenAppMarkerSchemaVersion: "m67-frozen-app.v2",
    });

    prepareUnconfigured();
    assert.equal(readFileSync(path.join(isolatedRoot, "src", "version.txt"), "utf8"), "current-source");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("reads the V1-9 orchestration ledger from run-state before the legacy manifest", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-run-state-ledger-"));
  const statePath = path.join(fixtureRoot, "run-state.json");
  const manifestPath = path.join(fixtureRoot, "run-manifest.json");
  const manifestBytes = '{"schemaVersion":"v1-9-run-manifest.v2","immutable":true}\n';

  try {
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: "v1-9-run-state.v3",
      ledger: {
        externalCodexOrchestrationCount: 1,
        violations: [
          { orchestrationImpact: true },
          { orchestrationImpact: false },
        ],
      },
    }), "utf8");
    writeFileSync(manifestPath, manifestBytes, "utf8");
    const readV1_9OrchestrationLedger = compileFunction("readV1_9OrchestrationLedger", {
      process: {
        env: {
          V1_9_E2E_STATE_PATH: statePath,
          V1_9_E2E_MANIFEST_PATH: manifestPath,
        },
      },
      path,
      tempRoot: fixtureRoot,
      fs,
      normalizeV1_9RunState: (state) => state,
      deriveV1_9ExternalCodexOrchestrationCount: () => {
        throw new Error("legacy manifest must not be read when run-state is configured");
      },
    });

    assert.deepEqual(readV1_9OrchestrationLedger(), {
      count: 1,
      source: "run_state_mutation_ledger",
    });
    assert.equal(readFileSync(manifestPath, "utf8"), manifestBytes);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects an out-of-run V1-9 state ledger without falling back to the manifest", () => {
  const runRoot = path.join(root, "test-results", "m67-ledger-boundary");
  const outsideStatePath = path.join(root, "test-results", "outside-run-state.json");
  const readV1_9OrchestrationLedger = compileFunction("readV1_9OrchestrationLedger", {
    process: {
      env: {
        V1_9_E2E_STATE_PATH: outsideStatePath,
        V1_9_E2E_MANIFEST_PATH: path.join(runRoot, "run-manifest.json"),
      },
    },
    path,
    tempRoot: runRoot,
    fs,
    normalizeV1_9RunState: (state) => state,
    deriveV1_9ExternalCodexOrchestrationCount: () => 0,
  });

  assert.deepEqual(readV1_9OrchestrationLedger(), {
    count: null,
    source: "run_state_path_rejected",
  });
});

test("retains the old manifest ledger only as an unconfigured-state compatibility path", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "m67-legacy-manifest-ledger-"));
  const manifestPath = path.join(fixtureRoot, "run-manifest.json");

  try {
    writeFileSync(manifestPath, JSON.stringify({ violations: [{ orchestrationImpact: true }] }), "utf8");
    const readV1_9OrchestrationLedger = compileFunction("readV1_9OrchestrationLedger", {
      process: { env: { V1_9_E2E_MANIFEST_PATH: manifestPath } },
      path,
      tempRoot: fixtureRoot,
      fs,
      normalizeV1_9RunState: (state) => state,
      deriveV1_9ExternalCodexOrchestrationCount: (manifest) => manifest.violations.length,
    });

    assert.deepEqual(readV1_9OrchestrationLedger(), {
      count: 1,
      source: "legacy_run_manifest_mutation_ledger",
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

function compileFunction(name, dependencies) {
  const functionSource = extractFunction(name);
  const dependencyNames = Object.keys(dependencies);
  const factory = new Function(...dependencyNames, `return (${functionSource});`);
  const compiled = factory(...dependencyNames.map((dependencyName) => dependencies[dependencyName]));
  compiled.dependencies = dependencies;
  return compiled;
}

function extractFunction(name) {
  const match = runnerSource.match(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, "m"));
  assert.ok(match, `Expected ${name} to be a top-level function`);
  return match[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createFrozenNextConfig() {
  return [
    "const nextConfig = {",
    '  distDir: ".next-m67",',
    "};",
    "export default nextConfig;",
    "",
  ].join("\n");
}

function writeAppSourceFixture(sourceRoot, version) {
  mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "public"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "config"), { recursive: true });
  mkdirSync(path.join(sourceRoot, "fixtures"), { recursive: true });
  writeFileSync(path.join(sourceRoot, "src", "version.txt"), version, "utf8");
  writeFileSync(path.join(sourceRoot, "public", "asset.txt"), "asset", "utf8");
  writeFileSync(path.join(sourceRoot, "config", "node-contract.json"), "node-contract-v1", "utf8");
  writeFileSync(path.join(sourceRoot, "fixtures", "coze.json"), "coze-fixture-v1", "utf8");
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs"]) {
    writeFileSync(path.join(sourceRoot, file), `{\"fixture\":\"${file}\"}\n`, "utf8");
  }
  const relativeFiles = {
    "tests/e2e/v1-9-unique-real-product.spec.ts": "spec-v1",
    "tests/e2e/support/feedback.ts": "feedback-v1",
    "tests/e2e/support/redline.ts": "redline-v1",
    "scripts/lib/v1-9-e2e-contract.mjs": "contract-v1",
    "scripts/lib/evidence-sanitizer.mjs": "sanitizer-v1",
    "scripts/lib/v1-9-final-package-selection.mjs": "selection-v1",
  };
  for (const [relativePath, contents] of Object.entries(relativeFiles)) {
    const filePath = path.join(sourceRoot, ...relativePath.split("/"));
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents, "utf8");
  }
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
  }

  kill() {}
}

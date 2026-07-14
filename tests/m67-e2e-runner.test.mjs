import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const runnerSource = readFileSync(path.join(root, "scripts", "run-m67-e2e.mjs"), "utf8");
const v19rSpecSource = readFileSync(path.join(root, "tests", "e2e", "v1-9r-two-user-main-agent.spec.ts"), "utf8");

test("runCommand owns init, bootstrap, invite, and Playwright children until they settle", async () => {
  assert.match(runnerSource, /const ownedChildren = new Set\(\)/);
  assert.match(runnerSource, /SHANHAI_BOOTSTRAP_ADMIN_CONFIRM:\s*"CREATE_ADMIN"/);
  for (const commandMarker of [
    "scripts/init-sqlite-schema.mjs",
    "bootstrap-admin.mjs",
    "invite-user.mjs",
    "node_modules/@playwright/test/cli.js",
  ]) {
    assert.match(runnerSource, new RegExp(escapeRegExp(commandMarker)));
  }

  const runCommand = compileFunction("runCommand", {
    spawn: createFakeSpawn(),
    ownedChildren: new Set(),
    root,
    path,
    stopProcessTree: async () => {},
  });
  const child = new FakeChild(101);
  const ownedChildren = runCommand.dependencies.ownedChildren;
  runCommand.dependencies.spawn.nextChild = child;

  const completion = runCommand("node", ["fake-script.mjs"], {}, 1_000);
  assert.equal(ownedChildren.has(child), true);
  child.emit("exit", 0, null);
  await completion;
  assert.equal(ownedChildren.has(child), false);

  const failedChild = new FakeChild(102);
  runCommand.dependencies.spawn.nextChild = failedChild;
  const failure = runCommand("node", ["failing-script.mjs"], {}, 1_000);
  assert.equal(ownedChildren.has(failedChild), true);
  failedChild.emit("error", new Error("controlled spawn failure"));
  await assert.rejects(failure, /controlled spawn failure/);
  assert.equal(ownedChildren.has(failedChild), false);
});

test("cleanup calls share one promise and remove tempRoot only after every owned process stops", async () => {
  assert.match(runnerSource, /let cleanupPromise/);
  const nextServer = new FakeChild(201);
  const commandA = new FakeChild(202);
  const commandB = new FakeChild(203);
  const ownedChildren = new Set([commandA, commandB]);
  const pendingStops = [];
  const stopped = [];
  const removals = [];
  const removeOwnedTempRoot = compileFunction("removeOwnedTempRoot", {
    fs: {
      rmSync(...args) {
        removals.push(args);
      },
    },
    tempRoot: "controlled-temp-root",
    setTimeout,
  });
  const cleanup = compileFunction("cleanup", {
    cleanupPromise: undefined,
    nextServer,
    ownedChildren,
    preserveRunDirectory: false,
    stopProcessTree(child) {
      stopped.push(child);
      return new Promise((resolve) => pendingStops.push(resolve));
    },
    removeOwnedTempRoot,
  });

  const firstCleanup = cleanup();
  const concurrentCleanup = cleanup();
  assert.equal(concurrentCleanup, firstCleanup);
  assert.deepEqual(new Set(stopped), new Set([nextServer, commandA, commandB]));
  assert.equal(removals.length, 0);

  for (const resolve of pendingStops) resolve();
  await firstCleanup;
  assert.deepEqual(removals, [["controlled-temp-root", { recursive: true, force: true }]]);
});

test("explicit evidence preservation keeps the isolated run directory after owned processes stop", async () => {
  const nextServer = new FakeChild(211);
  const removals = [];
  const cleanup = compileFunction("cleanup", {
    cleanupPromise: undefined,
    nextServer,
    ownedChildren: new Set(),
    preserveRunDirectory: true,
    stopProcessTree: async () => {},
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
  assert.equal(resolveProviderChannel({ OPENAI_API_KEY: "configured", AGENT_BRAIN_CHANNEL: "fallback" }), "openai");
});

test("Windows taskkill is gated by runner ownership and targets only the owned child PID", async () => {
  const ownedChild = new FakeChild(301);
  const unownedChild = new FakeChild(302);
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push({ command, args });
    const killer = new FakeChild(999);
    queueMicrotask(() => killer.emit("exit", 0));
    return killer;
  };
  const stopProcessTree = compileFunction("stopProcessTree", {
    isOwnedProcess: (child) => child === ownedChild,
    process: { platform: "win32" },
    spawn: fakeSpawn,
    setTimeout,
  });

  await stopProcessTree(unownedChild);
  assert.equal(calls.length, 0);

  await stopProcessTree(ownedChild);
  assert.deepEqual(calls, [{ command: "taskkill.exe", args: ["/PID", "301", "/T", "/F"] }]);
});

test("captures only sanitized Main Agent failure diagnostics before isolated cleanup", () => {
  const serverLogTail = [];
  const mainAgentFailureDiagnostics = [];
  const sanitizeDiagnosticText = compileFunction("sanitizeDiagnosticText", {});
  const captureServerOutput = compileFunction("captureServerOutput", {
    serverLogTail,
    mainAgentFailureDiagnostics,
    sanitizeDiagnosticText,
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

function createFakeSpawn() {
  const fakeSpawn = () => {
    assert.ok(fakeSpawn.nextChild, "A controlled child must be supplied before runCommand");
    const child = fakeSpawn.nextChild;
    fakeSpawn.nextChild = undefined;
    return child;
  };
  return fakeSpawn;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
  }

  kill() {}
}

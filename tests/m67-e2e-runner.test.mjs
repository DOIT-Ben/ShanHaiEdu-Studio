import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const runnerSource = readFileSync(path.join(root, "scripts", "run-m67-e2e.mjs"), "utf8");

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
  const cleanup = compileFunction("cleanup", {
    cleanupPromise: undefined,
    nextServer,
    ownedChildren,
    stopProcessTree(child) {
      stopped.push(child);
      return new Promise((resolve) => pendingStops.push(resolve));
    },
    fs: {
      rmSync(...args) {
        removals.push(args);
      },
    },
    tempRoot: "controlled-temp-root",
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

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RUNNER_SHUTDOWN_ACK_TYPE,
  RUNNER_SHUTDOWN_REQUEST_TYPE,
  createRunnerShutdownAuthority,
  installRunnerShutdownIpcHandler,
} from "../scripts/lib/runner-shutdown-authority.mjs";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "runner-shutdown");

test("shutdown calls share one promise and post-stop waits for confirmed exit", async () => {
  const order = [];
  const child = new FakeChild(101);
  child.onKill = (signal) => {
    order.push(`kill:${signal}`);
    setTimeout(() => {
      order.push("exit");
      child.markExit(null, signal);
    }, 15);
  };
  const authority = createRunnerShutdownAuthority({
    postStop() {
      order.push("post-stop");
      assert.equal(child.exited, true);
    },
    gracefulStopTimeoutMs: 50,
    forceStopTimeoutMs: 50,
  }, { platform: "linux" });
  authority.track(child, { label: "owned-child" });

  const first = authority.shutdown({ reason: "failure" });
  const concurrent = authority.shutdown({ reason: "signal", signal: "SIGTERM" });

  assert.equal(concurrent, first);
  await first;
  assert.deepEqual(order, ["kill:SIGTERM", "exit", "post-stop"]);
});

test("IPC shutdown acknowledgement still waits for the owned child to exit", async () => {
  const calls = [];
  const child = new FakeChild(102, { connected: true });
  child.onSend = (message, callback) => {
    calls.push(message);
    callback?.(null);
    queueMicrotask(() => child.emit("message", {
      type: RUNNER_SHUTDOWN_ACK_TYPE,
      requestId: message.requestId,
      ok: true,
    }));
    setTimeout(() => child.markExit(0, null), 15);
  };
  const authority = createRunnerShutdownAuthority({
    postStop() {
      assert.equal(child.exited, true);
    },
    ipcGraceTimeoutMs: 60,
  }, {
    platform: "win32",
    spawnProcess() {
      throw new Error("force stop must not run after graceful IPC exit");
    },
  });
  authority.track(child, { label: "m67", gracefulIpc: true });

  const report = await authority.shutdown({ reason: "timeout" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, RUNNER_SHUTDOWN_REQUEST_TYPE);
  assert.equal(report.stopResults[0].method, "ipc");
  assert.equal(report.stopResults[0].ipcAcknowledged, true);
});

test("an IPC child that exits before acknowledgement is still confirmed without force-killing a reused PID", async () => {
  const child = new FakeChild(103, { connected: true });
  child.onSend = () => queueMicrotask(() => child.markExit(1, null));
  const authority = createRunnerShutdownAuthority({ ipcGraceTimeoutMs: 50 }, {
    platform: "win32",
    spawnProcess() {
      throw new Error("force stop must not run after the child exit was observed");
    },
  });
  authority.track(child, { label: "m67-early-exit", gracefulIpc: true });

  const report = await authority.shutdown({ reason: "command-failed" });

  assert.equal(report.stopResults[0].method, "ipc-exit");
  assert.equal(report.stopResults[0].ipcAcknowledged, false);
});

for (const mode of ["nonzero", "error", "hang"]) {
  test(`Windows taskkill ${mode} uses the bounded PowerShell fallback`, async () => {
    const target = new FakeChild(201);
    const calls = [];
    const spawnProcess = (command, args) => {
      calls.push({ command, args });
      const control = new FakeChild(900 + calls.length);
      if (calls.length === 1) {
        if (mode === "nonzero") queueMicrotask(() => control.markExit(7, null));
        if (mode === "error") queueMicrotask(() => control.emit("error", new Error("taskkill unavailable")));
        if (mode === "hang") control.onKill = (signal) => control.markExit(null, signal);
      } else {
        queueMicrotask(() => {
          target.markExit(null, "SIGKILL");
          control.markExit(0, null);
        });
      }
      return control;
    };
    let postStopCalls = 0;
    const authority = createRunnerShutdownAuthority({
      postStop() {
        postStopCalls += 1;
        assert.equal(target.exited, true);
      },
      controlCommandTimeoutMs: 15,
      forceStopTimeoutMs: 50,
    }, { platform: "win32", spawnProcess });
    authority.track(target, { label: "windows-tree" });

    const report = await authority.shutdown({ reason: "timeout" });

    assert.equal(calls[0].command.toLowerCase(), "taskkill.exe");
    assert.equal(calls[1].command.toLowerCase(), "powershell.exe");
    assert.equal(report.stopResults[0].method, "powershell-cim");
    assert.equal(postStopCalls, 1);
  });
}

test("stop failure still runs post-stop exactly once and returns one AggregateError", async () => {
  const target = new FakeChild(301);
  let controlCount = 0;
  let postStopCalls = 0;
  const authority = createRunnerShutdownAuthority({
    postStop() {
      postStopCalls += 1;
      throw new Error("post_stop_digest_mismatch");
    },
    controlCommandTimeoutMs: 20,
    forceStopTimeoutMs: 20,
  }, {
    platform: "win32",
    spawnProcess() {
      controlCount += 1;
      const control = new FakeChild(950 + controlCount);
      queueMicrotask(() => control.markExit(9, null));
      return control;
    },
  });
  authority.track(target, { label: "unstoppable-tree" });

  await assert.rejects(
    authority.shutdown({ reason: "timeout" }),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors.length, 2);
      assert.match(error.errors[0].message, /runner_process_tree_stop_unconfirmed/);
      assert.match(error.errors[1].message, /post_stop_digest_mismatch/);
      return true;
    },
  );
  assert.equal(postStopCalls, 1);
});

test("runCommand timeout does not reject until shutdown and post-stop finish", async () => {
  const order = [];
  const command = new FakeChild(401);
  const authority = createRunnerShutdownAuthority({
    postStop() {
      order.push("post-stop");
      assert.equal(command.exited, true);
    },
    controlCommandTimeoutMs: 20,
    forceStopTimeoutMs: 40,
  }, {
    platform: "win32",
    spawnProcess(executable) {
      if (executable === "fixture-command") return command;
      const taskkill = new FakeChild(999);
      queueMicrotask(() => {
        command.markExit(null, "SIGKILL");
        order.push("exit");
        taskkill.markExit(0, null);
      });
      return taskkill;
    },
  });

  await assert.rejects(
    authority.runCommand("fixture-command", [], { timeoutMs: 5 }),
    /runner_command_timeout:fixture-command/,
  );
  assert.deepEqual(order, ["exit", "post-stop"]);
});

test("M67 IPC helper acknowledges the shared shutdown result and disconnects", async () => {
  const processObject = new FakeProcess();
  const shutdownCalls = [];
  const detach = installRunnerShutdownIpcHandler({
    shutdown(request) {
      shutdownCalls.push(request);
      return Promise.resolve({ reason: request.reason });
    },
  }, { processObject });

  processObject.emit("message", {
    type: RUNNER_SHUTDOWN_REQUEST_TYPE,
    requestId: "request-1",
    reason: "timeout",
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(shutdownCalls.length, 1);
  assert.equal(processObject.sent[0].type, RUNNER_SHUTDOWN_ACK_TYPE);
  assert.equal(processObject.sent[0].requestId, "request-1");
  assert.equal(processObject.sent[0].ok, true);
  assert.equal(processObject.disconnected, true);
  detach();
});

test("real Windows taskkill stops a local Node parent and grandchild before post-stop", {
  skip: process.platform !== "win32",
  timeout: 20_000,
}, async (t) => {
  await runWindowsTreeCase(t, {});
});

test("real Windows CIM fallback stops the tree after an injected taskkill failure", {
  skip: process.platform !== "win32",
  timeout: 20_000,
}, async (t) => {
  await runWindowsTreeCase(t, {
    taskkillCommand: process.execPath,
    taskkillArgs: () => ["-e", "process.exit(7)"],
  });
});

async function runWindowsTreeCase(t, dependencies) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "runner-shutdown-tree-"));
  const statePath = path.join(tempRoot, "pids.json");
  const parent = spawn(process.execPath, [path.join(fixtureRoot, "parent.mjs"), statePath], {
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  let pids = { parentPid: parent.pid, childPid: null };
  t.after(async () => {
    for (const pid of [pids.childPid, pids.parentPid].filter(Number.isInteger)) {
      if (isPidAlive(pid)) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    }
    await rm(tempRoot, { recursive: true, force: true });
  });
  await waitFor(() => existsSync(statePath), 5_000);
  pids = JSON.parse(readFileSync(statePath, "utf8"));
  await waitFor(() => isPidAlive(pids.parentPid) && isPidAlive(pids.childPid), 5_000);

  let postStopCalls = 0;
  const authority = createRunnerShutdownAuthority({
    postStop() {
      postStopCalls += 1;
      assert.equal(isPidAlive(pids.parentPid), false);
      assert.equal(isPidAlive(pids.childPid), false);
    },
    controlCommandTimeoutMs: 5_000,
    forceStopTimeoutMs: 5_000,
  }, dependencies);
  authority.track(parent, { label: "windows-fixture-tree" });

  await authority.shutdown({ reason: "timeout" });
  assert.equal(postStopCalls, 1);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture condition was not met within ${timeoutMs}ms`);
}

class FakeChild extends EventEmitter {
  constructor(pid, { connected = false } = {}) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.connected = connected;
    this.exited = false;
    this.onKill = null;
    this.onSend = null;
  }

  kill(signal = "SIGTERM") {
    this.onKill?.(signal);
    return true;
  }

  send(message, callback) {
    this.onSend?.(message, callback);
  }

  markExit(code, signal) {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }
}

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.exitCode = undefined;
    this.sent = [];
    this.disconnected = false;
  }

  send(message, callback) {
    this.sent.push(message);
    callback?.(null);
  }

  disconnect() {
    this.connected = false;
    this.disconnected = true;
  }
}

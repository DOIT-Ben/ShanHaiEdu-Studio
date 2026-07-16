import { spawn } from "node:child_process";

export const RUNNER_SHUTDOWN_REQUEST_TYPE = "runner-shutdown-request.v1";
export const RUNNER_SHUTDOWN_ACK_TYPE = "runner-shutdown-ack.v1";

export function createRunnerShutdownAuthority(options = {}, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const taskkillCommand = dependencies.taskkillCommand ?? "taskkill.exe";
  const taskkillArgs = dependencies.taskkillArgs ?? ((pid) => ["/PID", String(pid), "/T", "/F"]);
  const powershellCommand = dependencies.powershellCommand ?? "powershell.exe";
  const gracefulStopTimeoutMs = positiveTimeout(options.gracefulStopTimeoutMs, 3_000);
  const ipcGraceTimeoutMs = positiveTimeout(options.ipcGraceTimeoutMs, gracefulStopTimeoutMs);
  const controlCommandTimeoutMs = positiveTimeout(options.controlCommandTimeoutMs, 5_000);
  const forceStopTimeoutMs = positiveTimeout(options.forceStopTimeoutMs, 5_000);
  const postStop = typeof options.postStop === "function" ? options.postStop : async () => {};
  const tracked = new Map();
  let shutdownPromise;
  let requestSequence = 0;

  function track(child, metadata = {}) {
    if (shutdownPromise) throw new Error("runner_shutdown_already_started");
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0) {
      throw new Error("runner_owned_child_invalid");
    }
    tracked.set(child, {
      gracefulIpc: metadata.gracefulIpc === true,
      label: String(metadata.label ?? "owned-child"),
    });
    return child;
  }

  function untrack(child) {
    if (hasExited(child) || child?.runnerSpawnFailed === true) tracked.delete(child);
  }

  function shutdown(request = {}) {
    if (!shutdownPromise) {
      const normalizedRequest = {
        reason: String(request.reason ?? "shutdown"),
        signal: typeof request.signal === "string" ? request.signal : undefined,
      };
      shutdownPromise = performShutdown(normalizedRequest);
    }
    return shutdownPromise;
  }

  async function performShutdown(request) {
    const stopResults = [];
    const errors = [];
    const entries = [...tracked.entries()];
    const settledStops = await Promise.allSettled(entries.map(async ([child, metadata]) => {
      const result = await stopTrackedChild(child, metadata, request);
      tracked.delete(child);
      return result;
    }));
    for (const result of settledStops) {
      if (result.status === "fulfilled") stopResults.push(result.value);
      else errors.push(normalizeError(result.reason, "runner_process_tree_stop_unconfirmed"));
    }

    try {
      await postStop({ request, stopResults });
    } catch (error) {
      errors.push(normalizeError(error, "runner_post_stop_failed"));
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "runner_shutdown_failed");
    }
    return Object.freeze({ reason: request.reason, stopResults: Object.freeze(stopResults) });
  }

  async function stopTrackedChild(child, metadata, request) {
    if (hasExited(child)) return stopReport(child, metadata, "already-exited");
    if (metadata.gracefulIpc && child.connected === true && typeof child.send === "function") {
      const ipcResult = await requestIpcStop(child, request).catch(() => null);
      if (ipcResult && hasExited(child)) {
        return stopReport(child, metadata, "ipc", { ipcAcknowledged: ipcResult.acknowledged });
      }
      if (hasExited(child)) return stopReport(child, metadata, "ipc-exit", { ipcAcknowledged: false });
    }

    if (platform === "win32") {
      let taskkillError;
      try {
        await runControlCommand(taskkillCommand, taskkillArgs(child.pid));
        await waitForExit(child, forceStopTimeoutMs);
        return stopReport(child, metadata, "taskkill");
      } catch (error) {
        taskkillError = error;
        if (hasExited(child)) return stopReport(child, metadata, "taskkill-exit-race");
      }
      try {
        await runControlCommand(powershellCommand, powershellTreeStopArgs(child.pid));
        await waitForExit(child, forceStopTimeoutMs);
        return stopReport(child, metadata, "powershell-cim", {
          taskkillFailed: Boolean(taskkillError),
        });
      } catch {
        if (hasExited(child)) return stopReport(child, metadata, "powershell-exit-race");
        throw new Error("runner_process_tree_stop_unconfirmed");
      }
    }

    try {
      child.kill(request.signal ?? "SIGTERM");
      await waitForExit(child, gracefulStopTimeoutMs);
      return stopReport(child, metadata, "signal");
    } catch {
      try {
        child.kill("SIGKILL");
        await waitForExit(child, forceStopTimeoutMs);
        return stopReport(child, metadata, "sigkill");
      } catch {
        throw new Error("runner_process_tree_stop_unconfirmed");
      }
    }
  }

  function requestIpcStop(child, request) {
    requestSequence += 1;
    const requestId = `${child.pid}-${requestSequence}`;
    return new Promise((resolve, reject) => {
      let acknowledged = false;
      let settled = false;
      const timer = setTimeout(() => finish(new Error("runner_ipc_shutdown_timeout")), ipcGraceTimeoutMs);
      const onMessage = (message) => {
        if (message?.type !== RUNNER_SHUTDOWN_ACK_TYPE || message.requestId !== requestId) return;
        if (message.ok !== true) return finish(new Error("runner_ipc_shutdown_rejected"));
        acknowledged = true;
        if (hasExited(child)) finish(null);
      };
      const onExit = () => finish(acknowledged ? null : new Error("runner_ipc_shutdown_unacknowledged"));
      const onError = () => finish(new Error("runner_ipc_shutdown_error"));
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off?.("message", onMessage);
        child.off?.("exit", onExit);
        child.off?.("error", onError);
        if (error) reject(error);
        else resolve({ acknowledged });
      };
      child.on?.("message", onMessage);
      child.once?.("exit", onExit);
      child.once?.("error", onError);
      try {
        child.send({
          type: RUNNER_SHUTDOWN_REQUEST_TYPE,
          requestId,
          reason: request.reason,
          signal: request.signal,
        }, (error) => {
          if (error) finish(new Error("runner_ipc_shutdown_send_failed"));
        });
      } catch {
        finish(new Error("runner_ipc_shutdown_send_failed"));
      }
    });
  }

  async function runControlCommand(command, args) {
    const control = spawnProcess(command, args, {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    await waitForControlExit(control, controlCommandTimeoutMs);
  }

  function runCommand(command, args, commandOptions = {}) {
    const {
      timeoutMs = 60_000,
      label = command,
      gracefulIpc = false,
      ...spawnOptions
    } = commandOptions;
    const child = spawnProcess(command, args, {
      shell: false,
      windowsHide: true,
      ...spawnOptions,
    });
    track(child, { label, gracefulIpc });
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const timeoutError = new Error(`runner_command_timeout:${command}`);
        shutdown({ reason: "timeout" }).then(
          () => reject(timeoutError),
          (shutdownError) => reject(new AggregateError([timeoutError, shutdownError], timeoutError.message)),
        );
      }, positiveTimeout(timeoutMs, 60_000));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.runnerSpawnFailed = true;
        untrack(child);
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        untrack(child);
        if (code === 0) resolve({ code, signal, child });
        else reject(new Error(`runner_command_failed:${command}:${code ?? signal ?? "unknown"}`));
      });
    });
  }

  return Object.freeze({ runCommand, shutdown, track, untrack });
}

export function installRunnerShutdownIpcHandler(authority, dependencies = {}) {
  const processObject = dependencies.processObject ?? process;
  const onMessage = (message) => {
    if (message?.type !== RUNNER_SHUTDOWN_REQUEST_TYPE || typeof message.requestId !== "string") return;
    Promise.resolve(authority.shutdown({
      reason: String(message.reason ?? "supervisor"),
      signal: typeof message.signal === "string" ? message.signal : undefined,
    })).then(
      () => sendAck(true),
      () => sendAck(false),
    );

    function sendAck(ok) {
      const ack = {
        type: RUNNER_SHUTDOWN_ACK_TYPE,
        requestId: message.requestId,
        ok,
      };
      if (typeof processObject.send !== "function" || processObject.connected !== true) return;
      processObject.send(ack, () => {
        if (typeof processObject.disconnect === "function" && processObject.connected === true) {
          processObject.disconnect();
        }
      });
    }
  };
  processObject.on("message", onMessage);
  return () => processObject.off("message", onMessage);
}

function waitForControlExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off?.("exit", onExit);
      child.off?.("error", onError);
      try {
        child.kill?.("SIGKILL");
      } catch {}
      reject(new Error("runner_control_command_timeout"));
    }, timeoutMs);
    const onExit = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("error", onError);
      if (code === 0) resolve();
      else reject(new Error("runner_control_command_failed"));
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      reject(new Error("runner_control_command_error"));
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("runner_process_exit_timeout")), timeoutMs);
    const onExit = () => finish(null);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    child.once("exit", onExit);
  });
}

function hasExited(child) {
  return child?.exited === true || child?.exitCode !== null || child?.signalCode !== null;
}

function stopReport(child, metadata, method, extra = {}) {
  return Object.freeze({
    pid: child.pid,
    label: metadata.label,
    method,
    ...extra,
  });
}

function powershellTreeStopArgs(pid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$rootPid = [int]${pid}`,
    "$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)",
    "function Stop-Tree([int]$currentPid) {",
    "  foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $currentPid })) { Stop-Tree ([int]$child.ProcessId) }",
    "  Stop-Process -Id $currentPid -Force -ErrorAction SilentlyContinue",
    "}",
    "Stop-Tree $rootPid",
  ].join("; ");
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script];
}

function positiveTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeError(error, fallbackMessage) {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

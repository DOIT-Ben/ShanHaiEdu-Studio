import type { ChildProcess, SpawnOptions } from "node:child_process";

export const RUNNER_SHUTDOWN_REQUEST_TYPE: "runner-shutdown-request.v1";
export const RUNNER_SHUTDOWN_ACK_TYPE: "runner-shutdown-ack.v1";

export type RunnerShutdownRequest = Readonly<{
  reason: string;
  signal?: string;
}>;

export type RunnerShutdownReport = Readonly<{
  reason: string;
  stopResults: readonly Readonly<{
    pid: number;
    label: string;
    method: string;
    ipcAcknowledged?: boolean;
    taskkillFailed?: boolean;
  }>[];
}>;

export function createRunnerShutdownAuthority(
  options?: Readonly<{
    postStop?: (input: Readonly<{ request: RunnerShutdownRequest; stopResults: readonly unknown[] }>) => void | Promise<void>;
    gracefulStopTimeoutMs?: number;
    ipcGraceTimeoutMs?: number;
    controlCommandTimeoutMs?: number;
    forceStopTimeoutMs?: number;
  }>,
  dependencies?: Readonly<{
    platform?: NodeJS.Platform;
    spawnProcess?: typeof import("node:child_process").spawn;
    taskkillCommand?: string;
    taskkillArgs?: (pid: number) => string[];
    powershellCommand?: string;
  }>,
): Readonly<{
  track(child: ChildProcess, metadata?: Readonly<{ label?: string; gracefulIpc?: boolean }>): ChildProcess;
  untrack(child: ChildProcess): void;
  shutdown(request?: Partial<RunnerShutdownRequest>): Promise<RunnerShutdownReport>;
  runCommand(command: string, args: string[], options?: SpawnOptions & Readonly<{
    timeoutMs?: number;
    label?: string;
    gracefulIpc?: boolean;
  }>): Promise<Readonly<{ code: number; signal: NodeJS.Signals | null; child: ChildProcess }>>;
}>;

export function installRunnerShutdownIpcHandler(
  authority: Readonly<{ shutdown(request?: Partial<RunnerShutdownRequest>): Promise<unknown> }>,
  dependencies?: Readonly<{ processObject?: NodeJS.Process }>,
): () => void;

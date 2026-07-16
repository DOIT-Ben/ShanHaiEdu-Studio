export type V1_9InstalledTreeProbeResult = {
  ok: boolean;
  allowedOptionalExtraneousCount: number;
};

export type V1_9NpmListInvocation = {
  command: string;
  args: string[];
  options: {
    cwd: string;
    encoding: "utf8";
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
    env: Record<string, string | undefined>;
  };
};

export function evaluateV1_9InstalledTreeProbe(input: {
  cwd: string;
  commandStatus: number | null;
  commandError?: unknown;
  stdout: string;
  packageLock: unknown;
  fileSystem?: typeof import("node:fs");
  platform?: NodeJS.Platform;
}): V1_9InstalledTreeProbeResult;

export function createV1_9NpmListInvocation(input: {
  cwd: string;
  env: Record<string, string | undefined>;
  execPath?: string;
  npmCliPath?: string;
}): V1_9NpmListInvocation | null;

export function probeV1_9InstalledTree(input: {
  cwd: string;
  env: Record<string, string | undefined>;
}): V1_9InstalledTreeProbeResult;

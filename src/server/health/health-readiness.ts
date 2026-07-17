import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import {
  checkSqliteSchemaReadiness,
  type SqliteSchemaReadinessReason,
} from "./sqlite-schema-readiness.mjs";

type HealthEnv = {
  DATABASE_URL?: string;
  ARTIFACT_STORAGE_ROOT?: string;
};

export type HealthReadinessResult = {
  status: "ok" | "degraded";
  checks: {
    database: "ok" | "unavailable";
    artifactStorage: "ok" | "unavailable";
  };
  reasons: HealthReadinessReason[];
};

export type HealthReadinessReason =
  | SqliteSchemaReadinessReason
  | Readonly<{ code: "database_configuration_invalid" | "artifact_storage_unavailable" }>;

export function checkHealthReadiness(
  options: { env?: HealthEnv; cwd?: string } = {},
): HealthReadinessResult {
  const env = options.env ?? process.env;
  const databaseResult = databaseReadiness(env.DATABASE_URL, options.cwd ?? process.cwd());
  const database = databaseResult.ready ? "ok" : "unavailable";
  const storageReady = artifactStorageReady(env.ARTIFACT_STORAGE_ROOT);
  const artifactStorage = storageReady ? "ok" : "unavailable";
  return {
    status: database === "ok" && artifactStorage === "ok" ? "ok" : "degraded",
    checks: { database, artifactStorage },
    reasons: [
      ...databaseResult.reasons,
      ...(storageReady ? [] : [{ code: "artifact_storage_unavailable" as const }]),
    ],
  };
}

function databaseReadiness(databaseUrl: string | undefined, cwd: string): Readonly<{
  ready: boolean;
  reasons: readonly HealthReadinessReason[];
}> {
  try {
    const databasePath = resolveSqlitePath(databaseUrl, cwd);
    return checkSqliteSchemaReadiness(databasePath);
  } catch {
    return { ready: false, reasons: [{ code: "database_configuration_invalid" }] };
  }
}

function artifactStorageReady(storageRoot: string | undefined) {
  let descriptor: number | undefined;
  let probePath: string | undefined;
  try {
    const configured = storageRoot?.trim();
    if (!configured || !path.isAbsolute(configured)) return false;
    const stat = lstatSync(configured);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const root = realpathSync(configured);
    probePath = path.join(root, `.health-${randomUUID()}`);
    descriptor = openSync(probePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeSync(descriptor, "ok");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    unlinkSync(probePath);
    probePath = undefined;
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* best-effort probe cleanup */ }
    }
    if (probePath) {
      try { unlinkSync(probePath); } catch { /* best-effort probe cleanup */ }
    }
  }
}

function resolveSqlitePath(value: string | undefined, cwd: string) {
  const databaseUrl = value?.trim() ?? "";
  if (!databaseUrl.startsWith("file:") || /[?#%\0]/.test(databaseUrl)) throw new Error("invalid_database_url");
  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath || rawPath.toLowerCase() === ":memory:") throw new Error("invalid_database_path");
  return path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath);
}

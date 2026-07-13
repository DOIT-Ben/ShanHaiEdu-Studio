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

import Database from "better-sqlite3";

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
};

export function checkHealthReadiness(
  options: { env?: HealthEnv; cwd?: string } = {},
): HealthReadinessResult {
  const env = options.env ?? process.env;
  const database = databaseReady(env.DATABASE_URL, options.cwd ?? process.cwd()) ? "ok" : "unavailable";
  const artifactStorage = artifactStorageReady(env.ARTIFACT_STORAGE_ROOT) ? "ok" : "unavailable";
  return {
    status: database === "ok" && artifactStorage === "ok" ? "ok" : "degraded",
    checks: { database, artifactStorage },
  };
}

function databaseReady(databaseUrl: string | undefined, cwd: string) {
  let database: Database.Database | undefined;
  try {
    const databasePath = resolveSqlitePath(databaseUrl, cwd);
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const row = database.prepare(
      "SELECT COUNT(*) AS tableCount FROM sqlite_master WHERE type = 'table' AND name IN ('Project', 'LocalUser', 'Artifact')",
    ).get() as { tableCount?: number } | undefined;
    return row?.tableCount === 3;
  } catch {
    return false;
  } finally {
    database?.close();
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

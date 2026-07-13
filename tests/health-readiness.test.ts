import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkHealthReadiness } from "@/server/health/health-readiness";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("V1-10A health readiness", () => {
  it("reports database and artifact storage readiness without returning paths", () => {
    const fixture = makeFixture();
    const result = checkHealthReadiness({
      env: { DATABASE_URL: `file:${fixture.databasePath}`, ARTIFACT_STORAGE_ROOT: fixture.artifactRoot },
    });

    expect(result).toEqual({
      status: "ok",
      checks: { database: "ok", artifactStorage: "ok" },
    });
    expect(JSON.stringify(result)).not.toContain(fixture.root);
  });

  it("fails closed with a stable response when either dependency is unavailable", () => {
    const fixture = makeFixture();
    const missingDatabase = checkHealthReadiness({
      env: { DATABASE_URL: `file:${path.join(fixture.root, "missing.db")}`, ARTIFACT_STORAGE_ROOT: fixture.artifactRoot },
    });
    expect(missingDatabase).toMatchObject({ status: "degraded", checks: { database: "unavailable" } });

    const missingStorage = checkHealthReadiness({
      env: { DATABASE_URL: `file:${fixture.databasePath}`, ARTIFACT_STORAGE_ROOT: path.join(fixture.root, "missing-artifacts") },
    });
    expect(missingStorage).toMatchObject({ status: "degraded", checks: { artifactStorage: "unavailable" } });
    expect(JSON.stringify([missingDatabase, missingStorage])).not.toContain(fixture.root);
  });

  it("does not report an uninitialized SQLite file as ready", () => {
    const fixture = makeFixture();
    const emptyDatabasePath = path.join(fixture.root, "empty.db");
    new Database(emptyDatabasePath).close();
    const result = checkHealthReadiness({
      env: { DATABASE_URL: `file:${emptyDatabasePath}`, ARTIFACT_STORAGE_ROOT: fixture.artifactRoot },
    });
    expect(result).toMatchObject({ status: "degraded", checks: { database: "unavailable" } });
  });
});

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-health-"));
  roots.push(root);
  const databasePath = path.join(root, "production.db");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(artifactRoot);
  const db = new Database(databasePath);
  db.exec("CREATE TABLE Project (id TEXT PRIMARY KEY); CREATE TABLE LocalUser (id TEXT PRIMARY KEY); CREATE TABLE Artifact (id TEXT PRIMARY KEY)");
  db.close();
  return { root, databasePath, artifactRoot };
}

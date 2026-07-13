import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalArtifactRoot = process.env.ARTIFACT_STORAGE_ROOT;

afterEach(() => {
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("ARTIFACT_STORAGE_ROOT", originalArtifactRoot);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("V1-10A health route", () => {
  it("returns 200 for ready dependencies and 503 without internal details when degraded", async () => {
    const fixture = makeFixture();
    process.env.DATABASE_URL = `file:${fixture.databasePath}`;
    process.env.ARTIFACT_STORAGE_ROOT = fixture.artifactRoot;
    const { GET } = await import("@/app/api/health/route");

    const ready = await GET();
    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(await ready.json()).toEqual({ status: "ok", checks: { database: "ok", artifactStorage: "ok" } });

    process.env.DATABASE_URL = `file:${path.join(fixture.root, "missing.db")}`;
    const degraded = await GET();
    const body = await degraded.json();
    expect(degraded.status).toBe(503);
    expect(body).toMatchObject({ status: "degraded", checks: { database: "unavailable" } });
    expect(JSON.stringify(body)).not.toContain(fixture.root);
  });
});

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-health-route-"));
  roots.push(root);
  const databasePath = path.join(root, "production.db");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(artifactRoot);
  const db = new Database(databasePath);
  db.exec("CREATE TABLE Project (id TEXT PRIMARY KEY); CREATE TABLE LocalUser (id TEXT PRIMARY KEY); CREATE TABLE Artifact (id TEXT PRIMARY KEY)");
  db.close();
  return { root, databasePath, artifactRoot };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

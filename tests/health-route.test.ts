import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
    expect(await ready.json()).toEqual({
      status: "ok",
      checks: { database: "ok", artifactStorage: "ok" },
      reasons: [],
    });

    const database = new Database(fixture.databasePath);
    database.exec('ALTER TABLE "GenerationJob" DROP COLUMN "providerResultJson"');
    database.close();
    const degraded = await GET();
    const body = await degraded.json();
    expect(degraded.status).toBe(503);
    expect(body).toEqual({
      status: "degraded",
      checks: { database: "unavailable", artifactStorage: "ok" },
      reasons: [{ code: "database_schema_missing_column", table: "GenerationJob", column: "providerResultJson" }],
    });
    expect(JSON.stringify(body)).not.toContain(fixture.root);
  }, 15_000);
});

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-health-route-"));
  roots.push(root);
  const databasePath = path.join(root, "production.db");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(artifactRoot);
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      SHANHAI_DB_INIT_SKIP_DOTENV: "1",
    },
    encoding: "utf8",
  });
  if (initialized.status !== 0) throw new Error("isolated schema initialization failed");
  return { root, databasePath, artifactRoot };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

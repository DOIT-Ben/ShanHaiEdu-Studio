import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { checkHealthReadiness } from "@/server/health/health-readiness";
import { HEALTH_SCHEMA_REQUIREMENTS } from "@/server/health/sqlite-schema-readiness.mjs";

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
      reasons: [],
    });
    expect(JSON.stringify(result)).not.toContain(fixture.root);
  });

  it("fails closed with a stable response when either dependency is unavailable", () => {
    const fixture = makeFixture();
    const missingDatabase = checkHealthReadiness({
      env: { DATABASE_URL: `file:${path.join(fixture.root, "missing.db")}`, ARTIFACT_STORAGE_ROOT: fixture.artifactRoot },
    });
    expect(missingDatabase).toMatchObject({
      status: "degraded",
      checks: { database: "unavailable" },
      reasons: [{ code: "database_unavailable" }],
    });

    const missingStorage = checkHealthReadiness({
      env: { DATABASE_URL: `file:${fixture.databasePath}`, ARTIFACT_STORAGE_ROOT: path.join(fixture.root, "missing-artifacts") },
    });
    expect(missingStorage).toMatchObject({
      status: "degraded",
      checks: { artifactStorage: "unavailable" },
      reasons: [{ code: "artifact_storage_unavailable" }],
    });
    expect(JSON.stringify([missingDatabase, missingStorage])).not.toContain(fixture.root);
  });

  it("reports stable missing-table and missing-column reasons", () => {
    const fixture = makeFixture();
    mutateDatabase(fixture.databasePath, 'DROP TABLE "ObservationRecord"');
    const missingTable = checkHealthReadiness({
      env: { DATABASE_URL: `file:${fixture.databasePath}`, ARTIFACT_STORAGE_ROOT: fixture.artifactRoot },
    });
    expect(missingTable).toEqual({
      status: "degraded",
      checks: { database: "unavailable", artifactStorage: "ok" },
      reasons: [{ code: "database_schema_missing_table", table: "ObservationRecord" }],
    });

    const columnFixture = makeFixture();
    mutateDatabase(columnFixture.databasePath, 'ALTER TABLE "ConversationMessage" DROP COLUMN "metadataJson"');
    const missingColumn = checkHealthReadiness({
      env: { DATABASE_URL: `file:${columnFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: columnFixture.artifactRoot },
    });
    expect(missingColumn).toEqual({
      status: "degraded",
      checks: { database: "unavailable", artifactStorage: "ok" },
      reasons: [{ code: "database_schema_missing_column", table: "ConversationMessage", column: "metadataJson" }],
    });
    expect(JSON.stringify([missingTable, missingColumn])).not.toContain(fixture.root);
    expect(JSON.stringify([missingTable, missingColumn])).not.toContain(columnFixture.root);
  });

  it("keeps the required control-plane schema contract explicit", () => {
    const requirements = new Map(HEALTH_SCHEMA_REQUIREMENTS.map((entry) => [entry.table, entry.columns]));
    expect(requirements.get("ConversationMessage")).toEqual(expect.arrayContaining(["partsJson", "metadataJson"]));
    expect(requirements.get("Artifact")).toEqual(expect.arrayContaining(["taskId", "taskBriefDigest", "intentEpoch"]));
    for (const table of [
      "TaskAggregate", "AgentEventRecord", "ToolInvocationRecord", "ObservationRecord", "ValidationReportRecord",
      "SemanticContextSnapshotRecord", "ConversationTurnJob", "ProjectExecutionLease", "GenerationJob",
    ]) {
      expect(requirements.has(table), table).toBe(true);
    }
    expect(requirements.get("ConversationTurnJob")).toEqual(expect.arrayContaining([
      "actorUserId", "actorAuthMode", "authSessionId", "failureCategory", "failureRetryability",
      "failureEvidenceDigest", "recoveryEvidenceDigest",
    ]));
    expect(requirements.get("GenerationJob")).toEqual(expect.arrayContaining([
      "providerTaskId", "providerAcceptedAt", "resultArtifactId", "providerResultJson", "countsAsProviderSubmission",
    ]));
  });
});

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-health-"));
  roots.push(root);
  const databasePath = path.join(root, "production.db");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(artifactRoot);
  initializeSchema(databasePath);
  return { root, databasePath, artifactRoot };
}

function initializeSchema(databasePath: string) {
  const result = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      SHANHAI_DB_INIT_SKIP_DOTENV: "1",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("isolated schema initialization failed");
}

function mutateDatabase(databasePath: string, sql: string) {
  const database = new Database(databasePath);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

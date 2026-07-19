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
  }, 15_000);

  it("does not create the retired staged artifact schema in a new database", () => {
    const fixture = makeFixture();
    const database = new Database(fixture.databasePath, { readonly: true });
    try {
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        .map((row) => (row as { name: string }).name);
      const validationColumns = database.prepare('PRAGMA table_info("ValidationReportRecord")').all()
        .map((row) => (row as { name: string }).name);

      expect(tables).not.toContain("StagedArtifactCommit");
      expect(validationColumns).not.toContain("stagedArtifactCommitId");
    } finally {
      database.close();
    }
  }, 15_000);

  it("preserves and ignores a retired staged artifact table in a legacy database", () => {
    const fixture = makeFixture();
    const legacy = new Database(fixture.databasePath);
    try {
      legacy.pragma("foreign_keys = OFF");
      legacy.exec(`
        DROP TABLE IF EXISTS "StagedArtifactCommit";
        CREATE TABLE "StagedArtifactCommit" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "legacyPayload" TEXT NOT NULL
        );
        INSERT INTO "StagedArtifactCommit" ("id", "legacyPayload")
        VALUES ('legacy-staged-1', 'preserve-me');
      `);
      const validationColumns = legacy.prepare('PRAGMA table_info("ValidationReportRecord")').all()
        .map((row) => (row as { name: string }).name);
      if (!validationColumns.includes("stagedArtifactCommitId")) {
        legacy.exec('ALTER TABLE "ValidationReportRecord" ADD COLUMN "stagedArtifactCommitId" TEXT');
      }
      legacy.exec(`
        INSERT INTO "Project" ("id", "title", "currentNodeKey", "updatedAt")
        VALUES ('legacy-project-1', 'Legacy project', 'requirement_spec', CURRENT_TIMESTAMP);
        INSERT INTO "ValidationReportRecord" (
          "id", "projectId", "capabilityId", "stage", "authority", "domain", "targetKind",
          "contractId", "contractVersion", "overallStatus", "reportDigest", "payloadJson",
          "stagedArtifactCommitId", "createdAt"
        ) VALUES (
          'legacy-report-1', 'legacy-project-1', 'requirement_spec', 'requirement_spec', 'legacy', 'lesson',
          'artifact_draft', 'legacy-contract', 'v1', 'passed', 'legacy-report-digest', '{}',
          'legacy-staged-1', CURRENT_TIMESTAMP
        );
      `);
    } finally {
      legacy.close();
    }

    initializeSchema(fixture.databasePath);

    const inspected = new Database(fixture.databasePath, { readonly: true });
    try {
      expect(inspected.prepare(
        'SELECT "id", "legacyPayload" FROM "StagedArtifactCommit" WHERE "id" = ?',
      ).get("legacy-staged-1")).toEqual({ id: "legacy-staged-1", legacyPayload: "preserve-me" });
      expect(inspected.prepare(
        'SELECT "id", "stagedArtifactCommitId" FROM "ValidationReportRecord" WHERE "id" = ?',
      ).get("legacy-report-1")).toEqual({ id: "legacy-report-1", stagedArtifactCommitId: "legacy-staged-1" });
    } finally {
      inspected.close();
    }
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${fixture.databasePath}`, ARTIFACT_STORAGE_ROOT: fixture.artifactRoot },
    })).toEqual({
      status: "ok",
      checks: { database: "ok", artifactStorage: "ok" },
      reasons: [],
    });
  }, 15_000);

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
  }, 15_000);

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
  }, 15_000);

  it("fails closed when orchestration audit indexes or append-only triggers are missing", () => {
    const indexFixture = makeFixture();
    mutateDatabase(indexFixture.databasePath, 'DROP INDEX "OrchestrationAuditEvent_eventDigest_key"');
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${indexFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: indexFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      checks: { database: "unavailable" },
      reasons: [{
        code: "database_schema_missing_index",
        table: "OrchestrationAuditEvent",
        index: "OrchestrationAuditEvent_eventDigest_key",
      }],
    });

    const triggerFixture = makeFixture();
    mutateDatabase(triggerFixture.databasePath, 'DROP TRIGGER "OrchestrationAuditEvent_reject_update"');
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${triggerFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: triggerFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      checks: { database: "unavailable" },
      reasons: [{
        code: "database_schema_missing_trigger",
        table: "OrchestrationAuditEvent",
        trigger: "OrchestrationAuditEvent_reject_update",
      }],
    });
  }, 15_000);

  it("rejects same-name orchestration audit indexes and triggers with invalid semantics", () => {
    const indexFixture = makeFixture();
    mutateDatabase(indexFixture.databasePath, `
      DROP INDEX "OrchestrationAuditEvent_eventDigest_key";
      CREATE UNIQUE INDEX "OrchestrationAuditEvent_eventDigest_key"
        ON "OrchestrationAuditEvent"("eventId");
    `);
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${indexFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: indexFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      checks: { database: "unavailable" },
      reasons: [{
        code: "database_schema_invalid_index",
        table: "OrchestrationAuditEvent",
        index: "OrchestrationAuditEvent_eventDigest_key",
      }],
    });

    const orderFixture = makeFixture();
    mutateDatabase(orderFixture.databasePath, `
      DROP INDEX "OrchestrationAuditEvent_attemptId_recordType_key";
      CREATE UNIQUE INDEX "OrchestrationAuditEvent_attemptId_recordType_key"
        ON "OrchestrationAuditEvent"("recordType", "attemptId");
    `);
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${orderFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: orderFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      reasons: [{
        code: "database_schema_invalid_index",
        table: "OrchestrationAuditEvent",
        index: "OrchestrationAuditEvent_attemptId_recordType_key",
      }],
    });

    const uniquenessFixture = makeFixture();
    mutateDatabase(uniquenessFixture.databasePath, `
      DROP INDEX "OrchestrationAuditEvent_eventDigest_key";
      CREATE INDEX "OrchestrationAuditEvent_eventDigest_key"
        ON "OrchestrationAuditEvent"("eventDigest");
    `);
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${uniquenessFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: uniquenessFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      reasons: [{
        code: "database_schema_invalid_index",
        table: "OrchestrationAuditEvent",
        index: "OrchestrationAuditEvent_eventDigest_key",
      }],
    });

    const triggerFixture = makeFixture();
    mutateDatabase(triggerFixture.databasePath, `
      DROP TRIGGER "OrchestrationAuditEvent_reject_update";
      CREATE TRIGGER "OrchestrationAuditEvent_reject_update"
      BEFORE UPDATE ON "OrchestrationAuditEvent"
      BEGIN
        SELECT 1;
      END;
    `);
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${triggerFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: triggerFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      checks: { database: "unavailable" },
      reasons: [{
        code: "database_schema_invalid_trigger",
        table: "OrchestrationAuditEvent",
        trigger: "OrchestrationAuditEvent_reject_update",
      }],
    });

    const timingFixture = makeFixture();
    mutateDatabase(timingFixture.databasePath, `
      DROP TRIGGER "OrchestrationAuditEvent_reject_delete";
      CREATE TRIGGER "OrchestrationAuditEvent_reject_delete"
      AFTER DELETE ON "OrchestrationAuditEvent"
      BEGIN
        SELECT RAISE(ABORT, 'OrchestrationAuditEvent is append-only');
      END;
    `);
    expect(checkHealthReadiness({
      env: { DATABASE_URL: `file:${timingFixture.databasePath}`, ARTIFACT_STORAGE_ROOT: timingFixture.artifactRoot },
    })).toMatchObject({
      status: "degraded",
      reasons: [{
        code: "database_schema_invalid_trigger",
        table: "OrchestrationAuditEvent",
        trigger: "OrchestrationAuditEvent_reject_delete",
      }],
    });
  }, 15_000);

  it("enforces orchestration audit value contracts and append-only storage in SQLite", () => {
    const fixture = makeFixture();
    const database = new Database(fixture.databasePath);
    try {
      const insert = database.prepare(`
        INSERT INTO "OrchestrationAuditEvent" (
          "eventId", "attemptId", "recordType", "outcome", "operationKind", "authority",
          "actorUserId", "actorAuthMode", "payloadJson", "eventDigest", "occurredAt"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      insert.run(
        "audit-event-1", "attempt-1", "attempted", null, "external_mutation", "teacher_http",
        "teacher-1", "password", "{}", "a".repeat(64),
      );

      expect(() => database.prepare(
        'UPDATE "OrchestrationAuditEvent" SET "reasonCode" = ? WHERE "eventId" = ?',
      ).run("tampered", "audit-event-1")).toThrow(/append-only/i);
      expect(() => database.prepare(
        'DELETE FROM "OrchestrationAuditEvent" WHERE "eventId" = ?',
      ).run("audit-event-1")).toThrow(/append-only/i);
      expect(() => insert.run(
        "audit-event-invalid", "attempt-2", "resolved", null, "external_mutation", "teacher_http",
        "teacher-1", "password", "{}", "b".repeat(64),
      )).toThrow();
    } finally {
      database.close();
    }
  }, 15_000);

  it("keeps the required control-plane schema contract explicit", () => {
    const requirements = new Map(HEALTH_SCHEMA_REQUIREMENTS.map((entry) => [entry.table, entry.columns]));
    expect(requirements.get("ConversationMessage")).toEqual(expect.arrayContaining(["partsJson", "metadataJson"]));
    expect(requirements.get("Artifact")).toEqual(expect.arrayContaining(["taskId", "taskBriefDigest", "intentEpoch"]));
    for (const table of [
      "TaskAggregate", "AgentEventRecord", "ToolInvocationRecord", "ObservationRecord", "ValidationReportRecord",
      "SemanticContextSnapshotRecord", "ConversationTurnJob", "ProjectExecutionLease", "GenerationJob",
      "OrchestrationAuditEvent",
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
    expect(requirements.get("OrchestrationAuditEvent")).toEqual(expect.arrayContaining([
      "sequence", "eventId", "attemptId", "recordType", "outcome", "operationKind", "authority",
      "claimedProjectId", "resolvedProjectId", "actorUserId", "actorAuthMode", "authSessionDigest",
      "taskId", "turnJobId", "teacherMessageId", "toolInvocationId", "intentEpoch", "planRevision", "planId",
      "toolOrdinal", "toolName", "actionDigest", "idempotencyKey", "observationId", "invocationStatus",
      "executionEnvelopeDigest", "requestDigest", "reasonCode", "payloadJson", "eventDigest",
      "occurredAt", "createdAt",
    ]));
    const auditRequirement = HEALTH_SCHEMA_REQUIREMENTS.find((entry) => entry.table === "OrchestrationAuditEvent");
    expect(auditRequirement?.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "OrchestrationAuditEvent_eventId_key", columns: ["eventId"], unique: true }),
      expect.objectContaining({ name: "OrchestrationAuditEvent_eventDigest_key", columns: ["eventDigest"], unique: true }),
      expect.objectContaining({
        name: "OrchestrationAuditEvent_attemptId_recordType_key",
        columns: ["attemptId", "recordType"],
        unique: true,
      }),
      expect.objectContaining({
        name: "OrchestrationAuditEvent_resolvedProjectId_taskId_intentEpoch_toolOrdinal_recordType_key",
        columns: ["resolvedProjectId", "taskId", "intentEpoch", "toolOrdinal", "recordType"],
        unique: true,
      }),
      expect.objectContaining({
        name: "OrchestrationAuditEvent_toolInvocationId_recordType_key",
        columns: ["toolInvocationId", "recordType"],
        unique: true,
      }),
    ]));
    expect(auditRequirement?.triggers).toEqual([
      { name: "OrchestrationAuditEvent_reject_update", event: "UPDATE" },
      { name: "OrchestrationAuditEvent_reject_delete", event: "DELETE" },
    ]);
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

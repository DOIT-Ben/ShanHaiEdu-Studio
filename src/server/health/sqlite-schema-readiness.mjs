import Database from "better-sqlite3";

export const HEALTH_SCHEMA_REQUIREMENTS = Object.freeze([
  requirement("Project", ["id", "intentEpoch", "generationIntensity", "intensityVersion"]),
  requirement("LocalUser", ["id"]),
  requirement("ConversationMessage", [
    "id", "projectId", "role", "content", "partsJson", "artifactRefsJson", "metadataJson", "createdAt",
  ]),
  requirement("Artifact", [
    "id", "projectId", "taskId", "taskBriefDigest", "intentEpoch", "planRevision", "origin", "kind", "status",
    "structuredContentJson", "version",
  ]),
  requirement("TaskAggregate", [
    "taskId", "projectId", "intentEpoch", "taskBriefJson", "intentGrantJson", "planId", "planRevision", "status",
    "checkpointJson", "updatedAt",
  ]),
  requirement("AgentEventRecord", [
    "eventId", "projectId", "taskId", "runId", "intentEpoch", "sequence", "kind", "visibility", "envelopeJson",
    "payloadJson", "occurredAt",
  ]),
  requirement("ToolInvocationRecord", [
    "invocationId", "projectId", "taskId", "intentEpoch", "planRevision", "toolName", "executionEnvelopeJson",
    "requestJson", "idempotencyKey", "status", "artifactId", "observationId", "startedAt", "finishedAt",
  ]),
  requirement("ObservationRecord", [
    "observationId", "projectId", "taskId", "invocationId", "intentEpoch", "status", "reasonCodesJson",
    "payloadJson", "artifactId", "createdAt",
  ]),
  requirement("ValidationReportRecord", [
    "id", "projectId", "capabilityId", "stage", "authority", "domain", "targetKind", "targetId", "targetDigest",
    "inputHash", "intentEpoch", "contractId", "contractVersion", "overallStatus", "reportDigest", "payloadJson",
    "artifactId", "generationJobId", "stagedArtifactCommitId", "createdAt",
  ]),
  requirement("SemanticContextSnapshotRecord", [
    "snapshotId", "projectId", "taskId", "intentEpoch", "planRevision", "snapshotDigest", "payloadJson",
    "lastEventSequence", "createdAt",
  ]),
  requirement("ConversationTurnJob", [
    "id", "projectId", "teacherMessageId", "assistantMessageId", "status", "attempts", "maxAttempts",
    "idempotencyKey", "actorUserId", "actorAuthMode", "authSessionId", "fencingToken", "generationIntensity",
    "intensityVersion", "lockedBy", "lockedUntil", "errorCode", "errorMessage", "failureCategory",
    "failureRetryability", "failureEvidenceDigest", "recoveryEvidenceDigest", "startedAt", "finishedAt",
  ]),
  requirement("ProjectExecutionLease", [
    "projectId", "holderId", "fencingToken", "leasedUntil", "createdAt", "updatedAt",
  ]),
  requirement("GenerationJob", [
    "id", "projectId", "kind", "sourceArtifactId", "unitId", "runInputSnapshotId", "intentEpoch", "idempotencyKey",
    "inputHash", "providerTaskId", "pollState", "providerAcceptedAt", "lastPolledAt", "status", "attempts",
    "maxAttempts", "resultArtifactId", "providerResultJson", "countsAsProviderSubmission", "errorMessage", "startedAt",
    "finishedAt",
  ]),
]);

export function checkSqliteSchemaReadiness(databasePath) {
  let database;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch {
    return { ready: false, reasons: [{ code: "database_unavailable" }] };
  }

  try {
    const tables = new Set(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
    );
    const reasons = [];
    for (const entry of HEALTH_SCHEMA_REQUIREMENTS) {
      if (!tables.has(entry.table)) {
        reasons.push({ code: "database_schema_missing_table", table: entry.table });
        continue;
      }
      const columns = new Set(
        database.prepare("SELECT name FROM pragma_table_info(?)").all(entry.table).map((row) => row.name),
      );
      for (const column of entry.columns) {
        if (!columns.has(column)) {
          reasons.push({ code: "database_schema_missing_column", table: entry.table, column });
        }
      }
    }
    return { ready: reasons.length === 0, reasons };
  } catch {
    return { ready: false, reasons: [{ code: "database_schema_unreadable" }] };
  } finally {
    database.close();
  }
}

function requirement(table, columns) {
  return Object.freeze({ table, columns: Object.freeze(columns) });
}

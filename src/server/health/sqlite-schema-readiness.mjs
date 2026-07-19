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
    "artifactId", "generationJobId", "createdAt",
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
  requirement("OrchestrationAuditEvent", [
    "sequence", "eventId", "attemptId", "recordType", "outcome", "operationKind", "authority",
    "claimedProjectId", "resolvedProjectId", "actorUserId", "actorAuthMode", "authSessionDigest",
    "taskId", "turnJobId", "teacherMessageId", "toolInvocationId", "intentEpoch", "planRevision", "planId", "toolOrdinal",
    "toolName", "actionDigest", "idempotencyKey", "observationId", "invocationStatus",
    "executionEnvelopeDigest", "requestDigest", "reasonCode", "payloadJson", "eventDigest", "occurredAt", "createdAt",
  ], {
    indexes: [
      indexRequirement("OrchestrationAuditEvent_eventId_key", ["eventId"], true),
      indexRequirement("OrchestrationAuditEvent_eventDigest_key", ["eventDigest"], true),
      indexRequirement("OrchestrationAuditEvent_attemptId_recordType_key", ["attemptId", "recordType"], true),
      indexRequirement(
        "OrchestrationAuditEvent_resolvedProjectId_taskId_intentEpoch_toolOrdinal_recordType_key",
        ["resolvedProjectId", "taskId", "intentEpoch", "toolOrdinal", "recordType"],
        true,
      ),
      indexRequirement("OrchestrationAuditEvent_toolInvocationId_recordType_key", ["toolInvocationId", "recordType"], true),
      indexRequirement("OrchestrationAuditEvent_claimedProjectId_sequence_idx", ["claimedProjectId", "sequence"]),
      indexRequirement("OrchestrationAuditEvent_resolvedProjectId_sequence_idx", ["resolvedProjectId", "sequence"]),
      indexRequirement("OrchestrationAuditEvent_taskId_intentEpoch_sequence_idx", ["taskId", "intentEpoch", "sequence"]),
      indexRequirement("OrchestrationAuditEvent_turnJobId_sequence_idx", ["turnJobId", "sequence"]),
      indexRequirement("OrchestrationAuditEvent_toolInvocationId_sequence_idx", ["toolInvocationId", "sequence"]),
      indexRequirement("OrchestrationAuditEvent_observationId_sequence_idx", ["observationId", "sequence"]),
      indexRequirement("OrchestrationAuditEvent_idempotencyKey_sequence_idx", ["idempotencyKey", "sequence"]),
      indexRequirement(
        "OrchestrationAuditEvent_authority_operationKind_sequence_idx",
        ["authority", "operationKind", "sequence"],
      ),
    ],
    triggers: [
      triggerRequirement("OrchestrationAuditEvent_reject_update", "UPDATE"),
      triggerRequirement("OrchestrationAuditEvent_reject_delete", "DELETE"),
    ],
  }),
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
      const indexes = new Map(
        database.prepare("SELECT name, \"unique\" FROM pragma_index_list(?)").all(entry.table)
          .map((row) => [row.name, row]),
      );
      for (const index of entry.indexes) {
        const actual = indexes.get(index.name);
        if (!actual) {
          reasons.push({ code: "database_schema_missing_index", table: entry.table, index: index.name });
          continue;
        }
        const columns = database.prepare(
          "SELECT name FROM pragma_index_info(?) ORDER BY seqno ASC",
        ).all(index.name).map((row) => row.name);
        if (Boolean(actual.unique) !== index.unique || !sameTextArray(columns, index.columns)) {
          reasons.push({ code: "database_schema_invalid_index", table: entry.table, index: index.name });
        }
      }
      const triggers = new Map(
        database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").all(entry.table)
          .map((row) => [row.name, row]),
      );
      for (const trigger of entry.triggers) {
        const actual = triggers.get(trigger.name);
        if (!actual) {
          reasons.push({ code: "database_schema_missing_trigger", table: entry.table, trigger: trigger.name });
        } else if (!hasAppendOnlyTriggerSemantics(actual.sql, entry.table, trigger.event)) {
          reasons.push({ code: "database_schema_invalid_trigger", table: entry.table, trigger: trigger.name });
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

function requirement(table, columns, options = {}) {
  return Object.freeze({
    table,
    columns: Object.freeze(columns),
    indexes: Object.freeze(options.indexes ?? []),
    triggers: Object.freeze(options.triggers ?? []),
  });
}

function indexRequirement(name, columns, unique = false) {
  return Object.freeze({ name, columns: Object.freeze(columns), unique });
}

function triggerRequirement(name, event) {
  return Object.freeze({ name, event });
}

function sameTextArray(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasAppendOnlyTriggerSemantics(sql, table, event) {
  if (typeof sql !== "string") return false;
  const source = sql.replace(/--[^\r\n]*/gu, " ").replace(/\/\*[\s\S]*?\*\//gu, " ");
  const begin = /\bBEGIN\b/iu.exec(source);
  if (!begin) return false;
  const headerSource = source.slice(0, begin.index);
  const bodySource = source.slice(begin.index + begin[0].length);
  const identifier = sqliteIdentifierPattern(table);
  const header = new RegExp(`\\bBEFORE\\s+${event}\\s+ON\\s+${identifier}(?:\\s|$)`, "iu");
  const abort = /\bRAISE\s*\(\s*ABORT\s*,\s*'(?:''|[^'])*append-only(?:''|[^'])*'\s*\)/iu;
  return header.test(headerSource) && abort.test(bodySource);
}

function sqliteIdentifierPattern(value) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return `(?:"${escaped}"|\\[${escaped}\\]|\`${escaped}\`|${escaped})`;
}

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSqliteFileUrl } from "./lib/sqlite-url.mjs";

if (process.env.SHANHAI_DB_INIT_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const dbPath = resolveSqliteFileUrl(databaseUrl, { baseDir: root });

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 15000");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS "LocalUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "displayName" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'teacher',
  "authMode" TEXT NOT NULL DEFAULT 'local',
  "email" TEXT,
  "passwordHash" TEXT,
  "disabledAt" DATETIME,
  "disabledReason" TEXT,
  "lastLoginAt" DATETIME,
  "passwordResetAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "currentNodeKey" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "grade" TEXT,
  "subject" TEXT,
  "textbookVersion" TEXT,
  "lessonTopic" TEXT,
  "archivedAt" DATETIME,
  "deletedAt" DATETIME,
  "lifecycleVersion" INTEGER NOT NULL DEFAULT 0,
  "intentEpoch" INTEGER NOT NULL DEFAULT 0,
  "generationIntensity" TEXT NOT NULL DEFAULT 'standard',
  "intensityVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Project_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "LocalUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ConversationMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "partsJson" TEXT NOT NULL DEFAULT '[]',
  "artifactRefsJson" TEXT NOT NULL DEFAULT '[]',
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TaskAggregate" (
  "taskId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "intentEpoch" INTEGER NOT NULL,
  "taskBriefJson" TEXT NOT NULL,
  "intentGrantJson" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "planRevision" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "checkpointJson" TEXT NOT NULL DEFAULT 'null',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskAggregate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AgentEventRecord" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "intentEpoch" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "envelopeJson" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEventRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ToolInvocationRecord" (
  "invocationId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "intentEpoch" INTEGER NOT NULL,
  "planRevision" INTEGER NOT NULL,
  "toolName" TEXT NOT NULL,
  "executionEnvelopeJson" TEXT NOT NULL,
  "requestJson" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "artifactId" TEXT,
  "observationId" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  CONSTRAINT "ToolInvocationRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ObservationRecord" (
  "observationId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "invocationId" TEXT,
  "intentEpoch" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "reasonCodesJson" TEXT NOT NULL DEFAULT '[]',
  "payloadJson" TEXT NOT NULL,
  "artifactId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservationRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ObservationRecord_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "ToolInvocationRecord" ("invocationId") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "SemanticContextSnapshotRecord" (
  "snapshotId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "intentEpoch" INTEGER NOT NULL,
  "planRevision" INTEGER NOT NULL,
  "snapshotDigest" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "lastEventSequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SemanticContextSnapshotRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Artifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT,
  "taskBriefDigest" TEXT,
  "intentEpoch" INTEGER,
  "planRevision" INTEGER,
  "origin" TEXT NOT NULL DEFAULT 'legacy',
  "nodeKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "markdownContent" TEXT NOT NULL,
  "structuredContentJson" TEXT NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL,
  "isApproved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "GenerationJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sourceArtifactId" TEXT NOT NULL,
  "unitId" TEXT,
  "runInputSnapshotId" TEXT,
  "intentEpoch" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT,
  "inputHash" TEXT,
  "providerTaskId" TEXT,
  "pollState" TEXT NOT NULL DEFAULT 'not_started',
  "providerAcceptedAt" DATETIME,
  "lastPolledAt" DATETIME,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "resultArtifactId" TEXT,
  "providerResultJson" TEXT,
  "countsAsProviderSubmission" BOOLEAN NOT NULL DEFAULT true,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GenerationJob_runInputSnapshotId_fkey" FOREIGN KEY ("runInputSnapshotId") REFERENCES "RunInputSnapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "VideoShot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sourceArtifactId" TEXT NOT NULL,
  "shotId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "inputHash" TEXT NOT NULL,
  "providerTaskId" TEXT,
  "selectedArtifactId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "qaJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "VideoShot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "RunInputSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "intentEpoch" INTEGER NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "sourceArtifactIdsJson" TEXT NOT NULL DEFAULT '[]',
  "payloadJson" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunInputSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StagedArtifactCommit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "generationJobId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'awaiting_result',
  "nodeKey" TEXT,
  "kind" TEXT,
  "title" TEXT,
  "artifactStatus" TEXT,
  "summary" TEXT,
  "markdownContent" TEXT,
  "structuredContentJson" TEXT NOT NULL DEFAULT '{}',
  "storageRefsJson" TEXT NOT NULL DEFAULT '[]',
  "intentEpoch" INTEGER NOT NULL,
  "inputHash" TEXT NOT NULL,
  "holderId" TEXT,
  "fencingToken" INTEGER,
  "actorUserId" TEXT,
  "actorAuthMode" TEXT,
  "authSessionId" TEXT,
  "resultArtifactId" TEXT,
  "quarantineReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "committedAt" DATETIME,
  CONSTRAINT "StagedArtifactCommit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StagedArtifactCommit_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StagedArtifactCommit_resultArtifactId_fkey" FOREIGN KEY ("resultArtifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ValidationReportRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetId" TEXT,
  "targetVersion" INTEGER,
  "targetDigest" TEXT,
  "inputHash" TEXT,
  "intentEpoch" INTEGER,
  "contractId" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "overallStatus" TEXT NOT NULL,
  "reportDigest" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "artifactId" TEXT,
  "generationJobId" TEXT,
  "stagedArtifactCommitId" TEXT,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "ValidationReportRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ValidationReportRecord_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ValidationReportRecord_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ValidationReportRecord_stagedArtifactCommitId_fkey" FOREIGN KEY ("stagedArtifactCommitId") REFERENCES "StagedArtifactCommit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CriticReportRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "reportDigest" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "targetVersion" INTEGER NOT NULL,
  "targetDigest" TEXT NOT NULL,
  "productionPath" TEXT NOT NULL,
  "inputHash" TEXT,
  "rubricId" TEXT NOT NULL,
  "rubricVersion" TEXT NOT NULL,
  "rubricDigest" TEXT NOT NULL,
  "validationRefsJson" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "CriticReportRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CriticReportRecord_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "QualityDecisionRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "criticReportId" TEXT,
  "decisionDigest" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "targetVersion" INTEGER NOT NULL,
  "targetDigest" TEXT NOT NULL,
  "productionPath" TEXT NOT NULL,
  "inputHash" TEXT,
  "outcome" TEXT NOT NULL,
  "weightedScore" REAL,
  "reasonCodesJson" TEXT NOT NULL,
  "nextAction" TEXT NOT NULL,
  "repairTargetsJson" TEXT NOT NULL,
  "deliveryEligibility" TEXT NOT NULL,
  "validationDigestsJson" TEXT NOT NULL,
  "rubricDigest" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "QualityDecisionRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QualityDecisionRecord_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QualityDecisionRecord_criticReportId_fkey" FOREIGN KEY ("criticReportId") REFERENCES "CriticReportRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ConversationTurnJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "teacherMessageId" TEXT NOT NULL,
  "assistantMessageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "idempotencyKey" TEXT,
  "actorUserId" TEXT,
  "actorAuthMode" TEXT,
  "authSessionId" TEXT,
  "fencingToken" INTEGER,
  "generationIntensity" TEXT NOT NULL DEFAULT 'standard',
  "intensityVersion" INTEGER NOT NULL DEFAULT 0,
  "lockedBy" TEXT,
  "lockedUntil" DATETIME,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "failureCategory" TEXT,
  "failureRetryability" TEXT,
  "failureEvidenceDigest" TEXT,
  "recoveryEvidenceDigest" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  CONSTRAINT "ConversationTurnJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectExecutionLease" (
  "projectId" TEXT NOT NULL PRIMARY KEY,
  "holderId" TEXT NOT NULL,
  "fencingToken" INTEGER NOT NULL DEFAULT 1,
  "leasedUntil" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProjectExecutionLease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuthSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "authMode" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "projectId" TEXT,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "LocalUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OrchestrationAuditEvent" (
  "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "eventId" TEXT NOT NULL,
  "attemptId" TEXT,
  "recordType" TEXT NOT NULL,
  "outcome" TEXT,
  "operationKind" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "claimedProjectId" TEXT,
  "resolvedProjectId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "actorAuthMode" TEXT NOT NULL,
  "authSessionDigest" TEXT,
  "taskId" TEXT,
  "turnJobId" TEXT,
  "teacherMessageId" TEXT,
  "toolInvocationId" TEXT,
  "intentEpoch" INTEGER,
  "planRevision" INTEGER,
  "planId" TEXT,
  "toolOrdinal" INTEGER,
  "toolName" TEXT,
  "actionDigest" TEXT,
  "idempotencyKey" TEXT,
  "observationId" TEXT,
  "invocationStatus" TEXT,
  "executionEnvelopeDigest" TEXT,
  "requestDigest" TEXT,
  "reasonCode" TEXT,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "eventDigest" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrchestrationAuditEvent_recordType_outcome_check" CHECK (
    ("recordType" = 'attempted' AND "outcome" IS NULL) OR
    ("recordType" = 'resolved' AND "outcome" IS NOT NULL AND "outcome" IN ('committed', 'rejected', 'failed'))
  ),
  CONSTRAINT "OrchestrationAuditEvent_operationKind_check" CHECK (
    "operationKind" IN ('external_mutation', 'tool_invocation')
  ),
  CONSTRAINT "OrchestrationAuditEvent_authority_check" CHECK (
    "authority" IN (
      'teacher_http', 'teacher_task_submission', 'legacy_external_orchestration', 'unclassified_external',
      'main_agent', 'artifact_route', 'system'
    )
  ),
  CONSTRAINT "OrchestrationAuditEvent_nonempty_identity_check" CHECK (
    length(trim("eventId")) > 0 AND length(trim("actorUserId")) > 0 AND length(trim("actorAuthMode")) > 0
  ),
  CONSTRAINT "OrchestrationAuditEvent_eventDigest_check" CHECK (
    length("eventDigest") = 64 AND "eventDigest" NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT "OrchestrationAuditEvent_optional_digest_check" CHECK (
    ("authSessionDigest" IS NULL OR (length("authSessionDigest") = 64 AND "authSessionDigest" NOT GLOB '*[^0-9a-f]*')) AND
    ("actionDigest" IS NULL OR (length("actionDigest") = 64 AND "actionDigest" NOT GLOB '*[^0-9a-f]*')) AND
    ("executionEnvelopeDigest" IS NULL OR (length("executionEnvelopeDigest") = 64 AND "executionEnvelopeDigest" NOT GLOB '*[^0-9a-f]*')) AND
    ("requestDigest" IS NULL OR (length("requestDigest") = 64 AND "requestDigest" NOT GLOB '*[^0-9a-f]*'))
  ),
  CONSTRAINT "OrchestrationAuditEvent_ordinal_check" CHECK (
    ("intentEpoch" IS NULL OR "intentEpoch" >= 0) AND
    ("planRevision" IS NULL OR "planRevision" >= 0) AND
    ("toolOrdinal" IS NULL OR "toolOrdinal" >= 1)
  ),
  CONSTRAINT "OrchestrationAuditEvent_tool_commit_authority_check" CHECK (
    "operationKind" <> 'tool_invocation' OR "outcome" <> 'committed' OR
    ("authority" IN ('main_agent', 'artifact_route') AND "toolInvocationId" IS NOT NULL AND
      "actionDigest" IS NOT NULL AND "executionEnvelopeDigest" IS NOT NULL AND "requestDigest" IS NOT NULL)
  ),
  CONSTRAINT "OrchestrationAuditEvent_tool_attempt_binding_check" CHECK (
    "operationKind" <> 'tool_invocation' OR
    ("attemptId" IS NOT NULL AND "toolInvocationId" IS NOT NULL AND "attemptId" = "toolInvocationId")
  ),
  CONSTRAINT "OrchestrationAuditEvent_invocationStatus_check" CHECK (
    "invocationStatus" IS NULL OR "invocationStatus" IN ('running', 'succeeded', 'failed', 'blocked', 'rejected')
  )
);

CREATE TABLE IF NOT EXISTS "CsrfToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CsrfToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CsrfToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "FeedbackRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receipt" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" TEXT,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'global',
  "projectId" TEXT,
  "messageId" TEXT,
  "pageRoute" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "clientContextJson" TEXT NOT NULL DEFAULT '{}',
  "stagingKey" TEXT NOT NULL,
  "failureCode" TEXT,
  "reconciliationOwner" TEXT,
  "reconciliationLeaseUntil" DATETIME,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "submittedAt" DATETIME,
  CONSTRAINT "FeedbackRecord_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "LocalUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FeedbackRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FeedbackRecord_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "FeedbackAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "feedbackId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'issue',
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackAttachment_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "FeedbackRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "MessageReaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MessageReaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageReaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "LocalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

`);
ensureColumn(db, "Project", "ownerUserId", 'ALTER TABLE "Project" ADD COLUMN "ownerUserId" TEXT');
ensureColumn(db, "Project", "archivedAt", 'ALTER TABLE "Project" ADD COLUMN "archivedAt" DATETIME');
ensureColumn(db, "Project", "deletedAt", 'ALTER TABLE "Project" ADD COLUMN "deletedAt" DATETIME');
ensureColumn(db, "Project", "lifecycleVersion", 'ALTER TABLE "Project" ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "Project", "intentEpoch", 'ALTER TABLE "Project" ADD COLUMN "intentEpoch" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "Project", "generationIntensity", 'ALTER TABLE "Project" ADD COLUMN "generationIntensity" TEXT NOT NULL DEFAULT \'standard\'');
ensureColumn(db, "Project", "intensityVersion", 'ALTER TABLE "Project" ADD COLUMN "intensityVersion" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "ConversationMessage", "partsJson", 'ALTER TABLE "ConversationMessage" ADD COLUMN "partsJson" TEXT NOT NULL DEFAULT \'[]\'');
ensureColumn(db, "ConversationMessage", "metadataJson", 'ALTER TABLE "ConversationMessage" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT \'{}\'');
ensureColumn(db, "Artifact", "taskId", 'ALTER TABLE "Artifact" ADD COLUMN "taskId" TEXT');
ensureColumn(db, "Artifact", "taskBriefDigest", 'ALTER TABLE "Artifact" ADD COLUMN "taskBriefDigest" TEXT');
ensureColumn(db, "Artifact", "intentEpoch", 'ALTER TABLE "Artifact" ADD COLUMN "intentEpoch" INTEGER');
ensureColumn(db, "Artifact", "planRevision", 'ALTER TABLE "Artifact" ADD COLUMN "planRevision" INTEGER');
ensureColumn(db, "Artifact", "origin", 'ALTER TABLE "Artifact" ADD COLUMN "origin" TEXT NOT NULL DEFAULT \'legacy\'');
migrateUnprovenLegacyArtifactApprovals(db);
ensureColumn(db, "ConversationTurnJob", "actorUserId", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "actorUserId" TEXT');
ensureColumn(db, "ConversationTurnJob", "actorAuthMode", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "actorAuthMode" TEXT');
ensureColumn(db, "ConversationTurnJob", "authSessionId", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "authSessionId" TEXT');
ensureColumn(db, "ConversationTurnJob", "fencingToken", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "fencingToken" INTEGER');
ensureColumn(db, "ConversationTurnJob", "generationIntensity", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "generationIntensity" TEXT NOT NULL DEFAULT \'standard\'');
ensureColumn(db, "ConversationTurnJob", "intensityVersion", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "intensityVersion" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "ConversationTurnJob", "failureCategory", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "failureCategory" TEXT');
ensureColumn(db, "ConversationTurnJob", "failureRetryability", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "failureRetryability" TEXT');
ensureColumn(db, "ConversationTurnJob", "failureEvidenceDigest", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "failureEvidenceDigest" TEXT');
ensureColumn(db, "ConversationTurnJob", "recoveryEvidenceDigest", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "recoveryEvidenceDigest" TEXT');
ensureColumn(db, "GenerationJob", "runInputSnapshotId", 'ALTER TABLE "GenerationJob" ADD COLUMN "runInputSnapshotId" TEXT');
ensureColumn(db, "GenerationJob", "unitId", 'ALTER TABLE "GenerationJob" ADD COLUMN "unitId" TEXT');
ensureColumn(db, "GenerationJob", "intentEpoch", 'ALTER TABLE "GenerationJob" ADD COLUMN "intentEpoch" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "GenerationJob", "idempotencyKey", 'ALTER TABLE "GenerationJob" ADD COLUMN "idempotencyKey" TEXT');
ensureColumn(db, "GenerationJob", "inputHash", 'ALTER TABLE "GenerationJob" ADD COLUMN "inputHash" TEXT');
ensureColumn(db, "GenerationJob", "providerTaskId", 'ALTER TABLE "GenerationJob" ADD COLUMN "providerTaskId" TEXT');
ensureColumn(db, "GenerationJob", "pollState", 'ALTER TABLE "GenerationJob" ADD COLUMN "pollState" TEXT NOT NULL DEFAULT \'not_started\'');
ensureColumn(db, "GenerationJob", "providerAcceptedAt", 'ALTER TABLE "GenerationJob" ADD COLUMN "providerAcceptedAt" DATETIME');
ensureColumn(db, "GenerationJob", "lastPolledAt", 'ALTER TABLE "GenerationJob" ADD COLUMN "lastPolledAt" DATETIME');
ensureColumn(db, "GenerationJob", "providerResultJson", 'ALTER TABLE "GenerationJob" ADD COLUMN "providerResultJson" TEXT');
ensureColumn(db, "GenerationJob", "countsAsProviderSubmission", 'ALTER TABLE "GenerationJob" ADD COLUMN "countsAsProviderSubmission" BOOLEAN NOT NULL DEFAULT true');
ensureColumn(db, "StagedArtifactCommit", "actorUserId", 'ALTER TABLE "StagedArtifactCommit" ADD COLUMN "actorUserId" TEXT');
ensureColumn(db, "StagedArtifactCommit", "actorAuthMode", 'ALTER TABLE "StagedArtifactCommit" ADD COLUMN "actorAuthMode" TEXT');
ensureColumn(db, "StagedArtifactCommit", "authSessionId", 'ALTER TABLE "StagedArtifactCommit" ADD COLUMN "authSessionId" TEXT');
ensureColumn(db, "LocalUser", "authMode", 'ALTER TABLE "LocalUser" ADD COLUMN "authMode" TEXT NOT NULL DEFAULT \'local\'');
ensureColumn(db, "LocalUser", "email", 'ALTER TABLE "LocalUser" ADD COLUMN "email" TEXT');
ensureColumn(db, "LocalUser", "passwordHash", 'ALTER TABLE "LocalUser" ADD COLUMN "passwordHash" TEXT');
ensureColumn(db, "LocalUser", "disabledAt", 'ALTER TABLE "LocalUser" ADD COLUMN "disabledAt" DATETIME');
ensureColumn(db, "LocalUser", "disabledReason", 'ALTER TABLE "LocalUser" ADD COLUMN "disabledReason" TEXT');
ensureColumn(db, "LocalUser", "lastLoginAt", 'ALTER TABLE "LocalUser" ADD COLUMN "lastLoginAt" DATETIME');
ensureColumn(db, "LocalUser", "passwordResetAt", 'ALTER TABLE "LocalUser" ADD COLUMN "passwordResetAt" DATETIME');
ensureColumn(db, "FeedbackRecord", "origin", 'ALTER TABLE "FeedbackRecord" ADD COLUMN "origin" TEXT NOT NULL DEFAULT \'global\'');
ensureColumn(db, "FeedbackAttachment", "kind", 'ALTER TABLE "FeedbackAttachment" ADD COLUMN "kind" TEXT NOT NULL DEFAULT \'issue\'');
assertNoFeedbackIdempotencyConflicts(db);
db.exec(`
CREATE INDEX IF NOT EXISTS "ConversationMessage_projectId_createdAt_idx" ON "ConversationMessage"("projectId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TaskAggregate_projectId_intentEpoch_key" ON "TaskAggregate"("projectId", "intentEpoch");
CREATE INDEX IF NOT EXISTS "TaskAggregate_projectId_status_updatedAt_idx" ON "TaskAggregate"("projectId", "status", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentEventRecord_projectId_sequence_key" ON "AgentEventRecord"("projectId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentEventRecord_projectId_taskId_sequence_idx" ON "AgentEventRecord"("projectId", "taskId", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "ToolInvocationRecord_projectId_idempotencyKey_key" ON "ToolInvocationRecord"("projectId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ToolInvocationRecord_projectId_taskId_startedAt_idx" ON "ToolInvocationRecord"("projectId", "taskId", "startedAt");
CREATE INDEX IF NOT EXISTS "ObservationRecord_projectId_taskId_createdAt_idx" ON "ObservationRecord"("projectId", "taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "ObservationRecord_invocationId_idx" ON "ObservationRecord"("invocationId");
CREATE UNIQUE INDEX IF NOT EXISTS "SemanticContextSnapshotRecord_projectId_taskId_intentEpoch_planRevision_key" ON "SemanticContextSnapshotRecord"("projectId", "taskId", "intentEpoch", "planRevision");
CREATE INDEX IF NOT EXISTS "SemanticContextSnapshotRecord_projectId_createdAt_idx" ON "SemanticContextSnapshotRecord"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "Project_ownerUserId_updatedAt_idx" ON "Project"("ownerUserId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Project_archivedAt_deletedAt_updatedAt_idx" ON "Project"("archivedAt", "deletedAt", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "LocalUser_email_key" ON "LocalUser"("email");
CREATE INDEX IF NOT EXISTS "Artifact_projectId_nodeKey_version_idx" ON "Artifact"("projectId", "nodeKey", "version");
CREATE INDEX IF NOT EXISTS "Artifact_projectId_intentEpoch_kind_idx" ON "Artifact"("projectId", "intentEpoch", "kind");
CREATE INDEX IF NOT EXISTS "Artifact_taskId_idx" ON "Artifact"("taskId");
CREATE INDEX IF NOT EXISTS "GenerationJob_projectId_status_createdAt_idx" ON "GenerationJob"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GenerationJob_sourceArtifactId_idx" ON "GenerationJob"("sourceArtifactId");
CREATE INDEX IF NOT EXISTS "GenerationJob_projectId_kind_unitId_createdAt_idx" ON "GenerationJob"("projectId", "kind", "unitId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "GenerationJob_projectId_idempotencyKey_key" ON "GenerationJob"("projectId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "GenerationJob_runInputSnapshotId_idx" ON "GenerationJob"("runInputSnapshotId");
CREATE UNIQUE INDEX IF NOT EXISTS "VideoShot_projectId_sourceArtifactId_shotId_key" ON "VideoShot"("projectId", "sourceArtifactId", "shotId");
CREATE INDEX IF NOT EXISTS "VideoShot_projectId_sourceArtifactId_ordinal_idx" ON "VideoShot"("projectId", "sourceArtifactId", "ordinal");
CREATE INDEX IF NOT EXISTS "VideoShot_projectId_status_updatedAt_idx" ON "VideoShot"("projectId", "status", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RunInputSnapshot_projectId_inputHash_key" ON "RunInputSnapshot"("projectId", "inputHash");
CREATE INDEX IF NOT EXISTS "RunInputSnapshot_projectId_intentEpoch_createdAt_idx" ON "RunInputSnapshot"("projectId", "intentEpoch", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "StagedArtifactCommit_generationJobId_key" ON "StagedArtifactCommit"("generationJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "StagedArtifactCommit_resultArtifactId_key" ON "StagedArtifactCommit"("resultArtifactId");
CREATE INDEX IF NOT EXISTS "StagedArtifactCommit_projectId_state_createdAt_idx" ON "StagedArtifactCommit"("projectId", "state", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ValidationReportRecord_artifactId_key" ON "ValidationReportRecord"("artifactId");
CREATE UNIQUE INDEX IF NOT EXISTS "ValidationReportRecord_generationJobId_key" ON "ValidationReportRecord"("generationJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "ValidationReportRecord_stagedArtifactCommitId_key" ON "ValidationReportRecord"("stagedArtifactCommitId");
CREATE INDEX IF NOT EXISTS "ValidationReportRecord_projectId_stage_createdAt_idx" ON "ValidationReportRecord"("projectId", "stage", "createdAt");
CREATE INDEX IF NOT EXISTS "ValidationReportRecord_projectId_reportDigest_idx" ON "ValidationReportRecord"("projectId", "reportDigest");
CREATE INDEX IF NOT EXISTS "ValidationReportRecord_targetKind_targetId_idx" ON "ValidationReportRecord"("targetKind", "targetId");
CREATE UNIQUE INDEX IF NOT EXISTS "CriticReportRecord_projectId_reportDigest_key" ON "CriticReportRecord"("projectId", "reportDigest");
CREATE INDEX IF NOT EXISTS "CriticReportRecord_projectId_artifactId_createdAt_idx" ON "CriticReportRecord"("projectId", "artifactId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "QualityDecisionRecord_projectId_decisionDigest_key" ON "QualityDecisionRecord"("projectId", "decisionDigest");
CREATE INDEX IF NOT EXISTS "QualityDecisionRecord_projectId_artifactId_createdAt_idx" ON "QualityDecisionRecord"("projectId", "artifactId", "createdAt");
CREATE INDEX IF NOT EXISTS "QualityDecisionRecord_criticReportId_idx" ON "QualityDecisionRecord"("criticReportId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationTurnJob_projectId_idempotencyKey_key" ON "ConversationTurnJob"("projectId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ConversationTurnJob_projectId_status_createdAt_idx" ON "ConversationTurnJob"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationTurnJob_teacherMessageId_idx" ON "ConversationTurnJob"("teacherMessageId");
CREATE INDEX IF NOT EXISTS "ProjectExecutionLease_leasedUntil_idx" ON "ProjectExecutionLease"("leasedUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_sessionTokenHash_key" ON "AuthSession"("sessionTokenHash");
CREATE INDEX IF NOT EXISTS "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");
CREATE INDEX IF NOT EXISTS "ProjectMembership_userId_role_idx" ON "ProjectMembership"("userId", "role");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "OrchestrationAuditEvent_eventId_key" ON "OrchestrationAuditEvent"("eventId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrchestrationAuditEvent_eventDigest_key" ON "OrchestrationAuditEvent"("eventDigest");
CREATE UNIQUE INDEX IF NOT EXISTS "OrchestrationAuditEvent_attemptId_recordType_key" ON "OrchestrationAuditEvent"("attemptId", "recordType");
CREATE UNIQUE INDEX IF NOT EXISTS "OrchestrationAuditEvent_resolvedProjectId_taskId_intentEpoch_toolOrdinal_recordType_key" ON "OrchestrationAuditEvent"("resolvedProjectId", "taskId", "intentEpoch", "toolOrdinal", "recordType");
CREATE UNIQUE INDEX IF NOT EXISTS "OrchestrationAuditEvent_toolInvocationId_recordType_key" ON "OrchestrationAuditEvent"("toolInvocationId", "recordType");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_claimedProjectId_sequence_idx" ON "OrchestrationAuditEvent"("claimedProjectId", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_resolvedProjectId_sequence_idx" ON "OrchestrationAuditEvent"("resolvedProjectId", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_taskId_intentEpoch_sequence_idx" ON "OrchestrationAuditEvent"("taskId", "intentEpoch", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_turnJobId_sequence_idx" ON "OrchestrationAuditEvent"("turnJobId", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_toolInvocationId_sequence_idx" ON "OrchestrationAuditEvent"("toolInvocationId", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_observationId_sequence_idx" ON "OrchestrationAuditEvent"("observationId", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_idempotencyKey_sequence_idx" ON "OrchestrationAuditEvent"("idempotencyKey", "sequence");
CREATE INDEX IF NOT EXISTS "OrchestrationAuditEvent_authority_operationKind_sequence_idx" ON "OrchestrationAuditEvent"("authority", "operationKind", "sequence");
CREATE TRIGGER IF NOT EXISTS "OrchestrationAuditEvent_reject_update"
BEFORE UPDATE ON "OrchestrationAuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'OrchestrationAuditEvent is append-only');
END;
CREATE TRIGGER IF NOT EXISTS "OrchestrationAuditEvent_reject_delete"
BEFORE DELETE ON "OrchestrationAuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'OrchestrationAuditEvent is append-only');
END;
CREATE UNIQUE INDEX IF NOT EXISTS "CsrfToken_tokenHash_key" ON "CsrfToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CsrfToken_sessionId_expiresAt_idx" ON "CsrfToken"("sessionId", "expiresAt");
CREATE INDEX IF NOT EXISTS "CsrfToken_userId_expiresAt_idx" ON "CsrfToken"("userId", "expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackRecord_receipt_key" ON "FeedbackRecord"("receipt");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackRecord_stagingKey_key" ON "FeedbackRecord"("stagingKey");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackRecord_createdByUserId_idempotencyKey_key" ON "FeedbackRecord"("createdByUserId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "FeedbackRecord_status_createdAt_idx" ON "FeedbackRecord"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "FeedbackRecord_category_createdAt_idx" ON "FeedbackRecord"("category", "createdAt");
CREATE INDEX IF NOT EXISTS "FeedbackRecord_severity_createdAt_idx" ON "FeedbackRecord"("severity", "createdAt");
CREATE INDEX IF NOT EXISTS "FeedbackRecord_createdByUserId_createdAt_idx" ON "FeedbackRecord"("createdByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "FeedbackRecord_projectId_createdAt_idx" ON "FeedbackRecord"("projectId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackAttachment_storageKey_key" ON "FeedbackAttachment"("storageKey");
CREATE INDEX IF NOT EXISTS "FeedbackAttachment_feedbackId_createdAt_idx" ON "FeedbackAttachment"("feedbackId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "MessageReaction_messageId_createdByUserId_key" ON "MessageReaction"("messageId", "createdByUserId");
CREATE INDEX IF NOT EXISTS "MessageReaction_projectId_createdByUserId_updatedAt_idx" ON "MessageReaction"("projectId", "createdByUserId", "updatedAt");
`);
db.close();

console.log(JSON.stringify({ ok: true, database: path.relative(root, dbPath).replaceAll(path.sep, "/") }));

function ensureColumn(db, table, column, alterSql) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(alterSql);
  }
}

function assertNoFeedbackIdempotencyConflicts(db) {
  const conflict = db.prepare(`
    SELECT COUNT(*) AS duplicateCount
    FROM "FeedbackRecord"
    GROUP BY "createdByUserId", "idempotencyKey"
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();
  if (conflict) {
    throw new Error("Feedback idempotency conflict detected; resolve duplicate rows before retrying schema initialization.");
  }
}

function migrateUnprovenLegacyArtifactApprovals(db) {
  const candidates = db.prepare(`
    SELECT "id", "projectId", "nodeKey", "kind", "title", "status", "summary", "markdownContent",
      "structuredContentJson", "isApproved"
    FROM "Artifact"
    WHERE "origin" = 'legacy' AND "status" = 'approved' AND "isApproved" = 1
  `).all();
  if (candidates.length === 0) return;

  const updateArtifact = db.prepare(`
    UPDATE "Artifact"
    SET "status" = 'needs_review', "isApproved" = 0, "structuredContentJson" = ?, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ? AND "origin" = 'legacy' AND "status" = 'approved' AND "isApproved" = 1
  `);
  const migrate = db.transaction(() => {
    for (const artifact of candidates) {
      const structuredContent = parseJsonObject(artifact.structuredContentJson);
      if (hasValidLegacyReapprovalEvidence(artifact, structuredContent)) continue;
      const existingMigration = structuredContent.legacyApprovalMigration;
      const legacyApprovalMigration = hasLegacyApprovalMigration(existingMigration)
        ? existingMigration
        : {
            schemaVersion: "legacy-artifact-approval-migration.v1",
            reasonCode: "legacy_approval_evidence_missing",
            migratedFromStatus: "approved",
            migratedFromApproved: true,
            migratedAt: new Date().toISOString(),
          };
      updateArtifact.run(JSON.stringify({ ...structuredContent, legacyApprovalMigration }), artifact.id);
    }
  });
  migrate();
}

function hasValidLegacyReapprovalEvidence(artifact, structuredContent) {
  if (!hasLegacyApprovalMigration(structuredContent.legacyApprovalMigration)) return false;
  const evidence = structuredContent.artifactApprovalEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
      evidence.schemaVersion !== "artifact-approval-evidence.v1" || evidence.sourceAuthority !== "legacy_reapproved" ||
      !isSha256(evidence.artifactDigest) || !isIsoDate(evidence.approvedAt)) return false;
  const contentWithoutApproval = { ...structuredContent };
  delete contentWithoutApproval.artifactApprovalEvidence;
  delete contentWithoutApproval.pptSampleApproval;
  delete contentWithoutApproval.routeGenerationActions;
  delete contentWithoutApproval.videoCourseAnchorApproval;
  delete contentWithoutApproval.videoFinalApproval;
  const expectedDigest = hashCanonicalJson({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent ?? "",
    structuredContent: contentWithoutApproval,
  });
  return evidence.artifactDigest.toLowerCase() === expectedDigest;
}

function hasLegacyApprovalMigration(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    value.schemaVersion === "legacy-artifact-approval-migration.v1" &&
    value.reasonCode === "legacy_approval_evidence_missing" &&
    value.migratedFromStatus === "approved" && value.migratedFromApproved === true && isIsoDate(value.migratedAt));
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hashCanonicalJson(value) {
  return createHash("sha256").update(JSON.stringify(normalizeJson(value)), "utf8").digest("hex");
}

function normalizeJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]));
  }
  return null;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

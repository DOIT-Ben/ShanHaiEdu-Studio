import Database from "better-sqlite3";
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
  "artifactRefsJson" TEXT NOT NULL DEFAULT '[]',
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WorkflowNode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'not_started',
  "order" INTEGER NOT NULL,
  "upstreamNodeKeysJson" TEXT NOT NULL DEFAULT '[]',
  "approvedArtifactId" TEXT,
  "staleReason" TEXT,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WorkflowNode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkflowNode_approvedArtifactId_fkey" FOREIGN KEY ("approvedArtifactId") REFERENCES "Artifact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Artifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS "AgentRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "nodeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "runtime" TEXT NOT NULL,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  "errorMessage" TEXT,
  CONSTRAINT "AgentRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
ensureColumn(db, "ConversationMessage", "metadataJson", 'ALTER TABLE "ConversationMessage" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT \'{}\'');
ensureColumn(db, "ConversationTurnJob", "actorUserId", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "actorUserId" TEXT');
ensureColumn(db, "ConversationTurnJob", "actorAuthMode", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "actorAuthMode" TEXT');
ensureColumn(db, "ConversationTurnJob", "authSessionId", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "authSessionId" TEXT');
ensureColumn(db, "ConversationTurnJob", "fencingToken", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "fencingToken" INTEGER');
ensureColumn(db, "ConversationTurnJob", "generationIntensity", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "generationIntensity" TEXT NOT NULL DEFAULT \'standard\'');
ensureColumn(db, "ConversationTurnJob", "intensityVersion", 'ALTER TABLE "ConversationTurnJob" ADD COLUMN "intensityVersion" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "GenerationJob", "runInputSnapshotId", 'ALTER TABLE "GenerationJob" ADD COLUMN "runInputSnapshotId" TEXT');
ensureColumn(db, "GenerationJob", "unitId", 'ALTER TABLE "GenerationJob" ADD COLUMN "unitId" TEXT');
ensureColumn(db, "GenerationJob", "intentEpoch", 'ALTER TABLE "GenerationJob" ADD COLUMN "intentEpoch" INTEGER NOT NULL DEFAULT 0');
ensureColumn(db, "GenerationJob", "idempotencyKey", 'ALTER TABLE "GenerationJob" ADD COLUMN "idempotencyKey" TEXT');
ensureColumn(db, "GenerationJob", "inputHash", 'ALTER TABLE "GenerationJob" ADD COLUMN "inputHash" TEXT');
ensureColumn(db, "GenerationJob", "providerTaskId", 'ALTER TABLE "GenerationJob" ADD COLUMN "providerTaskId" TEXT');
ensureColumn(db, "GenerationJob", "pollState", 'ALTER TABLE "GenerationJob" ADD COLUMN "pollState" TEXT NOT NULL DEFAULT \'not_started\'');
ensureColumn(db, "GenerationJob", "providerAcceptedAt", 'ALTER TABLE "GenerationJob" ADD COLUMN "providerAcceptedAt" DATETIME');
ensureColumn(db, "GenerationJob", "lastPolledAt", 'ALTER TABLE "GenerationJob" ADD COLUMN "lastPolledAt" DATETIME');
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
CREATE INDEX IF NOT EXISTS "Project_ownerUserId_updatedAt_idx" ON "Project"("ownerUserId", "updatedAt");
CREATE INDEX IF NOT EXISTS "Project_archivedAt_deletedAt_updatedAt_idx" ON "Project"("archivedAt", "deletedAt", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "LocalUser_email_key" ON "LocalUser"("email");
CREATE INDEX IF NOT EXISTS "WorkflowNode_projectId_order_idx" ON "WorkflowNode"("projectId", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowNode_projectId_key_key" ON "WorkflowNode"("projectId", "key");
CREATE INDEX IF NOT EXISTS "Artifact_projectId_nodeKey_version_idx" ON "Artifact"("projectId", "nodeKey", "version");
CREATE INDEX IF NOT EXISTS "AgentRun_projectId_nodeKey_startedAt_idx" ON "AgentRun"("projectId", "nodeKey", "startedAt");
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

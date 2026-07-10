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
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 2,
  "resultArtifactId" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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

`);
ensureColumn(db, "Project", "ownerUserId", 'ALTER TABLE "Project" ADD COLUMN "ownerUserId" TEXT');
ensureColumn(db, "ConversationMessage", "metadataJson", 'ALTER TABLE "ConversationMessage" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT \'{}\'');
ensureColumn(db, "LocalUser", "authMode", 'ALTER TABLE "LocalUser" ADD COLUMN "authMode" TEXT NOT NULL DEFAULT \'local\'');
ensureColumn(db, "LocalUser", "email", 'ALTER TABLE "LocalUser" ADD COLUMN "email" TEXT');
ensureColumn(db, "LocalUser", "passwordHash", 'ALTER TABLE "LocalUser" ADD COLUMN "passwordHash" TEXT');
ensureColumn(db, "FeedbackRecord", "origin", 'ALTER TABLE "FeedbackRecord" ADD COLUMN "origin" TEXT NOT NULL DEFAULT \'global\'');
assertNoFeedbackIdempotencyConflicts(db);
db.exec(`
CREATE INDEX IF NOT EXISTS "ConversationMessage_projectId_createdAt_idx" ON "ConversationMessage"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "Project_ownerUserId_updatedAt_idx" ON "Project"("ownerUserId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "LocalUser_email_key" ON "LocalUser"("email");
CREATE INDEX IF NOT EXISTS "WorkflowNode_projectId_order_idx" ON "WorkflowNode"("projectId", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowNode_projectId_key_key" ON "WorkflowNode"("projectId", "key");
CREATE INDEX IF NOT EXISTS "Artifact_projectId_nodeKey_version_idx" ON "Artifact"("projectId", "nodeKey", "version");
CREATE INDEX IF NOT EXISTS "AgentRun_projectId_nodeKey_startedAt_idx" ON "AgentRun"("projectId", "nodeKey", "startedAt");
CREATE INDEX IF NOT EXISTS "GenerationJob_projectId_status_createdAt_idx" ON "GenerationJob"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "GenerationJob_sourceArtifactId_idx" ON "GenerationJob"("sourceArtifactId");
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationTurnJob_projectId_idempotencyKey_key" ON "ConversationTurnJob"("projectId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ConversationTurnJob_projectId_status_createdAt_idx" ON "ConversationTurnJob"("projectId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationTurnJob_teacherMessageId_idx" ON "ConversationTurnJob"("teacherMessageId");
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

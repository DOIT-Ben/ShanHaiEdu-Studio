import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SHANHAI_DB_INIT_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const dbPath = resolveSqlitePath(databaseUrl);

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

`);
ensureColumn(db, "Project", "ownerUserId", 'ALTER TABLE "Project" ADD COLUMN "ownerUserId" TEXT');
ensureColumn(db, "ConversationMessage", "metadataJson", 'ALTER TABLE "ConversationMessage" ADD COLUMN "metadataJson" TEXT NOT NULL DEFAULT \'{}\'');
ensureColumn(db, "LocalUser", "authMode", 'ALTER TABLE "LocalUser" ADD COLUMN "authMode" TEXT NOT NULL DEFAULT \'local\'');
ensureColumn(db, "LocalUser", "email", 'ALTER TABLE "LocalUser" ADD COLUMN "email" TEXT');
ensureColumn(db, "LocalUser", "passwordHash", 'ALTER TABLE "LocalUser" ADD COLUMN "passwordHash" TEXT');
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
`);
db.close();

console.log(JSON.stringify({ ok: true, database: path.relative(root, dbPath).replaceAll(path.sep, "/") }));

function resolveSqlitePath(url) {
  if (!url.startsWith("file:")) {
    throw new Error("Only file: SQLite DATABASE_URL values are supported for local E2E initialization.");
  }

  const raw = url.slice("file:".length);
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(root, raw);
}

function ensureColumn(db, table, column, alterSql) {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(alterSql);
  }
}

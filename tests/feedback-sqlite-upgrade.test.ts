import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("feedback Prisma schema", () => {
  it("declares required ownership, idempotency and attachment uniqueness", async () => {
    const schema = await readFile(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    expect(schema).toMatch(/model FeedbackRecord \{/);
    expect(schema).toMatch(/createdByUserId\s+String\s*\n/);
    expect(schema).toMatch(/receipt\s+String\s+@unique/);
    expect(schema).toMatch(/origin\s+String(?:\s+@default\("global"\))?/);
    expect(schema).toMatch(/@@unique\(\[createdByUserId, idempotencyKey\]\)/);
    expect(schema).toMatch(/model FeedbackAttachment \{/);
    expect(schema).toMatch(/storageKey\s+String\s+@unique/);
    expect(schema).toMatch(/@@index\(\[status, createdAt\]\)/);
  });
});

describe("feedback SQLite upgrades", () => {
  it("provides a runnable production feedback reconciliation entrypoint", async () => {
    const dbPath = await createDatabasePath();
    expect(runInit(dbPath).status).toBe(0);
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["feedback:reconcile"]).toBe("tsx scripts/reconcile-feedback-storage.mjs");

    const artifactRoot = path.join(path.dirname(dbPath), "artifacts");
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(command, ["run", "feedback:reconcile"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbPath.replaceAll("\\", "/")}`,
        ARTIFACT_STORAGE_ROOT: artifactRoot,
        FEEDBACK_RECONCILE_STALE_AFTER_MS: "0",
        FEEDBACK_RECONCILE_ORPHAN_GRACE_MS: "0",
      },
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/"ok":true/);
    expect(result.stdout).toMatch(/"claimed":0/);
  });

  it("initializes an empty database with feedback tables and unique indexes", async () => {
    const dbPath = await createDatabasePath();
    expect(runInit(dbPath).status).toBe(0);

    const db = new Database(dbPath);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["FeedbackRecord", "FeedbackAttachment"]));
    expect(indexNames(db, "FeedbackRecord")).toEqual(expect.arrayContaining([
      "FeedbackRecord_receipt_key",
      "FeedbackRecord_createdByUserId_idempotencyKey_key",
      "FeedbackRecord_status_createdAt_idx",
    ]));
    expect(indexNames(db, "FeedbackAttachment")).toEqual(expect.arrayContaining([
      "FeedbackAttachment_storageKey_key",
      "FeedbackAttachment_feedbackId_createdAt_idx",
    ]));
    expect(column(db, "FeedbackRecord", "createdByUserId")?.notnull).toBe(1);
    expect(column(db, "FeedbackRecord", "origin")?.notnull).toBe(1);
    db.close();
  });

  it("upgrades a pre-feedback database without deleting existing data", async () => {
    const dbPath = await createDatabasePath();
    const db = new Database(dbPath);
    createLegacyCoreTables(db);
    db.prepare('INSERT INTO "LocalUser" (id, displayName, updatedAt) VALUES (?, ?, ?)')
      .run("teacher-1", "Existing Teacher", "2026-07-10T00:00:00.000Z");
    db.close();

    expect(runInit(dbPath).status).toBe(0);
    const upgraded = new Database(dbPath);
    expect(upgraded.prepare('SELECT displayName FROM "LocalUser" WHERE id = ?').get("teacher-1")).toEqual({
      displayName: "Existing Teacher",
    });
    expect(tableNames(upgraded)).toContain("FeedbackRecord");
    upgraded.close();
  });

  it("can run repeatedly without duplicating or deleting feedback", async () => {
    const dbPath = await createDatabasePath();
    expect(runInit(dbPath).status).toBe(0);
    const db = new Database(dbPath);
    db.prepare('INSERT INTO "LocalUser" (id, displayName, updatedAt) VALUES (?, ?, ?)')
      .run("teacher-1", "Existing Teacher", "2026-07-10T00:00:00.000Z");
    insertFeedbackFixture(db, { id: "feedback-1", receipt: "FB-20260710-AAAA", idempotencyKey: "key-1" });
    db.close();

    expect(runInit(dbPath).status).toBe(0);
    const reopened = new Database(dbPath);
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM "FeedbackRecord"').get()).toEqual({ count: 1 });
    reopened.close();
  });

  it("stops on legacy idempotency conflicts without deleting or merging rows", async () => {
    const dbPath = await createDatabasePath();
    const db = new Database(dbPath);
    createLegacyCoreTables(db);
    createLegacyFeedbackTableWithoutUniqueIndex(db);
    db.prepare('INSERT INTO "LocalUser" (id, displayName, updatedAt) VALUES (?, ?, ?)')
      .run("teacher-1", "Existing Teacher", "2026-07-10T00:00:00.000Z");
    insertFeedbackFixture(db, { id: "feedback-1", receipt: "FB-20260710-AAAA", idempotencyKey: "same-key" });
    insertFeedbackFixture(db, { id: "feedback-2", receipt: "FB-20260710-BBBB", idempotencyKey: "same-key" });
    db.close();

    const result = runInit(dbPath);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/idempotency.*conflict/i);

    const unchanged = new Database(dbPath);
    expect(unchanged.prepare('SELECT COUNT(*) AS count FROM "FeedbackRecord"').get()).toEqual({ count: 2 });
    expect(indexNames(unchanged, "FeedbackRecord")).not.toContain("FeedbackRecord_createdByUserId_idempotencyKey_key");
    unchanged.close();
  });
});

async function createDatabasePath() {
  const root = path.join(process.cwd(), ".tmp", `feedback-db-${randomUUID()}`);
  tempRoots.push(root);
  await mkdir(root, { recursive: true });
  return path.join(root, "feedback.db");
}

function runInit(dbPath: string) {
  return spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath.replaceAll("\\", "/")}`,
      SHANHAI_DB_INIT_SKIP_DOTENV: "1",
    },
    timeout: 30_000,
  });
}

function createLegacyCoreTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE "LocalUser" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "displayName" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'teacher',
      "authMode" TEXT NOT NULL DEFAULT 'local',
      "email" TEXT,
      "passwordHash" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "currentNodeKey" TEXT NOT NULL,
      "ownerUserId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "ConversationMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "artifactRefsJson" TEXT NOT NULL DEFAULT '[]',
      "metadataJson" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function createLegacyFeedbackTableWithoutUniqueIndex(db: Database.Database) {
  db.exec(`
    CREATE TABLE "FeedbackRecord" (
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
      "submittedAt" DATETIME
    );
  `);
}

function insertFeedbackFixture(
  db: Database.Database,
  input: { id: string; receipt: string; idempotencyKey: string },
) {
  db.prepare(`
    INSERT INTO "FeedbackRecord" (
      id, receipt, category, description, status, idempotencyKey, requestFingerprint, origin,
      pageRoute, appVersion, clientContextJson, stagingKey, createdByUserId, updatedAt
    ) VALUES (?, ?, 'bug', 'description', 'submitted', ?, 'fingerprint', 'global', '/', '0.1.0', '{}', ?, 'teacher-1', ?)
  `).run(input.id, input.receipt, input.idempotencyKey, `stage-${input.id}`, "2026-07-10T00:00:00.000Z");
}

function tableNames(db: Database.Database) {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
}

function indexNames(db: Database.Database, table: string) {
  return (db.prepare(`PRAGMA index_list("${table}")`).all() as Array<{ name: string }>).map((row) => row.name);
}

function column(db: Database.Database, table: string, name: string) {
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; notnull: number }>).find((entry) => entry.name === name);
}

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

const root = process.cwd();
const testRoot = path.join(root, ".tmp", "legacy-artifact-reapproval-tests");
const createdDatabasePaths: string[] = [];
const createdClients: PrismaClient[] = [];

afterEach(async () => {
  await Promise.allSettled(createdClients.splice(0).map((client) => client.$disconnect()));
  for (const databasePath of createdDatabasePaths.splice(0)) {
    for (const suffix of ["", "-shm", "-wal"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }
});

describe("legacy approved Artifact migration and reapproval", () => {
  it("moves an unproven legacy approval to review and trusts it only after an explicit teacher reapproval", async () => {
    mkdirSync(testRoot, { recursive: true });
    const databasePath = path.join(testRoot, `legacy-${randomUUID()}.db`);
    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    createdDatabasePaths.push(databasePath);
    createLegacyDatabase(databasePath);

    initializeDatabase(databaseUrl);

    let client = createClient(databaseUrl);
    let service = createWorkbenchService(createPrismaWorkbenchRepository(client));
    const migrated = await service.getArtifact("legacy-project", "legacy-artifact");
    const migratedNode = (await service.getProjectSnapshot("legacy-project")).nodes
      .find((node) => node.key === "requirement_spec");

    expect(migrated).toMatchObject({
      status: "needs_review",
      isApproved: false,
      origin: "legacy",
      markdownContent: "# 历史需求规格",
      structuredContent: {
        teacherNote: "保留历史正文",
        legacyApprovalMigration: {
          schemaVersion: "legacy-artifact-approval-migration.v1",
          reasonCode: "legacy_approval_evidence_missing",
          migratedFromStatus: "approved",
        },
      },
    });
    expect(migratedNode).toMatchObject({
      status: "needs_review",
      approvedArtifactId: null,
    });
    expect(isArtifactTrustedForDownstream(migrated)).toBe(false);

    const reapproved = await service.approveArtifact("legacy-project", "legacy-artifact");
    expect(reapproved).toMatchObject({
      status: "approved",
      isApproved: true,
      origin: "legacy",
      markdownContent: "# 历史需求规格",
      structuredContent: {
        teacherNote: "保留历史正文",
        artifactApprovalEvidence: {
          schemaVersion: "artifact-approval-evidence.v1",
          sourceAuthority: "legacy_reapproved",
          artifactDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          approvedAt: expect.any(String),
        },
      },
    });
    expect(isArtifactTrustedForDownstream(reapproved)).toBe(true);
    expect(isArtifactTrustedForDownstream({
      ...reapproved,
      origin: "legacy",
      structuredContent: {
        ...reapproved.structuredContent,
        artifactApprovalEvidence: {
          ...(reapproved.structuredContent.artifactApprovalEvidence as Record<string, unknown>),
          approvedAt: null,
        },
      },
    })).toBe(false);

    const approvalEvidence = reapproved.structuredContent.artifactApprovalEvidence;
    await client.$disconnect();

    initializeDatabase(databaseUrl);
    client = createClient(databaseUrl);
    service = createWorkbenchService(createPrismaWorkbenchRepository(client));
    const afterSecondInitialization = await service.getArtifact("legacy-project", "legacy-artifact");
    const finalNode = (await service.getProjectSnapshot("legacy-project")).nodes
      .find((node) => node.key === "requirement_spec");

    expect(afterSecondInitialization).toMatchObject({
      status: "approved",
      isApproved: true,
      origin: "legacy",
      structuredContent: { artifactApprovalEvidence: approvalEvidence },
    });
    expect(finalNode).toMatchObject({
      status: "approved",
      approvedArtifactId: "legacy-artifact",
      staleReason: null,
    });
    expect(isArtifactTrustedForDownstream(afterSecondInitialization)).toBe(true);

    await client.$disconnect();
  });

  it("does not idempotently accept an approved row whose approval evidence is missing", async () => {
    mkdirSync(testRoot, { recursive: true });
    const databasePath = path.join(testRoot, `unproven-${randomUUID()}.db`);
    const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
    createdDatabasePaths.push(databasePath);
    createLegacyDatabase(databasePath);
    initializeDatabase(databaseUrl);

    const client = createClient(databaseUrl);
    await client.artifact.update({
      where: { id: "legacy-artifact" },
      data: {
        status: "approved",
        isApproved: true,
        structuredContentJson: JSON.stringify({ teacherNote: "没有当前批准证据" }),
      },
    });
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client));

    await expect(service.approveArtifact("legacy-project", "legacy-artifact"))
      .rejects.toThrow("artifact_truth_not_approvable:approval_evidence_missing");
    const unproven = await service.getArtifact("legacy-project", "legacy-artifact");
    expect(isArtifactTrustedForDownstream(unproven)).toBe(false);
  });
});

function createLegacyDatabase(databasePath: string) {
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "currentNodeKey" TEXT NOT NULL,
      "grade" TEXT,
      "subject" TEXT,
      "textbookVersion" TEXT,
      "lessonTopic" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "Artifact" (
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
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "WorkflowNode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "key" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'not_started',
      "order" INTEGER NOT NULL,
      "upstreamNodeKeysJson" TEXT NOT NULL DEFAULT '[]',
      "approvedArtifactId" TEXT,
      "staleReason" TEXT,
      "updatedAt" DATETIME NOT NULL
    );
    INSERT INTO "Project" (
      "id", "title", "currentNodeKey", "grade", "subject", "lessonTopic", "updatedAt"
    ) VALUES (
      'legacy-project', '历史项目', 'requirement_spec', '五年级', '数学', '历史课题', CURRENT_TIMESTAMP
    );
    INSERT INTO "Artifact" (
      "id", "projectId", "nodeKey", "title", "kind", "status", "summary",
      "markdownContent", "structuredContentJson", "version", "isApproved", "updatedAt"
    ) VALUES (
      'legacy-artifact', 'legacy-project', 'requirement_spec', '历史需求规格', 'requirement_spec',
      'approved', '历史批准记录', '# 历史需求规格', '{"teacherNote":"保留历史正文"}', 1, 1, CURRENT_TIMESTAMP
    );
    INSERT INTO "WorkflowNode" (
      "id", "projectId", "key", "title", "status", "order", "upstreamNodeKeysJson",
      "approvedArtifactId", "staleReason", "updatedAt"
    ) VALUES (
      'legacy-node', 'legacy-project', 'requirement_spec', '需求规格', 'approved', 1, '[]',
      'legacy-artifact', NULL, CURRENT_TIMESTAMP
    );
  `);
  db.close();
}

function initializeDatabase(databaseUrl: string) {
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Legacy database initialization failed.");
  }
}

function createClient(databaseUrl: string) {
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  createdClients.push(client);
  return client;
}

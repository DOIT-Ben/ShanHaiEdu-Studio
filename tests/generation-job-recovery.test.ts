import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { createValidationReport, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { VideoTaskPersistenceUnknownError, executeRecoverableVideoTask } from "@/server/video-generation/video-generation-run";
import { GenerationJobIdempotencyConflictError, createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "stage1b-tests");
const databasePath = path.join(stageRoot, `generation-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let clientA: PrismaClient;
let clientB: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Stage 1B test database initialization failed.");
  }
  clientA = createClient();
  clientB = createClient();
});

afterAll(async () => {
  await Promise.allSettled([clientA?.$disconnect(), clientB?.$disconnect()]);
  removeSqliteFiles(databasePath);
});

describe("V1 Stage 1B canonical run input", () => {
  it("keeps object key order stable but preserves meaningful array order", () => {
    expect(hashRunInput({ b: 2, a: { y: 2, x: 1 } })).toBe(hashRunInput({ a: { x: 1, y: 2 }, b: 2 }));
    expect(hashRunInput({ shots: ["a", "b"] })).not.toBe(hashRunInput({ shots: ["b", "a"] }));
  });
});

describe("V1 Stage 1B recoverable video task", () => {
  it("polls an existing task id without submitting again", async () => {
    let submits = 0;
    let polls = 0;
    const result = await executeRecoverableVideoTask({
      providerTaskId: "persisted-task",
      submit: async () => {
        submits += 1;
        return "new-task";
      },
      poll: async (taskId) => {
        polls += 1;
        return `completed:${taskId}`;
      },
    });

    expect(result).toBe("completed:persisted-task");
    expect({ submits, polls }).toEqual({ submits: 0, polls: 1 });
  });

  it("does not poll when an accepted task id cannot be persisted", async () => {
    let submits = 0;
    let polls = 0;
    await expect(executeRecoverableVideoTask({
      submit: async () => {
        submits += 1;
        return "accepted-task";
      },
      onTaskAccepted: async () => {
        throw new Error("database unavailable");
      },
      poll: async () => {
        polls += 1;
        return "must-not-run";
      },
    })).rejects.toBeInstanceOf(VideoTaskPersistenceUnknownError);

    expect({ submits, polls }).toEqual({ submits: 1, polls: 0 });
  });
});

describe("V1 Stage 1B GenerationJob idempotency and recovery", () => {
  it("reuses the same job and snapshot for the same key and input hash", async () => {
    const fixture = await createProjectArtifact(clientA, "same-input");
    const repository = createPrismaWorkbenchRepository(clientA);
    const input = {
      kind: "video" as const,
      capabilityId: "video_segment_generate",
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "video:stable-run",
      inputSnapshot: { prompt: "same prompt", durationSeconds: 6 },
    };

    const first = await repository.createGenerationJob(fixture.project.id, input);
    const second = await repository.createGenerationJob(fixture.project.id, input);

    expect(second.id).toBe(first.id);
    expect(second.runInputSnapshotId).toBe(first.runInputSnapshotId);
    expect(second.inputHash).toBe(first.inputHash);
    expect(await clientA.generationJob.count({ where: { projectId: fixture.project.id } })).toBe(1);
  });

  it("rejects the same key with a different input hash", async () => {
    const fixture = await createProjectArtifact(clientA, "conflicting-input");
    const repository = createPrismaWorkbenchRepository(clientA);
    await repository.createGenerationJob(fixture.project.id, {
      kind: "image",
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "image:conflict",
      inputSnapshot: { prompt: "first" },
    });

    await expect(repository.createGenerationJob(fixture.project.id, {
      kind: "image",
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "image:conflict",
      inputSnapshot: { prompt: "second" },
    })).rejects.toBeInstanceOf(GenerationJobIdempotencyConflictError);
    expect(await clientA.generationJob.count({ where: { projectId: fixture.project.id } })).toBe(1);
  });

  it("converges two independent clients on one job id", async () => {
    const fixture = await createProjectArtifact(clientA, "concurrent-input");
    const input = {
      kind: "pptx" as const,
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "pptx:concurrent",
      inputSnapshot: { slideCount: 12 },
    };

    const [jobA, jobB] = await Promise.all([
      createPrismaWorkbenchRepository(clientA).createGenerationJob(fixture.project.id, input),
      createPrismaWorkbenchRepository(clientB).createGenerationJob(fixture.project.id, input),
    ]);

    expect(jobA.id).toBe(jobB.id);
    expect(await clientA.generationJob.count({ where: { projectId: fixture.project.id } })).toBe(1);
  });

  it("resumes a persisted provider task in polling state", async () => {
    const fixture = await createProjectArtifact(clientA, "provider-resume");
    const repository = createPrismaWorkbenchRepository(clientA);
    const queued = await repository.createGenerationJob(fixture.project.id, {
      kind: "video",
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "video:resume",
    });
    const submitting = await repository.startGenerationJob(fixture.project.id, queued.id);
    const accepted = await repository.recordGenerationProviderTask(fixture.project.id, queued.id, { providerTaskId: "provider-task-1" });
    const resumed = await repository.startGenerationJob(fixture.project.id, queued.id);

    expect(submitting).toMatchObject({ status: "running", pollState: "submitting", providerTaskId: null });
    expect(accepted).toMatchObject({ status: "running", pollState: "polling", providerTaskId: "provider-task-1" });
    expect(resumed).toMatchObject({ status: "running", pollState: "polling", providerTaskId: "provider-task-1" });
  });

  it("moves an ambiguous submitting job to submission_unknown and blocks another start", async () => {
    const fixture = await createProjectArtifact(clientA, "submission-unknown");
    const repository = createPrismaWorkbenchRepository(clientA);
    const queued = await repository.createGenerationJob(fixture.project.id, {
      kind: "video",
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "video:unknown",
    });
    await repository.startGenerationJob(fixture.project.id, queued.id);
    const unknown = await repository.startGenerationJob(fixture.project.id, queued.id);

    expect(unknown).toMatchObject({ status: "submission_unknown", pollState: "submission_unknown", providerTaskId: null });
    await expect(repository.startGenerationJob(fixture.project.id, queued.id)).resolves.toMatchObject({
      status: "submission_unknown",
      pollState: "submission_unknown",
    });
  });

  it("persists a terminal Provider unit result without creating an Artifact commit", async () => {
    const fixture = await createProjectArtifact(clientA, "provider-unit-result");
    const repository = createPrismaWorkbenchRepository(clientA);
    const queued = await repository.createGenerationJob(fixture.project.id, {
      kind: "image",
      sourceArtifactId: fixture.artifact.id,
      unitId: "asset-1",
      idempotencyKey: "ppt-asset:unit-1",
      inputSnapshot: {
        batchDigest: "batch-1",
        request: { assetId: "asset-1", inputHash: "request-1", transparentBackground: true },
      },
      createStagedArtifactCommit: false,
    });
    await repository.startGenerationJob(fixture.project.id, queued.id);
    const fileEvidence = {
      fileName: "asset-1.png", storageRef: "image-artifacts/asset-1.png", sha256: "a".repeat(64),
      bytes: 1024, width: 1024, height: 1024, mime: "image/png",
    };
    const result = JSON.stringify({
      schemaVersion: "ppt-asset-unit-result.v1", batchDigest: "batch-1", assetId: "asset-1", requestInputHash: "request-1",
      result: {
        ...fileEvidence, provider: "minimax", model: "test-model", clientRequestId: "client-1",
        providerRequestId: null, providerTaskId: null, sentReferenceAssetIds: [], transparentBackgroundVerified: true,
        rawAsset: fileEvidence, normalizedAsset: fileEvidence,
      },
    });

    const completed = await repository.completeGenerationUnit(fixture.project.id, queued.id, { providerResultJson: result });

    expect(completed).toMatchObject({
      status: "succeeded",
      pollState: "completed",
      providerResultJson: result,
      resultArtifactId: null,
    });
    expect(await clientA.stagedArtifactCommit.count({ where: { generationJobId: queued.id } })).toBe(0);
  });

  it("quarantines completion after the project intent epoch advances", async () => {
    const fixture = await createProjectArtifact(clientA, "stale-epoch");
    const repository = createPrismaWorkbenchRepository(clientA);
    const queued = await repository.createGenerationJob(fixture.project.id, {
      kind: "image",
      sourceArtifactId: fixture.artifact.id,
      idempotencyKey: "image:old-epoch",
    });
    await repository.startGenerationJob(fixture.project.id, queued.id);
    await repository.regenerateArtifact(fixture.project.id, fixture.artifact.id, {
      summary: "Teacher changed the upstream outline.",
      markdownContent: "# Updated upstream outline",
      expectedLatestVersion: 1,
    });

    const staleDraft = {
      nodeKey: "image_prompts" as const,
      kind: "image_prompts" as const,
      title: "Stale image result",
      status: "needs_review" as const,
      summary: "Must remain quarantined.",
      markdownContent: "# Stale",
    };
    const completed = await repository.stageGenerationResult(fixture.project.id, queued.id, {
      ...staleDraft,
      validationReport: createValidationReport({
        reportId: `validation-${queued.id}`,
        createdAt: new Date().toISOString(),
        domain: "ppt",
        stage: "image_asset",
        target: { kind: "artifact_draft", targetDigest: hashArtifactDraft(staleDraft) },
        contract: { id: "tool:generate_classroom_image", version: "tool-v1" },
        inputHash: queued.inputHash ?? undefined,
        intentEpoch: queued.intentEpoch,
        overallStatus: "passed",
        gates: [],
      }),
    });

    expect(completed).toMatchObject({ status: "quarantined", reason: "stale_intent", job: { intentEpoch: 0 } });
    expect(await clientA.artifact.count({ where: { projectId: fixture.project.id, kind: "image_prompts" } })).toBe(0);
    expect((await clientA.project.findUniqueOrThrow({ where: { id: fixture.project.id } })).intentEpoch).toBe(1);
  });
});

describe("V1 Stage 1B SQLite upgrade", () => {
  it("does not create retired orchestration tables in a new database", () => {
    const inspected = new Database(databasePath, { readonly: true });
    const tables = inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    inspected.close();

    expect(tables.map((table) => table.name)).not.toContain("WorkflowNode");
    expect(tables.map((table) => table.name)).not.toContain("AgentRun");
  });

  it("preserves a legacy GenerationJob while adding recovery columns and indexes", () => {
    const legacyPath = path.join(stageRoot, `legacy-${randomUUID()}.db`);
    const legacyUrl = `file:${legacyPath.replaceAll("\\", "/")}`;
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE "Project" (
        "id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active', "currentNodeKey" TEXT NOT NULL,
        "ownerUserId" TEXT, "grade" TEXT, "subject" TEXT, "textbookVersion" TEXT,
        "lessonTopic" TEXT, "archivedAt" DATETIME, "deletedAt" DATETIME,
        "lifecycleVersion" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "Artifact" (
        "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "nodeKey" TEXT NOT NULL,
        "title" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
        "summary" TEXT NOT NULL, "markdownContent" TEXT NOT NULL,
        "structuredContentJson" TEXT NOT NULL DEFAULT '{}', "version" INTEGER NOT NULL,
        "isApproved" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "GenerationJob" (
        "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "kind" TEXT NOT NULL,
        "sourceArtifactId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
        "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 2,
        "resultArtifactId" TEXT, "errorMessage" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
        "startedAt" DATETIME, "finishedAt" DATETIME
      );
      INSERT INTO "Project" ("id", "title", "currentNodeKey", "updatedAt")
      VALUES ('legacy-project', 'Legacy', 'requirement_spec', CURRENT_TIMESTAMP);
      INSERT INTO "Artifact" (
        "id", "projectId", "nodeKey", "title", "kind", "status", "summary",
        "markdownContent", "version", "updatedAt"
      ) VALUES (
        'legacy-artifact', 'legacy-project', 'ppt_draft', 'Legacy artifact', 'ppt_draft',
        'approved', 'Legacy', '# Legacy', 1, CURRENT_TIMESTAMP
      );
      INSERT INTO "GenerationJob" (
        "id", "projectId", "kind", "sourceArtifactId", "status", "updatedAt"
      ) VALUES ('legacy-job', 'legacy-project', 'image', 'legacy-artifact', 'failed', CURRENT_TIMESTAMP);
    `);
    legacy.close();

    try {
      const upgraded = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: legacyUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
        encoding: "utf8",
      });
      expect(upgraded.status, upgraded.stderr || upgraded.stdout).toBe(0);
      const inspected = new Database(legacyPath, { readonly: true });
      const columns = inspected.prepare('PRAGMA table_info("GenerationJob")').all() as Array<{ name: string }>;
      const projectColumns = inspected.prepare('PRAGMA table_info("Project")').all() as Array<{ name: string }>;
      const preserved = inspected.prepare('SELECT "id", "status", "sourceArtifactId" FROM "GenerationJob" WHERE "id" = ?').get("legacy-job");
      const tables = inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const indexes = inspected.prepare('PRAGMA index_list("GenerationJob")').all() as Array<{ name: string }>;
      inspected.close();

      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "runInputSnapshotId", "intentEpoch", "idempotencyKey", "inputHash",
        "providerTaskId", "pollState", "providerAcceptedAt", "lastPolledAt",
      ]));
      expect(projectColumns.map((column) => column.name)).toContain("intentEpoch");
      expect(preserved).toEqual({ id: "legacy-job", status: "failed", sourceArtifactId: "legacy-artifact" });
      expect(tables.map((table) => table.name)).toContain("RunInputSnapshot");
      expect(indexes.map((index) => index.name)).toContain("GenerationJob_projectId_idempotencyKey_key");
    } finally {
      removeSqliteFiles(legacyPath);
    }
  });
});

function createClient() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

async function createProjectArtifact(client: PrismaClient, label: string) {
  const project = await client.project.create({
    data: { id: `${label}-${randomUUID()}`, title: label, currentNodeKey: "requirement_spec" },
  });
  const artifact = await client.artifact.create({
    data: {
      projectId: project.id,
      nodeKey: "ppt_draft",
      title: label,
      kind: "ppt_draft",
      status: "approved",
      summary: label,
      markdownContent: `# ${label}`,
      version: 1,
      isApproved: true,
    },
  });
  return { project, artifact };
}

function removeSqliteFiles(databasePath: string) {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

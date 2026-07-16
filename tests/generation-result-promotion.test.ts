import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createProjectExecutionLeaseRepository } from "@/server/execution/project-execution-lease";
import { createValidationReport, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "stage1c-tests");
const databasePath = path.join(stageRoot, `promotion-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let clientA: PrismaClient;
let clientB: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  initializeDatabase(databaseUrl);
  clientA = createClient();
  clientB = createClient();
});

afterAll(async () => {
  await Promise.allSettled([clientA?.$disconnect(), clientB?.$disconnect()]);
  rmSync(databasePath, { force: true });
});

describe("V1 Stage 1C atomic generation result promotion", () => {
  it("keeps a staged result invisible after commit failure and promotes exactly once after recovery", async () => {
    const fixture = await createFixture(clientA, "atomic-recovery");
    const repository = createPrismaWorkbenchRepository(clientA);
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "pptx",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "coze_ppt",
    });
    await repository.startGenerationJob(fixture.projectId, job.id);
    const pptxDraft = {
      nodeKey: "pptx_artifact" as const,
      kind: "pptx_artifact" as const,
      title: "真实 PPTX",
      status: "needs_review" as const,
      summary: "已生成并校验。",
      markdownContent: "# 真实 PPTX",
      structuredContent: {
        storage: {
          cozePptx: {
            localOutput: "artifact-storage/coze-ppt-artifacts/result.pptx",
            duplicate: { localOutput: "artifact-storage/coze-ppt-artifacts/result.pptx" },
            unsafe: { localOutput: "../outside.pptx" },
          },
        },
      },
    };
    const staged = await repository.stageGenerationResult(fixture.projectId, job.id, validatedResult(job, pptxDraft));

    expect(staged.stage).toMatchObject({ state: "staged" });
    expect(JSON.parse(staged.stage.storageRefsJson)).toEqual(["artifact-storage/coze-ppt-artifacts/result.pptx"]);

    const raw = new Database(databasePath);
    raw.exec(`
      CREATE TRIGGER "stage1c_fail_job_finish"
      BEFORE UPDATE OF "status" ON "GenerationJob"
      WHEN NEW."status" = 'succeeded'
      BEGIN
        SELECT RAISE(ABORT, 'stage1c forced commit failure');
      END;
    `);
    raw.close();

    await expect(repository.promoteStagedGenerationResult(fixture.projectId, job.id)).rejects.toThrow();
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "pptx_artifact" } })).toBe(0);
    expect(await clientA.validationReportRecord.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      overallStatus: "passed",
      artifactId: null,
    });
    expect(await clientA.generationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "running",
      resultArtifactId: null,
    });
    expect(await clientA.stagedArtifactCommit.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      state: "staged",
      resultArtifactId: null,
    });
    expect(await clientA.workflowNode.findUniqueOrThrow({
      where: { projectId_key: { projectId: fixture.projectId, key: "pptx_artifact" } },
    })).toMatchObject({ status: "not_started" });

    const recoveryRaw = new Database(databasePath);
    recoveryRaw.exec('DROP TRIGGER "stage1c_fail_job_finish"');
    recoveryRaw.close();

    const first = await repository.promoteStagedGenerationResult(fixture.projectId, job.id);
    const second = await repository.promoteStagedGenerationResult(fixture.projectId, job.id);
    expect(first.status).toBe("committed");
    expect(second.status).toBe("committed");
    if (first.status !== "committed" || second.status !== "committed") throw new Error("Expected committed result.");
    expect(second.artifact.id).toBe(first.artifact.id);
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "pptx_artifact" } })).toBe(1);
    expect(first.artifact.version).toBe(1);
    expect(await clientA.generationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "succeeded",
      resultArtifactId: first.artifact.id,
    });
    expect(await clientA.stagedArtifactCommit.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      state: "committed",
      resultArtifactId: first.artifact.id,
    });
    expect(await clientA.validationReportRecord.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      artifactId: first.artifact.id,
      stagedArtifactCommitId: staged.stage.id,
    });
    expect(await clientA.validationReportRecord.count({ where: { generationJobId: job.id } })).toBe(1);
  });

  it.each([
    ["input hash", { inputHash: "wrong-input-hash" }, "validation_input_hash_mismatch"],
    ["intent epoch", { intentEpoch: 99 }, "validation_intent_epoch_mismatch"],
  ])("quarantines a ValidationReport with a mismatched %s", async (_label, overrides, expectedReason) => {
    const fixture = await createFixture(clientA, `validation-mismatch-${_label}`);
    const repository = createPrismaWorkbenchRepository(clientA);
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "image_asset",
    });
    await repository.startGenerationJob(fixture.projectId, job.id);

    const result = await repository.stageGenerationResult(
      fixture.projectId,
      job.id,
      validatedResult(job, resultDraft("image_prompts"), overrides),
    );

    expect(result).toMatchObject({ status: "quarantined", reason: expectedReason });
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "image_prompts" } })).toBe(0);
    expect(await clientA.validationReportRecord.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      overallStatus: "passed",
      artifactId: null,
    });
  });

  it("quarantines a staged Provider result when ValidationReport is missing at runtime", async () => {
    const fixture = await createFixture(clientA, "validation-report-missing");
    const repository = createPrismaWorkbenchRepository(clientA);
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "image_asset",
    });
    await repository.startGenerationJob(fixture.projectId, job.id);

    const result = await repository.stageGenerationResult(
      fixture.projectId,
      job.id,
      resultDraft("image_prompts") as never,
    );

    expect(result).toMatchObject({ status: "quarantined", reason: "validation_report_missing" });
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "image_prompts" } })).toBe(0);
    expect(await clientA.validationReportRecord.count({ where: { generationJobId: job.id } })).toBe(0);
  });

  it("reuses one staged report when a semantic retry changes only report identity", async () => {
    const fixture = await createFixture(clientA, "validation-report-semantic-retry");
    const repository = createPrismaWorkbenchRepository(clientA);
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "image_asset",
    });
    await repository.startGenerationJob(fixture.projectId, job.id);
    const draft = resultDraft("image_prompts");
    const first = validatedResult(job, draft);
    const second = validatedResult(job, draft);
    expect(second.validationReport.reportId).not.toBe(first.validationReport.reportId);
    expect(second.validationReport.reportDigest).toBe(first.validationReport.reportDigest);

    expect(await repository.stageGenerationResult(fixture.projectId, job.id, first)).toMatchObject({ stage: { state: "staged" } });
    expect(await repository.stageGenerationResult(fixture.projectId, job.id, second)).toMatchObject({ stage: { state: "staged" } });
    expect(await clientA.validationReportRecord.count({ where: { generationJobId: job.id } })).toBe(1);
    expect(await clientA.validationReportRecord.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      id: first.validationReport.reportId,
      reportDigest: first.validationReport.reportDigest,
    });
  });

  it("commits an internal Artifact and ValidationReport atomically and rejects a mismatched target", async () => {
    const fixture = await createFixture(clientA, "internal-validation-atomicity");
    const repository = createPrismaWorkbenchRepository(clientA);
    const draft = {
      nodeKey: "lesson_plan" as const,
      kind: "lesson_plan" as const,
      title: "结构化教案",
      status: "needs_review" as const,
      summary: "已生成结构化教案。",
      markdownContent: "# 教案",
      structuredContent: { objectives: ["理解概念"] },
    };
    const report = internalValidationReport("lesson_plan", draft);

    const artifact = await repository.saveArtifact(fixture.projectId, { ...draft, validationReport: report });

    expect(await clientA.validationReportRecord.findUniqueOrThrow({ where: { artifactId: artifact.id } })).toMatchObject({
      id: report.reportId,
      overallStatus: "passed",
      reportDigest: report.reportDigest,
    });
    expect(await clientA.workflowNode.findUniqueOrThrow({
      where: { projectId_key: { projectId: fixture.projectId, key: "lesson_plan" } },
    })).toMatchObject({ status: "needs_review" });

    const mismatchedReport = internalValidationReport("lesson_plan", { ...draft, summary: "另一份内容" });
    await expect(repository.saveArtifact(fixture.projectId, { ...draft, validationReport: mismatchedReport }))
      .rejects.toThrow("validation_target_digest_mismatch");
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "lesson_plan" } })).toBe(1);
    expect(await clientA.validationReportRecord.count({ where: { projectId: fixture.projectId, stage: "lesson_plan" } })).toBe(1);
  });

  it("quarantines stale intent before an Artifact becomes visible", async () => {
    const fixture = await createFixture(clientA, "stale-intent");
    const repository = createPrismaWorkbenchRepository(clientA);
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "image_asset",
    });
    await repository.startGenerationJob(fixture.projectId, job.id);
    await repository.stageGenerationResult(fixture.projectId, job.id, validatedResult(job, resultDraft("image_prompts")));
    await repository.advanceProjectIntentEpoch(fixture.projectId, 0);

    const result = await repository.promoteStagedGenerationResult(fixture.projectId, job.id);

    expect(result).toMatchObject({ status: "quarantined", reason: "stale_intent" });
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "image_prompts" } })).toBe(0);
    expect(await clientA.generationJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "quarantined",
      pollState: "stale_intent",
      resultArtifactId: null,
    });
  });

  it("rejects an old staged result after a newer fence takes over", async () => {
    const userId = `stage1c-user-${randomUUID()}`;
    await clientA.localUser.create({ data: { id: userId, displayName: "Stage 1C Teacher", authMode: "local" } });
    const fixture = await createFixture(clientA, "fence-takeover", userId);
    const repository = createPrismaWorkbenchRepository(clientA);
    const leasesA = createProjectExecutionLeaseRepository(clientA);
    const leasesB = createProjectExecutionLeaseRepository(clientB);
    const leaseA = await leasesA.acquire({ projectId: fixture.projectId, holderId: "old-result-worker", leaseMs: 60_000 });
    const identity = { actorUserId: userId, actorAuthMode: "local" as const, authSessionId: null };
    const guardA = { projectId: fixture.projectId, holderId: "old-result-worker", fencingToken: leaseA!.fencingToken, identity };
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "video",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "video_segment_generate",
    }, guardA);
    await repository.startGenerationJob(fixture.projectId, job.id);
    await repository.stageGenerationResult(fixture.projectId, job.id, validatedResult(job, resultDraft("video_segment_generate")), guardA);

    await clientA.projectExecutionLease.update({
      where: { projectId: fixture.projectId },
      data: { leasedUntil: new Date(Date.now() - 1_000) },
    });
    const leaseB = await leasesB.acquire({ projectId: fixture.projectId, holderId: "new-result-worker", leaseMs: 60_000 });
    expect(leaseB?.fencingToken).toBe(leaseA!.fencingToken + 1);

    const result = await repository.promoteStagedGenerationResult(fixture.projectId, job.id, guardA);

    expect(result).toMatchObject({ status: "quarantined", reason: "execution_fence_rejected" });
    expect(await clientA.artifact.count({ where: { projectId: fixture.projectId, nodeKey: "video_segment_generate" } })).toBe(0);
  });

  it("lets a current fence recover a staged result for the exact same execution identity", async () => {
    const userId = `stage1c-recovery-user-${randomUUID()}`;
    await clientA.localUser.create({ data: { id: userId, displayName: "Recovery Teacher", authMode: "local" } });
    const fixture = await createFixture(clientA, "fence-recovery", userId);
    const repository = createPrismaWorkbenchRepository(clientA);
    const leasesA = createProjectExecutionLeaseRepository(clientA);
    const leasesB = createProjectExecutionLeaseRepository(clientB);
    const identity = { actorUserId: userId, actorAuthMode: "local" as const, authSessionId: null };
    const leaseA = await leasesA.acquire({ projectId: fixture.projectId, holderId: "first-recovery-worker", leaseMs: 60_000 });
    const guardA = { projectId: fixture.projectId, holderId: "first-recovery-worker", fencingToken: leaseA!.fencingToken, identity };
    const job = await repository.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: fixture.sourceArtifactId,
      capabilityId: "image_asset",
    }, guardA);
    await repository.startGenerationJob(fixture.projectId, job.id);
    await repository.stageGenerationResult(fixture.projectId, job.id, validatedResult(job, resultDraft("image_prompts")), guardA);

    await clientA.projectExecutionLease.update({
      where: { projectId: fixture.projectId },
      data: { leasedUntil: new Date(Date.now() - 1_000) },
    });
    const leaseB = await leasesB.acquire({ projectId: fixture.projectId, holderId: "second-recovery-worker", leaseMs: 60_000 });
    const guardB = { projectId: fixture.projectId, holderId: "second-recovery-worker", fencingToken: leaseB!.fencingToken, identity };

    const result = await createPrismaWorkbenchRepository(clientB).promoteStagedGenerationResult(fixture.projectId, job.id, guardB);

    expect(result.status).toBe("committed");
    expect(await clientB.stagedArtifactCommit.findUniqueOrThrow({ where: { generationJobId: job.id } })).toMatchObject({
      state: "committed",
      holderId: guardB.holderId,
      fencingToken: guardB.fencingToken,
      actorUserId: userId,
    });
  });
});

describe("V1 Stage 1C integration contracts", () => {
  it("routes artifact endpoints through the control-plane atomic commit while retaining the conversation compatibility path", () => {
    const routePaths = [
      "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route.ts",
      "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route.ts",
      "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts",
    ];
    for (const relativePath of routePaths) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      expect(source).toContain("commitArtifactRouteToolSuccess");
      expect(source).not.toContain("commitGenerationResult");
      expect(source).not.toMatch(/saveArtifact\([\s\S]{0,800}finishGenerationJob/);
      expect(source).toContain("runWithProjectExecutionLease");
    }
    expect(readFileSync(path.join(root, "src/server/conversation/conversation-turn-service.ts"), "utf8"))
      .toContain("commitGenerationResult");
  });

  it("upgrades an existing database additively and idempotently", () => {
    const upgradePath = path.join(stageRoot, `upgrade-${randomUUID()}.db`);
    const upgradeUrl = `file:${upgradePath.replaceAll("\\", "/")}`;
    initializeDatabase(upgradeUrl);
    const existing = new Database(upgradePath);
    existing.prepare(`INSERT INTO "Project" ("id", "title", "currentNodeKey", "updatedAt") VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
      .run("preserved-project", "Preserved", "requirement_spec");
    existing.close();

    try {
      initializeDatabase(upgradeUrl);
      const inspected = new Database(upgradePath, { readonly: true });
      const preserved = inspected.prepare('SELECT "id", "title" FROM "Project" WHERE "id" = ?').get("preserved-project");
      const columns = inspected.prepare('PRAGMA table_info("StagedArtifactCommit")').all() as Array<{ name: string }>;
      const indexes = inspected.prepare('PRAGMA index_list("StagedArtifactCommit")').all() as Array<{ name: string }>;
      const validationColumns = inspected.prepare('PRAGMA table_info("ValidationReportRecord")').all() as Array<{ name: string }>;
      const validationIndexes = inspected.prepare('PRAGMA index_list("ValidationReportRecord")').all() as Array<{ name: string }>;
      inspected.close();
      expect(preserved).toEqual({ id: "preserved-project", title: "Preserved" });
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "generationJobId", "state", "storageRefsJson", "intentEpoch", "inputHash", "fencingToken",
        "actorUserId", "actorAuthMode", "authSessionId", "resultArtifactId",
      ]));
      expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
        "StagedArtifactCommit_generationJobId_key",
        "StagedArtifactCommit_resultArtifactId_key",
        "StagedArtifactCommit_projectId_state_createdAt_idx",
      ]));
      expect(validationColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "projectId", "capabilityId", "targetDigest", "inputHash", "intentEpoch", "reportDigest",
        "artifactId", "generationJobId", "stagedArtifactCommitId", "payloadJson",
      ]));
      expect(validationIndexes.map((index) => index.name)).toEqual(expect.arrayContaining([
        "ValidationReportRecord_artifactId_key",
        "ValidationReportRecord_generationJobId_key",
        "ValidationReportRecord_stagedArtifactCommitId_key",
        "ValidationReportRecord_projectId_stage_createdAt_idx",
      ]));
    } finally {
      rmSync(upgradePath, { force: true });
    }
  });
});

function initializeDatabase(url: string) {
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Stage 1C test database initialization failed.");
  }
}

function createClient() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

async function createFixture(client: PrismaClient, label: string, ownerUserId?: string) {
  const repository = createPrismaWorkbenchRepository(client);
  const project = await repository.createProject({ title: label, ownerUserId });
  const source = await repository.saveArtifact(project.id, {
    nodeKey: "ppt_design_draft",
    kind: "ppt_design_draft",
    title: `${label} source`,
    status: "approved",
    summary: label,
    markdownContent: `# ${label}`,
  });
  return { projectId: project.id, sourceArtifactId: source.id };
}

function resultDraft(nodeKey: "image_prompts" | "video_segment_generate") {
  return {
    nodeKey,
    kind: nodeKey,
    title: `${nodeKey} result`,
    status: "needs_review" as const,
    summary: "Verified Provider result.",
    markdownContent: "# Result",
    structuredContent: {},
  };
}

function validatedResult(
  job: { id: string; inputHash: string | null; intentEpoch: number },
  draft: {
    nodeKey: "pptx_artifact" | "image_prompts" | "video_segment_generate";
    kind: "pptx_artifact" | "image_prompts" | "video_segment_generate";
    title: string;
    status: "needs_review";
    summary: string;
    markdownContent: string;
    structuredContent?: Record<string, unknown>;
  },
  overrides: { inputHash?: string; intentEpoch?: number } = {},
) {
  const stage = draft.kind === "pptx_artifact"
    ? "coze_ppt"
    : draft.kind === "image_prompts"
      ? "image_asset"
      : "video_segment_generate";
  const domain = draft.kind === "video_segment_generate" ? "video" as const : "ppt" as const;
  return {
    ...draft,
    validationReport: createValidationReport({
      reportId: `validation-${job.id}-${randomUUID()}`,
      createdAt: new Date().toISOString(),
      domain,
      stage,
      target: { kind: "artifact_draft", targetDigest: hashArtifactDraft(draft) },
      contract: { id: `tool:${stage}`, version: "tool-v1" },
      inputHash: overrides.inputHash ?? job.inputHash ?? undefined,
      intentEpoch: overrides.intentEpoch ?? job.intentEpoch,
      overallStatus: "passed",
      gates: [],
    }),
  };
}

function internalValidationReport(
  stage: string,
  draft: {
    nodeKey: string;
    kind: string;
    title: string;
    summary: string;
    markdownContent: string;
    structuredContent?: Record<string, unknown>;
  },
) {
  return createValidationReport({
    reportId: `validation-internal-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    domain: "lesson",
    stage,
    target: { kind: "artifact_draft", targetDigest: hashArtifactDraft(draft) },
    contract: { id: `tool:${stage}`, version: "tool-v1" },
    overallStatus: "passed",
    gates: [],
  });
}

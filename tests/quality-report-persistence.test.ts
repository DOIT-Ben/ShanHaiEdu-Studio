import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createValidationReport, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { createProjectExecutionLeaseRepository } from "@/server/execution/project-execution-lease";
import { createCriticReport, resolveEffectiveRubric } from "@/server/quality/critic-report";
import { decideQuality } from "@/server/quality/quality-decision-engine";
import { createQualityReportRepository } from "@/server/quality/quality-report-repository";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "stage2b-tests");
const databasePath = path.join(stageRoot, `quality-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout);
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  rmSync(databasePath, { force: true });
});

describe("V1 Stage 2B quality report persistence", () => {
  it("persists CriticReport and QualityDecision atomically under the current fence", async () => {
    const fixture = await createFixture("quality-atomic");
    const quality = createQualityReportRepository(client);

    const persisted = await quality.persistQualityReview({
      projectId: fixture.projectId,
      criticReport: fixture.critic,
      qualityDecision: fixture.decision,
      rubric: fixture.rubric,
      guard: fixture.guard,
    });

    expect(persisted.criticReport).toMatchObject({ artifactId: fixture.artifactId, reportDigest: fixture.critic.reportDigest });
    expect(persisted.qualityDecision).toMatchObject({
      artifactId: fixture.artifactId,
      criticReportId: persisted.criticReport.id,
      decisionDigest: fixture.decision.decisionDigest,
      outcome: "pass",
      nextAction: "continue_downstream",
      deliveryEligibility: "final_candidate",
    });
    expect(await client.artifact.findUnique({ where: { id: fixture.artifactId } })).toMatchObject({
      status: "needs_review",
      isApproved: false,
    });
  });

  it("rolls back the CriticReport when QualityDecision persistence fails", async () => {
    const fixture = await createFixture("quality-rollback");
    const raw = new Database(databasePath);
    raw.exec(`
      CREATE TRIGGER "stage2b_fail_decision_insert"
      BEFORE INSERT ON "QualityDecisionRecord"
      BEGIN
        SELECT RAISE(ABORT, 'stage2b forced decision failure');
      END;
    `);
    raw.close();

    try {
      await expect(createQualityReportRepository(client).persistQualityReview({
        projectId: fixture.projectId,
        criticReport: fixture.critic,
        qualityDecision: fixture.decision,
        rubric: fixture.rubric,
        guard: fixture.guard,
      })).rejects.toThrow();
      expect(await client.criticReportRecord.count({ where: { projectId: fixture.projectId } })).toBe(0);
      expect(await client.qualityDecisionRecord.count({ where: { projectId: fixture.projectId } })).toBe(0);
    } finally {
      const cleanup = new Database(databasePath);
      cleanup.exec('DROP TRIGGER IF EXISTS "stage2b_fail_decision_insert"');
      cleanup.close();
    }
  });

  it("rejects an old target after a newer Artifact version exists", async () => {
    const fixture = await createFixture("quality-stale-target");
    const repository = createPrismaWorkbenchRepository(client);
    await repository.saveArtifact(fixture.projectId, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "新版逐页设计稿",
      status: "needs_review",
      summary: "教师已修改内容。",
      markdownContent: "# 新版教案",
    });

    await expect(createQualityReportRepository(client).persistQualityReview({
      projectId: fixture.projectId,
      criticReport: fixture.critic,
      qualityDecision: fixture.decision,
      rubric: fixture.rubric,
      guard: fixture.guard,
    })).rejects.toThrow(/current Artifact version/i);
    expect(await client.criticReportRecord.count({ where: { projectId: fixture.projectId } })).toBe(0);
    expect(await client.qualityDecisionRecord.count({ where: { projectId: fixture.projectId } })).toBe(0);
  });

  it("reuses semantic reports when only report and decision identity change", async () => {
    const fixture = await createFixture("quality-idempotent");
    const quality = createQualityReportRepository(client);
    const first = await quality.persistQualityReview({
      projectId: fixture.projectId,
      criticReport: fixture.critic,
      qualityDecision: fixture.decision,
      rubric: fixture.rubric,
      guard: fixture.guard,
    });
    const retried = buildReview({
      artifactId: fixture.artifactId,
      artifactVersion: 1,
      artifactDigest: fixture.artifactDigest,
      validationId: fixture.validationId,
      validationDigest: fixture.validationDigest,
    });
    expect(retried.critic.reportId).not.toBe(fixture.critic.reportId);
    expect(retried.critic.reportDigest).toBe(fixture.critic.reportDigest);
    expect(retried.decision.decisionDigest).toBe(fixture.decision.decisionDigest);

    const second = await quality.persistQualityReview({
      projectId: fixture.projectId,
      criticReport: retried.critic,
      qualityDecision: retried.decision,
      rubric: retried.rubric,
      guard: fixture.guard,
    });

    expect(second.criticReport.id).toBe(first.criticReport.id);
    expect(second.qualityDecision.id).toBe(first.qualityDecision.id);
    expect(await client.criticReportRecord.count({ where: { projectId: fixture.projectId } })).toBe(1);
    expect(await client.qualityDecisionRecord.count({ where: { projectId: fixture.projectId } })).toBe(1);
  });
});

async function createFixture(label: string) {
  const userId = `quality-user-${randomUUID()}`;
  await client.localUser.create({ data: { id: userId, displayName: "Quality Reviewer", authMode: "local" } });
  const repository = createPrismaWorkbenchRepository(client);
  const project = await repository.createProject({ title: label, ownerUserId: userId });
  const draft = {
    nodeKey: "ppt_design_draft" as const,
    kind: "ppt_design_draft" as const,
    title: "逐页 PPT 设计稿",
    status: "needs_review" as const,
    summary: "已生成逐页 PPT 设计稿。",
    markdownContent: "# 逐页 PPT 设计稿",
    structuredContent: { objectives: ["理解概念"] },
  };
  const artifactDigest = hashArtifactDraft(draft);
  const validation = createValidationReport({
    reportId: `validation-${randomUUID()}`,
    createdAt: "2026-07-12T00:00:00.000Z",
    domain: "ppt",
    stage: "ppt_design",
    target: { kind: "artifact_draft", targetDigest: artifactDigest },
    contract: { id: "tool:create_ppt_design_draft", version: "tool-v1" },
    overallStatus: "passed",
    gates: [],
  });
  const artifact = await repository.saveArtifact(project.id, { ...draft, validationReport: validation });
  const review = buildReview({
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    artifactDigest,
    validationId: validation.reportId,
    validationDigest: validation.reportDigest,
  });
  const lease = await createProjectExecutionLeaseRepository(client).acquire({
    projectId: project.id,
    holderId: `quality-holder-${randomUUID()}`,
    leaseMs: 60_000,
  });
  if (!lease) throw new Error("Expected quality persistence lease.");
  const guard = {
    projectId: project.id,
    holderId: lease.holderId,
    fencingToken: lease.fencingToken,
    identity: { actorUserId: userId, actorAuthMode: "local" as const, authSessionId: null },
  };
  return {
    projectId: project.id,
    artifactId: artifact.id,
    artifactDigest,
    validationId: validation.reportId,
    validationDigest: validation.reportDigest,
    guard,
    ...review,
  };
}

function buildReview(input: {
  artifactId: string;
  artifactVersion: number;
  artifactDigest: string;
  validationId: string;
  validationDigest: string;
}) {
  const rubric = resolveEffectiveRubric("ppt_final");
  const target = {
    artifactId: input.artifactId,
    artifactVersion: input.artifactVersion,
    artifactDigest: input.artifactDigest,
    productionPath: "ppt_quality_asset_assembly",
  };
  const critic = createCriticReport({
    reportId: `critic-${randomUUID()}`,
    createdAt: "2026-07-12T00:01:00.000Z",
    status: "complete",
    domain: "ppt",
    stage: "ppt_final",
    target,
    validationReportRefs: [{ reportId: input.validationId, digest: input.validationDigest }],
    effectiveRubric: { id: rubric.id, version: rubric.version, digest: rubric.digest },
    targetLocators: [{ kind: "artifact", artifactKind: "ppt_design_draft", artifactId: input.artifactId }],
    dimensions: rubric.dimensions.map((dimension, index) => ({
      dimensionId: dimension.dimensionId,
      score: 95,
      evidenceRefs: [`render:${index}`],
      rationale: "证据达到课堂交付标准。",
    })),
    findings: [],
    recommendation: "pass",
  });
  const validation = createValidationReport({
    reportId: input.validationId,
    createdAt: "2026-07-12T00:00:00.000Z",
    domain: "ppt",
    stage: "ppt_design",
    target: {
      kind: "artifact_draft",
      targetDigest: input.artifactDigest,
    },
    contract: { id: "tool:create_ppt_design_draft", version: "tool-v1" },
    overallStatus: "passed",
    gates: [],
  });
  if (validation.reportDigest !== input.validationDigest) throw new Error("Validation fixture digest mismatch.");
  const decision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });
  return { rubric, critic, decision };
}

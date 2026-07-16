import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createExternalAuditRepairHandoff } from "@/server/conversation/external-audit-repair-contract";
import { ingestExternalAuditRepairEvidence } from "@/server/conversation/external-audit-evidence-ingress";
import { recoverV1_9ExternalAuditTurn } from "@/server/conversation/external-audit-startup-recovery";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import {
  createMainAgentReActCheckpoint,
  restoreMainAgentReActCheckpoint,
} from "@/server/conversation/main-agent-react-checkpoint";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createV1_9ExternalAcceptanceReportDigest, normalizeV1_9ExternalAcceptanceReport } from "@/server/quality/v1-9-external-acceptance";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "external-audit-evidence-ingress");
const databasePath = path.join(stageRoot, `ingress-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "External audit ingress database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("external audit evidence ingress", () => {
  it("atomically commits an Observation/checkpoint and requeues the same Main Agent TurnJob without calling a Tool", async () => {
    const fixture = await createFixture();
    const messageCountBefore = await client.conversationMessage.count({ where: { projectId: fixture.projectId } });

    const result = await ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    });

    expect(result).toMatchObject({
      status: "committed",
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      intentEpoch: fixture.taskBrief.intentEpoch,
      turnJobId: fixture.turnJobId,
      planRevision: 9,
      openFindingIds: ["finding-p0-page-3"],
      affectedUnitIds: ["ppt_deck:page:3"],
    });
    const [observation, aggregate, snapshot, events, job, message] = await Promise.all([
      client.observationRecord.findUnique({ where: { observationId: result.observationId } }),
      createControlPlaneStore(client).getTaskAggregate(fixture.projectId, fixture.taskBrief.intentEpoch),
      createControlPlaneStore(client).getLatestSemanticSnapshot({
        projectId: fixture.projectId,
        taskId: fixture.taskBrief.taskId,
        intentEpoch: fixture.taskBrief.intentEpoch,
        maxPlanRevision: result.planRevision,
      }),
      client.agentEventRecord.findMany({ where: { projectId: fixture.projectId }, orderBy: { sequence: "asc" } }),
      client.conversationTurnJob.findUnique({ where: { id: fixture.turnJobId } }),
      client.conversationMessage.findUnique({ where: { id: fixture.teacherMessageId } }),
    ]);
    expect(observation).toMatchObject({
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      invocationId: null,
      intentEpoch: fixture.taskBrief.intentEpoch,
      status: "repair",
    });
    expect(JSON.parse(observation!.reasonCodesJson)).toEqual(["external_acceptance_p0_repair_required"]);
    expect(JSON.parse(observation!.payloadJson)).toMatchObject({
      reportDigest: fixture.handoff.reportDigest,
      handoffDigest: fixture.handoff.handoffDigest,
      openFindingIds: ["finding-p0-page-3"],
      preserveUnlistedVersions: true,
    });
    expect(aggregate).toMatchObject({
      status: "paused_recovery",
      plan: { revision: 9, status: "paused_recovery" },
    });
    const checkpoint = restoreMainAgentReActCheckpoint(aggregate!.checkpoint as never);
    expect(checkpoint.externalObservations).toEqual([expect.objectContaining({
      observationId: result.observationId,
      status: "repair",
      reasonCodes: ["external_acceptance_p0_repair_required"],
      nextAction: "replan",
      targetLocators: [{ kind: "page", pageId: "3", parentArtifactId: "pptx-1" }],
    })]);
    expect(checkpoint.task.planRevision).toBe(9);
    expect(snapshot).toMatchObject({
      snapshot: {
        plan: { revision: 9, status: "paused_recovery" },
        observationRefs: [expect.objectContaining({ observationId: result.observationId })],
      },
    });
    expect(events.at(-1)).toMatchObject({ kind: "quality_updated", taskId: fixture.taskBrief.taskId });
    expect(job).toMatchObject({
      id: fixture.turnJobId,
      teacherMessageId: fixture.teacherMessageId,
      status: "queued",
      recoveryEvidenceDigest: fixture.handoff.handoffDigest,
    });
    expect(job!.maxAttempts).toBeGreaterThan(job!.attempts);
    expect(JSON.parse(message!.metadataJson)).toMatchObject({
      agentObservations: [expect.objectContaining({ observationId: result.observationId })],
      agentRunCheckpoint: expect.objectContaining({ observationRefs: [result.observationId] }),
    });
    expect(await client.conversationMessage.count({ where: { projectId: fixture.projectId } })).toBe(messageCountBefore);
    expect(await client.toolInvocationRecord.count({ where: { projectId: fixture.projectId } })).toBe(0);
    expect(await client.generationJob.count({ where: { projectId: fixture.projectId } })).toBe(0);

    await expect(ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    })).resolves.toMatchObject({ status: "replayed", observationId: result.observationId });
    expect(await client.observationRecord.count({ where: { projectId: fixture.projectId } })).toBe(1);
  });

  it("reads the semantic snapshot bound to the audited task instead of a newer unrelated project snapshot", async () => {
    const fixture = await createFixture();
    const unrelatedBrief = createTaskBrief({
      taskId: `unrelated:${randomUUID()}`,
      projectId: fixture.projectId,
      intentEpoch: fixture.taskBrief.intentEpoch,
      goal: "不属于当前审查运行的任务",
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: fixture.teacherMessageId,
    });
    const unrelatedSnapshot = buildSemanticContextSnapshot({
      taskBrief: unrelatedBrief,
      plan: { planId: `plan:${unrelatedBrief.taskId}`, revision: 99, status: "active" },
      pendingDecision: null,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: unrelatedBrief.goal }],
    });
    await client.semanticContextSnapshotRecord.create({
      data: {
        snapshotId: `unrelated:${randomUUID()}`,
        projectId: fixture.projectId,
        taskId: unrelatedBrief.taskId,
        intentEpoch: unrelatedBrief.intentEpoch,
        planRevision: unrelatedSnapshot.plan.revision,
        snapshotDigest: unrelatedSnapshot.snapshotDigest,
        payloadJson: JSON.stringify(unrelatedSnapshot),
        lastEventSequence: 99,
        createdAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    });

    await expect(ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    })).resolves.toMatchObject({
      status: "committed",
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      planRevision: fixture.runStateBinding.planRevision + 1,
    });
  });

  it("rejects an idempotent replay after the project IntentEpoch advances", async () => {
    const fixture = await createFixture();
    const committed = await ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    });
    await client.project.update({
      where: { id: fixture.projectId },
      data: { intentEpoch: fixture.taskBrief.intentEpoch + 1 },
    });

    await expect(ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    })).rejects.toThrow(/external_audit_intent_epoch_stale/);
    expect(await client.observationRecord.count({ where: { projectId: fixture.projectId } })).toBe(1);
    expect(await client.observationRecord.findUnique({ where: { observationId: committed.observationId } }))
      .toMatchObject({ taskId: fixture.taskBrief.taskId, intentEpoch: fixture.taskBrief.intentEpoch });
  });

  it.each([
    ["actor", { actorUserId: "other-user" }],
    ["project", { projectId: "other-project" }],
    ["task", { taskId: "other-task" }],
    ["epoch", { intentEpoch: 2 }],
    ["TaskBrief", { taskBriefDigest: "e".repeat(64) }],
    ["plan revision", { planRevision: 7 }],
    ["idempotency", { idempotencyKey: "other-idempotency" }],
  ])("rejects a handoff whose %s is not bound to run-state before any control-plane write", async (_label, override) => {
    const fixture = await createFixture();
    const before = await snapshotCounts(fixture.projectId);

    await expect(ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: { ...fixture.runStateBinding, ...override },
      handoff: fixture.handoff,
    })).rejects.toThrow(/external_audit_run_state_binding_mismatch/);

    expect(await snapshotCounts(fixture.projectId)).toEqual(before);
  });

  it("rejects a stale audit after the project IntentEpoch advances", async () => {
    const fixture = await createFixture();
    const before = await snapshotCounts(fixture.projectId);
    await client.project.update({ where: { id: fixture.projectId }, data: { intentEpoch: 1 } });

    await expect(ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    })).rejects.toThrow(/external_audit_intent_epoch_stale/);

    expect(await snapshotCounts(fixture.projectId)).toEqual(before);
  });

  it("startup recovery drains only the same queued TurnJob committed by external-audit ingress", async () => {
    const fixture = await createFixture();
    await ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    });
    const drainProject = vi.fn(async () => undefined);

    await expect(recoverV1_9ExternalAuditTurn({
      client,
      authority: startupAuthority(fixture),
      drainProject,
    })).resolves.toBe(true);

    expect(drainProject).toHaveBeenCalledOnce();
    expect(drainProject).toHaveBeenCalledWith({
      projectId: fixture.projectId,
      actorUserId: fixture.runStateBinding.actorUserId,
      actorAuthMode: fixture.runStateBinding.actorAuthMode,
      authSessionId: null,
    });
  });

  it.each([
    ["task", { taskId: "other-task" }],
    ["IntentEpoch", { intentEpoch: 2 }],
    ["committed plan revision", { committedPlanRevision: 8 }],
    ["handoff digest", { handoffDigest: "f".repeat(64) }],
  ])("startup recovery rejects a mismatched %s before draining", async (_label, override) => {
    const fixture = await createFixture();
    await ingestExternalAuditRepairEvidence({
      client,
      runStateBinding: fixture.runStateBinding,
      handoff: fixture.handoff,
    });
    const drainProject = vi.fn(async () => undefined);

    await expect(recoverV1_9ExternalAuditTurn({
      client,
      authority: { ...startupAuthority(fixture), ...override },
      drainProject,
    })).rejects.toThrow(/v1_9_external_audit_recovery_invalid/);
    expect(drainProject).not.toHaveBeenCalled();
  });
});

function startupAuthority(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const binding = fixture.runStateBinding;
  return {
    runId: binding.runId,
    manifestSha256: binding.manifestSha256,
    packageArtifactId: binding.packageArtifactId,
    packageArtifactVersion: binding.packageArtifactVersion,
    packageVersion: binding.packageVersion,
    packageSha256: binding.packageSha256,
    actorUserId: binding.actorUserId,
    actorAuthMode: binding.actorAuthMode,
    projectId: binding.projectId,
    taskId: binding.taskId,
    intentEpoch: binding.intentEpoch,
    taskBriefDigest: binding.taskBriefDigest,
    sourcePlanRevision: binding.planRevision,
    committedPlanRevision: binding.planRevision + 1,
    turnJobId: binding.turnJobId,
    teacherMessageId: binding.teacherMessageId,
    handoffDigest: fixture.handoff.handoffDigest,
    reportDigest: fixture.handoff.reportDigest,
    observationId: `external-audit:${fixture.handoff.handoffDigest}`,
  };
}

async function createFixture() {
  const actorUserId = `external-audit-user-${randomUUID()}`;
  const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
    actorUserId,
    actorAuthMode: "local",
    authSessionId: null,
  });
  const project = await service.createProject({ title: `external-audit-${randomUUID()}` });
  const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "完成百分数公开课材料包" });
  const taskBrief = createTaskBrief({
    taskId: `task:${randomUUID()}`,
    projectId: project.id,
    intentEpoch: 0,
    goal: "完成百分数公开课材料包",
    requestedOutputs: ["ppt", "video", "package"],
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: teacherMessage.id,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: project.id,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: "standard-production.v1",
    maxCostCredits: 50,
    maxExternalProviderCalls: 20,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await service.updateMessageMetadata(project.id, teacherMessage.id, { taskBrief, intentGrant });
  const checkpoint = createMainAgentReActCheckpoint({
    request: { instructions: "Main Agent rules", input: taskBrief.goal },
    seed: {
      projectId: project.id,
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      intentEpoch: taskBrief.intentEpoch,
      planRevision: 8,
      generationIntensity: "standard",
      authorization: {
        standardWorkAuthorized: true,
        budgetPolicyVersion: intentGrant.budgetPolicyVersion,
        maxCostCredits: intentGrant.maxCostCredits,
        maxExternalProviderCalls: intentGrant.maxExternalProviderCalls,
      },
    },
    records: [],
    currentToolNames: ["create_ppt_design_draft", "assemble_final_package"],
  });
  const store = createControlPlaneStore(client);
  await store.upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${taskBrief.taskId}`, revision: 8, status: "completed" },
    status: "completed",
    checkpoint: checkpoint as unknown as Record<string, unknown>,
  });
  await store.saveSemanticSnapshot(buildSemanticContextSnapshot({
    taskBrief,
    plan: { planId: `plan:${taskBrief.taskId}`, revision: 8, status: "completed" },
    pendingDecision: null,
    trustedArtifactRefs: [],
    observationRefs: [],
    recentMessages: [{ role: "teacher", content: taskBrief.goal }],
  }), 0);
  const packageArtifact = await client.artifact.create({
    data: {
      projectId: project.id,
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      intentEpoch: taskBrief.intentEpoch,
      planRevision: 8,
      origin: "tool_result",
      nodeKey: "final_delivery",
      kind: "final_delivery",
      title: "课程材料包",
      status: "approved",
      summary: "版本一致材料包",
      markdownContent: "",
      structuredContentJson: "{}",
      version: 1,
      isApproved: true,
    },
  });
  const queued = await service.enqueueConversationTurn(project.id, {
    teacherMessageId: teacherMessage.id,
    idempotencyKey: `turn:${randomUUID()}`,
    maxAttempts: 1,
  });
  const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "external-audit-fixture" });
  await service.finishConversationTurnJob(project.id, running!.id, { status: "succeeded" });
  const report = normalizeV1_9ExternalAcceptanceReport(reportFixture({ packageArtifactId: packageArtifact.id }));
  const reportDigest = createV1_9ExternalAcceptanceReportDigest(report);
  const taskBinding = {
    actorUserId,
    actorAuthMode: "local" as const,
    projectId: project.id,
    taskId: taskBrief.taskId,
    intentEpoch: taskBrief.intentEpoch,
    taskBriefDigest: taskBrief.digest,
    planRevision: 8,
    turnJobId: queued.id,
    teacherMessageId: teacherMessage.id,
    idempotencyKey: `external-audit:${report.reportId}`,
  };
  const handoff = createExternalAuditRepairHandoff({ report, reportDigest, binding: taskBinding });
  return {
    projectId: project.id,
    teacherMessageId: teacherMessage.id,
    turnJobId: queued.id,
    taskBrief,
    handoff,
    runStateBinding: {
      runId: report.runId,
      manifestSha256: report.manifestSha256,
      packageArtifactId: report.packageArtifactId,
      packageArtifactVersion: report.packageArtifactVersion,
      packageVersion: report.packageVersion,
      packageSha256: report.packageSha256,
      ...taskBinding,
    },
  };
}

function reportFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "v1-9-external-acceptance-report.v2",
    reportId: `external-acceptance-${randomUUID()}`,
    auditRound: 1,
    runId: "v1-9-external-audit-ingress",
    manifestSha256: "a".repeat(64),
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: "b".repeat(64),
    rubricVersion: "v1-9-product-rubric.v1",
    auditMode: "external_read_only",
    auditBoundary: { businessToolCalls: 0, artifactMutations: 0, teacherApprovalActions: 0, packageRebuilds: 0 },
    reviewScope: { kind: "full_package", previousReportDigest: null, reviewedFindingIds: [] },
    findings: [{
      findingId: "finding-p0-page-3",
      status: "open",
      severity: "P0",
      responsibilityLayer: "quality_gate",
      category: "design_quality",
      summary: "第3页版式不合格。",
      feedback: { design: "第3页越过安全边距。", vulnerability: null, engineering: "仅返修第3页。" },
      locator: {
        artifactRole: "ppt_deck",
        artifactId: "pptx-1",
        artifactVersion: "course-v1",
        pageNumber: 3,
        shotId: null,
        packageEntry: "materials/course-v1.pptx",
      },
      suggestedRegressionTest: "复验第3页安全边距。",
    }],
    generatedAt: "2026-07-16T00:30:00.000Z",
    ...overrides,
  };
}

async function snapshotCounts(projectId: string) {
  const [observations, events, messages, jobs] = await Promise.all([
    client.observationRecord.count({ where: { projectId } }),
    client.agentEventRecord.count({ where: { projectId } }),
    client.conversationMessage.count({ where: { projectId } }),
    client.conversationTurnJob.findMany({ where: { projectId }, select: { id: true, status: true, recoveryEvidenceDigest: true } }),
  ]);
  const aggregate = await client.taskAggregate.findUnique({ where: { projectId_intentEpoch: { projectId, intentEpoch: 0 } } });
  return { observations, events, messages, jobs, aggregate: aggregate ? { status: aggregate.status, planRevision: aggregate.planRevision, checkpointJson: aggregate.checkpointJson } : null };
}

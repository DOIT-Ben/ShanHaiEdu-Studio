import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";

import { createValidationReport, validateToolExecutionResult } from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createControlPlaneStore as createControlPlaneStoreForClient } from "@/server/conversation/control-plane-store";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import type { ValidationReport } from "@/server/quality/quality-types";
import { getToolDefinition } from "@/server/tools/tool-registry";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService as createWorkbenchServiceForRepository } from "@/server/workbench/service";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "control-plane-persistence-tests");
const databasePath = path.join(stageRoot, `control-plane-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;
let prisma: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Control-plane persistence database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  prisma = client;
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

function createControlPlaneStore() {
  return createControlPlaneStoreForClient(client);
}

function createWorkbenchService() {
  return createWorkbenchServiceForRepository(createPrismaWorkbenchRepository(client));
}

describe("control-plane persistence", () => {
  it("persists task aggregate, ordered events and a resumable semantic snapshot", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "控制面真源" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();

    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-1", revision: 2, status: "active" },
      checkpoint: null,
    });
    const firstEventId = `${project.id}-event-1`;
    const secondEventId = `${project.id}-event-2`;
    const first = await store.appendEvent(eventInput(project.id, brief.taskId, firstEventId, "task_created"));
    const second = await store.appendEvent(eventInput(project.id, brief.taskId, secondEventId, "task_updated"));
    const snapshot = buildSemanticContextSnapshot({
      taskBrief: brief,
      plan: { planId: "plan-1", revision: 2, status: "active" },
      pendingDecision: null,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: brief.goal }],
    });
    await store.saveSemanticSnapshot(snapshot, second.sequence);

    expect(await store.getTaskAggregate(project.id, 0)).toMatchObject({
      taskBrief: { digest: brief.digest },
      plan: { revision: 2 },
    });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(await store.listEvents(project.id, 1)).toEqual([expect.objectContaining({ eventId: secondEventId, sequence: 2 })]);
    expect(await store.getLatestSemanticSnapshot(snapshotScope(brief, 2))).toMatchObject({
      snapshotDigest: snapshot.snapshotDigest,
      lastEventSequence: 2,
    });
  });

  it("selects the highest semantic snapshot revision even when its evidence timestamp is older", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "控制面语义版本排序" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-ordering", revision: 2, status: "paused_recovery" },
      checkpoint: null,
    });
    const olderRevision = buildSemanticContextSnapshot({
      taskBrief: brief,
      plan: { planId: "plan-ordering", revision: 1, status: "completed" },
      pendingDecision: null,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: brief.goal }],
    });
    const newerRevision = buildSemanticContextSnapshot({
      taskBrief: brief,
      plan: { planId: "plan-ordering", revision: 2, status: "paused_recovery" },
      pendingDecision: null,
      trustedArtifactRefs: [],
      observationRefs: [{ observationId: "backdated-audit", reasonCodes: ["repair_required"] }],
      recentMessages: [{ role: "teacher", content: brief.goal }],
    });
    await store.saveSemanticSnapshot(olderRevision, 1);
    await store.saveSemanticSnapshot(newerRevision, 2);
    await prisma.semanticContextSnapshotRecord.update({
      where: {
        projectId_taskId_intentEpoch_planRevision: {
          projectId: project.id,
          taskId: brief.taskId,
          intentEpoch: brief.intentEpoch,
          planRevision: 1,
        },
      },
      data: { createdAt: new Date("2026-07-16T09:00:00.000Z") },
    });
    await prisma.semanticContextSnapshotRecord.update({
      where: {
        projectId_taskId_intentEpoch_planRevision: {
          projectId: project.id,
          taskId: brief.taskId,
          intentEpoch: brief.intentEpoch,
          planRevision: 2,
        },
      },
      data: { createdAt: new Date("2026-07-16T00:30:00.000Z") },
    });
    const unrelatedBrief = createTaskBrief({
      taskId: `unrelated-${project.id}`,
      projectId: project.id,
      intentEpoch: brief.intentEpoch,
      goal: "不属于当前控制面任务的快照",
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: "unrelated-message",
    });
    await store.saveSemanticSnapshot(buildSemanticContextSnapshot({
      taskBrief: unrelatedBrief,
      plan: { planId: "unrelated-plan", revision: 99, status: "active" },
      pendingDecision: { intentEpoch: unrelatedBrief.intentEpoch, action: "unrelated" },
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: unrelatedBrief.goal }],
    }), 99);

    expect(await store.getLatestSemanticSnapshot(snapshotScope(brief, 2))).toMatchObject({
      snapshotDigest: newerRevision.snapshotDigest,
      snapshot: {
        plan: { revision: 2, status: "paused_recovery" },
        observationRefs: [{ observationId: "backdated-audit" }],
      },
      lastEventSequence: 2,
    });
  });

  it("rolls back Artifact and Observation when the event member of the atomic commit fails", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "原子结果提交" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-rollback", revision: 0, status: "active" },
      checkpoint: null,
    });
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: { goal: brief.goal } },
    });
    const invocationId = `${project.id}-invocation-rollback`;
    const duplicateEventId = `${project.id}-event-duplicate`;
    const observationId = `${project.id}-observation-rollback`;
    await createRunningTurn(brief);
    await store.startToolInvocation({
      invocationId,
      envelope,
      toolName: "create_requirement_spec",
      request: { goal: brief.goal },
    });
    await store.appendEvent(eventInput(project.id, brief.taskId, duplicateEventId, "tool_started"));

    await expect(store.commitToolResult({
      invocationId,
      artifact: artifactInput("不应保留的成果"),
      observation: {
        observationId,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        payload: { summary: "不应保留" },
      },
      event: eventInput(project.id, brief.taskId, duplicateEventId, "artifact_committed", { observationId }),
    })).rejects.toThrow();

    expect((await service.getArtifacts(project.id)).some((artifact) => artifact.title === "不应保留的成果")).toBe(false);
    expect(await store.getObservation(observationId)).toBeNull();
    expect(await store.getToolInvocation(invocationId)).toMatchObject({ status: "running" });
  });

  it("atomically persists a run checkpoint with the matching TaskAggregate and semantic snapshot revision", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "控制面续段真源" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-segment", revision: 0, status: "active" },
      checkpoint: null,
    });
    const checkpoint = createMainAgentReActCheckpoint({
      request: { instructions: "Main Agent test rules", input: brief.goal },
      seed: {
        projectId: project.id,
        taskId: brief.taskId,
        taskBriefDigest: brief.digest,
        intentEpoch: brief.intentEpoch,
        planRevision: 1,
        generationIntensity: brief.generationIntensity,
        authorization: {
          standardWorkAuthorized: grant.standardWorkAuthorized,
          budgetPolicyVersion: grant.budgetPolicyVersion,
          maxCostCredits: grant.maxCostCredits,
          maxExternalProviderCalls: grant.maxExternalProviderCalls,
        },
      },
      records: [{
        round: 1,
        toolName: "create_requirement_spec",
        callDigest: "a".repeat(64),
        observation: {
          observationId: "observation-segment-1",
          status: "succeeded",
          reasonCodes: ["business_tool_succeeded"],
        },
      }],
      currentToolNames: ["create_lesson_plan"],
    });
    const snapshot = buildSemanticContextSnapshot({
      taskBrief: brief,
      plan: { planId: "plan-segment", revision: 1, status: "active" },
      pendingDecision: null,
      trustedArtifactRefs: [],
      observationRefs: [{ observationId: "observation-segment-1", reasonCodes: ["business_tool_succeeded"] }],
      recentMessages: [{ role: "teacher", content: brief.goal }],
    });

    const committed = await store.commitRunCheckpoint({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-segment", revision: 1, status: "active" },
      checkpoint,
      semanticSnapshot: snapshot,
      event: eventInput(project.id, brief.taskId, `${project.id}-segment-1`, "task_updated"),
    });

    expect(committed.aggregate).toMatchObject({
      plan: { planId: "plan-segment", revision: 1, status: "active" },
      checkpoint: expect.objectContaining({ checkpointDigest: checkpoint.checkpointDigest }),
    });
    expect(committed.snapshot).toMatchObject({
      snapshotDigest: snapshot.snapshotDigest,
      lastEventSequence: committed.event.sequence,
    });
    expect(await store.getTaskAggregate(project.id, 0)).toMatchObject({
      plan: { revision: 1 },
      checkpoint: expect.objectContaining({ checkpointDigest: checkpoint.checkpointDigest }),
    });
    expect(await store.getLatestSemanticSnapshot(snapshotScope(brief, 1))).toMatchObject({
      snapshot: { plan: { revision: 1 } },
      lastEventSequence: committed.event.sequence,
    });
  });

  it("never regresses a TaskAggregate revision and pauses the latest persisted state", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "控制面 revision 单调性" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    const checkpoint = createMainAgentReActCheckpoint({
      request: { instructions: "Main Agent test rules", input: brief.goal },
      seed: {
        projectId: project.id,
        taskId: brief.taskId,
        taskBriefDigest: brief.digest,
        intentEpoch: brief.intentEpoch,
        planRevision: 3,
        generationIntensity: brief.generationIntensity,
        authorization: {
          standardWorkAuthorized: grant.standardWorkAuthorized,
          budgetPolicyVersion: grant.budgetPolicyVersion,
          maxCostCredits: grant.maxCostCredits,
          maxExternalProviderCalls: grant.maxExternalProviderCalls,
        },
      },
      records: [],
      currentToolNames: ["create_requirement_spec"],
    });
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-monotonic", revision: 3, status: "active" },
      checkpoint,
    });

    await expect(store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-monotonic", revision: 1, status: "paused_recovery" },
      checkpoint: null,
    })).rejects.toThrow("Task aggregate plan revision cannot regress.");

    const paused = await store.pauseTaskAggregate({ taskBrief: brief, intentGrant: grant });
    expect(paused).toMatchObject({
      status: "paused_recovery",
      plan: { planId: "plan-monotonic", revision: 3, status: "paused_recovery" },
      checkpoint: expect.objectContaining({ checkpointDigest: checkpoint.checkpointDigest }),
    });
  });

  it("returns a terminal replay claim instead of executing the same Tool invocation again", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool Invocation 幂等回放" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-replay", revision: 0, status: "active" },
      checkpoint: null,
    });
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: { goal: brief.goal } },
    });
    const invocationId = `${project.id}-invocation-replay`;
    await createRunningTurn(brief);
    const firstClaim = await store.startToolInvocation({
      invocationId,
      envelope,
      toolName: "create_requirement_spec",
      request: { goal: brief.goal },
    });
    expect(firstClaim).toMatchObject({ kind: "claimed", invocation: { invocationId, status: "running" } });
    const observationId = `${project.id}-observation-replay`;
    await store.commitToolFailure({
      invocationId,
      observation: {
        observationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: { summary: "输入需要修正" },
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-event-replay`, "tool_observed", { observationId }),
    });

    const replay = await store.startToolInvocation({
      invocationId: `${invocationId}-duplicate`,
      envelope,
      toolName: "create_requirement_spec",
      request: { goal: brief.goal },
    });
    expect(replay).toMatchObject({
      kind: "terminal_replay",
      invocation: { invocationId, status: "failed", observationId },
      observation: { observationId, status: "failed", reasonCodes: ["validation_failed"] },
    });
  });

  it("rejects an envelope whose embedded grant no longer matches the persisted IntentGrant", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "持久授权复核" });
    const message = await service.addMessage(project.id, { role: "teacher", content: "整理需求" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-grant-authority", revision: 0, status: "active" },
      checkpoint: null,
    });
    const staleEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: { goal: brief.goal } },
    });
    const revokedGrant = { ...grant, standardWorkAuthorized: false, maxExternalProviderCalls: 0 };
    await store.commitIntentGrantWithMessage({
      taskBrief: brief,
      intentGrant: revokedGrant,
      messageId: message.id,
      messageMetadata: { taskBrief: brief, intentGrant: revokedGrant },
    });
    await createRunningTurn(brief);

    await expect(store.startToolInvocation({
      invocationId: `${project.id}-stale-grant`,
      envelope: staleEnvelope,
      toolName: "create_requirement_spec",
      request: { goal: brief.goal },
    })).rejects.toThrow("ExecutionEnvelope is stale");
  });

  it("refuses to promote a Tool result after the project IntentEpoch advances", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "迟到结果提升阻断" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-late-result", revision: 0, status: "active" },
      checkpoint: null,
    });
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: { goal: brief.goal } },
    });
    const invocationId = `${project.id}-late-result`;
    await createRunningTurn(brief);
    await store.startToolInvocation({ invocationId, envelope, toolName: "create_requirement_spec", request: { goal: brief.goal } });
    await service.advanceProjectIntentEpoch(project.id, 0);

    await expect(store.commitToolResult({
      invocationId,
      artifact: artifactInput("不应提升的迟到成果"),
      observation: {
        observationId: `${project.id}-late-observation`,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        payload: { summary: "迟到结果" },
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-late-event`, "artifact_committed", {
        observationId: `${project.id}-late-observation`,
      }),
    })).rejects.toThrow("Tool invocation is stale");
    expect((await service.getArtifacts(project.id)).some((artifact) => artifact.title === "不应提升的迟到成果")).toBe(false);
  });

  it("rejects a terminal result after the frozen TurnJob ends or its TaskBrief digest changes", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Frozen turn terminal guard" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-frozen-turn", revision: 0, status: "active" },
      checkpoint: null,
    });
    const turn = await createRunningTurn(brief);
    const request = { goal: brief.goal };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 0, intensity: "standard", intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: request },
    });
    const invocationId = `${project.id}-ended-turn`;
    await store.startToolInvocation({ invocationId, envelope, toolName: "create_requirement_spec", request });
    await prisma.conversationTurnJob.update({ where: { id: turn.id }, data: { status: "succeeded" } });
    await expect(store.commitToolFailure({
      invocationId,
      observation: { observationId: `${project.id}-ended-turn-observation`, status: "failed", reasonCodes: ["late"], payload: {} },
      event: eventInput(project.id, brief.taskId, `${project.id}-ended-turn-event`, "tool_observed", {
        observationId: `${project.id}-ended-turn-observation`, status: "failed",
      }),
    })).rejects.toThrow("stale");

    await prisma.conversationTurnJob.update({ where: { id: turn.id }, data: { status: "running" } });
    const replacementBrief = createTaskBrief({
      taskId: brief.taskId,
      projectId: brief.projectId,
      intentEpoch: brief.intentEpoch,
      goal: "同一轮被替换的任务目标",
      requestedOutputs: brief.requestedOutputs,
      constraints: brief.constraints,
      excludedOutputs: brief.excludedOutputs,
      generationIntensity: brief.generationIntensity,
      sourceMessageId: brief.sourceMessageId,
    });
    await prisma.taskAggregate.update({
      where: { projectId_intentEpoch: { projectId: project.id, intentEpoch: 0 } },
      data: { taskBriefJson: JSON.stringify(replacementBrief) },
    });
    await expect(store.commitToolFailure({
      invocationId,
      observation: { observationId: `${project.id}-changed-brief-observation`, status: "failed", reasonCodes: ["late"], payload: {} },
      event: eventInput(project.id, brief.taskId, `${project.id}-changed-brief-event`, "tool_observed", {
        observationId: `${project.id}-changed-brief-observation`, status: "failed",
      }),
    })).rejects.toThrow("stale");
  });

  it("rejects a Tool terminal whose event kind contradicts the Observation", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool terminal event matrix" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-event-matrix", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const request = { goal: brief.goal };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 0, intensity: "standard", intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: request },
    });
    const invocationId = `${project.id}-event-matrix`;
    await store.startToolInvocation({ invocationId, envelope, toolName: "create_requirement_spec", request });
    const observationId = `${project.id}-event-matrix-observation`;
    await expect(store.commitToolFailure({
      invocationId,
      observation: { observationId, status: "failed", reasonCodes: ["validation_failed"], payload: {} },
      event: eventInput(project.id, brief.taskId, `${project.id}-event-matrix-event`, "artifact_committed", {
        observationId, status: "failed",
      }),
    })).rejects.toThrow("terminal");
    expect(await store.getToolInvocation(invocationId)).toMatchObject({ status: "running" });
  });

  it("atomically binds a Main Agent claim to the actual action, TurnJob identity and attempted audit", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool authority claim" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-tool-authority", revision: 0, status: "active" },
      checkpoint: null,
    });
    const turn = await createRunningTurn(brief, {
      actorUserId: "teacher-1",
      actorAuthMode: "password",
      authSessionId: "session-secret-value",
    });
    const request = { goal: brief.goal, privatePrompt: "SENSITIVE_TOOL_ARGUMENT" };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: request },
    });
    const invocationId = `${project.id}-authority-claim`;

    await expect(store.startToolInvocation({
      invocationId: `${invocationId}-wrong-tool`,
      envelope,
      toolName: "create_lesson_plan",
      request,
    })).rejects.toThrow("action");
    await expect(store.startToolInvocation({
      invocationId: `${invocationId}-wrong-request`,
      envelope,
      toolName: "create_requirement_spec",
      request: { ...request, goal: "tampered" },
    })).rejects.toThrow("action");
    expect(await prisma.toolInvocationRecord.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.orchestrationAuditEvent.count({ where: { resolvedProjectId: project.id } })).toBe(0);

    const claim = await store.startToolInvocation({
      invocationId,
      envelope,
      toolName: "create_requirement_spec",
      request,
    });
    const audit = await prisma.orchestrationAuditEvent.findFirstOrThrow({
      where: { toolInvocationId: invocationId, recordType: "attempted" },
    });

    expect(claim).toMatchObject({ kind: "claimed", invocation: { invocationId, status: "running" } });
    expect(audit).toMatchObject({
      attemptId: invocationId,
      operationKind: "tool_invocation",
      authority: "main_agent",
      resolvedProjectId: project.id,
      actorUserId: "teacher-1",
      actorAuthMode: "password",
      taskId: brief.taskId,
      turnJobId: turn.id,
      teacherMessageId: brief.sourceMessageId,
      toolInvocationId: invocationId,
      intentEpoch: 0,
      planId: "plan-tool-authority",
      planRevision: 0,
      toolOrdinal: 1,
      toolName: "create_requirement_spec",
      actionDigest: envelope.actionDigest,
      idempotencyKey: envelope.idempotencyKey,
      invocationStatus: "running",
      observationId: null,
    });
    expect(audit.authSessionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.eventDigest).toBe(orchestrationAuditDigest(audit));
    expect(JSON.stringify(audit)).not.toContain("SENSITIVE_TOOL_ARGUMENT");
    expect(JSON.stringify(audit)).not.toContain("session-secret-value");
  });

  it("fails closed when the frozen running TurnJob is missing, ambiguous or bound to another actor", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool authority TurnJob" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-turn-job", revision: 0, status: "active" },
      checkpoint: null,
    });
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: {} },
    });
    const claim = (suffix: string) => store.startToolInvocation({
      invocationId: `${project.id}-${suffix}`,
      envelope,
      toolName: "create_requirement_spec",
      request: {},
    });

    await expect(claim("missing")).rejects.toThrow("TurnJob");
    const first = await createRunningTurn(brief, { actorUserId: "teacher-1" });
    await createRunningTurn(brief, { actorUserId: "teacher-1" });
    await expect(claim("ambiguous")).rejects.toThrow("TurnJob");
    await prisma.conversationTurnJob.deleteMany({ where: { projectId: project.id, id: { not: first.id } } });
    await prisma.conversationTurnJob.update({ where: { id: first.id }, data: { actorUserId: "another-teacher" } });
    await expect(claim("wrong-actor")).rejects.toThrow("actor");

    expect(await prisma.toolInvocationRecord.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.orchestrationAuditEvent.count({ where: { resolvedProjectId: project.id } })).toBe(0);
  });

  it("preserves authority across idempotent replay and rejects the artifact route from reusing a Main Agent claim", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool authority replay" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-authority-replay", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: {} },
    });
    await store.startToolInvocation({
      invocationId: `${project.id}-main-claim`, envelope, toolName: "create_requirement_spec", request: {},
    });

    await expect(store.startArtifactRouteToolInvocation({
      invocationId: `${project.id}-artifact-replay`, envelope, toolName: "create_requirement_spec", request: {},
    })).rejects.toThrow("authority");
    const replay = await store.startToolInvocation({
      invocationId: `${project.id}-main-replay`, envelope, toolName: "create_requirement_spec", request: {},
    });

    expect(replay).toMatchObject({ kind: "in_progress", invocation: { invocationId: `${project.id}-main-claim` } });
    expect(await prisma.orchestrationAuditEvent.count({
      where: { resolvedProjectId: project.id, recordType: "attempted" },
    })).toBe(1);
  });

  it("atomically writes one resolved audit and rejects duplicate or mismatched terminal commits", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool authority terminal" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-terminal", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const firstEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 0, intensity: "standard", intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: {} },
    });
    const firstInvocationId = `${project.id}-terminal-1`;
    await store.startToolInvocation({
      invocationId: firstInvocationId, envelope: firstEnvelope, toolName: "create_requirement_spec", request: {},
    });
    const firstObservationId = `${project.id}-terminal-observation-1`;
    const terminalInput = {
      invocationId: firstInvocationId,
      observation: {
        observationId: firstObservationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: { summary: "failed fixture", providerResponse: "SENSITIVE_PROVIDER_RESPONSE" },
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-terminal-event-1`, "tool_observed", {
        observationId: firstObservationId,
        status: "failed",
      }),
    };
    await store.commitToolFailure(terminalInput);
    const resolved = await prisma.orchestrationAuditEvent.findFirstOrThrow({
      where: { toolInvocationId: firstInvocationId, recordType: "resolved" },
    });
    expect(resolved).toMatchObject({
      authority: "main_agent",
      outcome: "failed",
      invocationStatus: "failed",
      observationId: firstObservationId,
      planId: "plan-terminal",
      planRevision: 0,
      toolOrdinal: 1,
      actionDigest: firstEnvelope.actionDigest,
    });
    expect(resolved.eventDigest).toBe(orchestrationAuditDigest(resolved));
    expect(JSON.stringify(resolved)).not.toContain("SENSITIVE_PROVIDER_RESPONSE");
    await expect(store.commitToolFailure({
      ...terminalInput,
      event: { ...terminalInput.event, eventId: `${project.id}-terminal-event-duplicate` },
    })).rejects.toThrow("not active");
    expect(await prisma.orchestrationAuditEvent.count({
      where: { toolInvocationId: firstInvocationId, recordType: "resolved" },
    })).toBe(1);

    const secondEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 1, intensity: "standard", intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: { revision: 1 } },
    });
    const secondInvocationId = `${project.id}-terminal-2`;
    await store.startToolInvocation({
      invocationId: secondInvocationId,
      envelope: secondEnvelope,
      toolName: "create_requirement_spec",
      request: { revision: 1 },
    });
    const secondObservationId = `${project.id}-terminal-observation-2`;
    await expect(store.commitToolResult({
      invocationId: secondInvocationId,
      artifact: artifactInput("不应接受状态冲突的成果"),
      observation: {
        observationId: secondObservationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: {},
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-terminal-event-success-mismatch`, "artifact_committed", {
        observationId: secondObservationId,
        status: "failed",
      }),
    })).rejects.toThrow("terminal");
    await expect(store.commitToolFailure({
      invocationId: secondInvocationId,
      observation: {
        observationId: secondObservationId,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        payload: {},
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-terminal-event-failure-mismatch`, "tool_observed", {
        observationId: secondObservationId,
        status: "succeeded",
      }),
    })).rejects.toThrow("cannot persist a successful terminal result");
    await expect(store.commitToolFailure({
      invocationId: secondInvocationId,
      observation: {
        observationId: secondObservationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: {},
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-terminal-event-status-mismatch`, "tool_observed", {
        observationId: secondObservationId,
        status: "succeeded",
      }),
    })).rejects.toThrow("event status");
    await expect(store.commitToolFailure({
      invocationId: secondInvocationId,
      observation: {
        observationId: secondObservationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: {},
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-terminal-event-2`, "tool_observed", {
        observationId: "cross-bound-observation",
        status: "failed",
      }),
    })).rejects.toThrow("Observation");
    expect(await store.getToolInvocation(secondInvocationId)).toMatchObject({ status: "running" });
    expect(await store.getObservation(secondObservationId)).toBeNull();
    expect((await service.getArtifacts(project.id)).some(
      (artifact) => artifact.title === "不应接受状态冲突的成果",
    )).toBe(false);
    expect(await prisma.orchestrationAuditEvent.count({
      where: { toolInvocationId: secondInvocationId, recordType: "resolved" },
    })).toBe(0);
  });

  it("freezes Tool result mode at claim time and derives terminal status from persisted facts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Tool result mode" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-result-mode", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);

    const artifactEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: {} },
    });
    const artifactInvocationId = `${project.id}-artifact-required`;
    await store.startToolInvocation({
      invocationId: artifactInvocationId,
      envelope: artifactEnvelope,
      toolName: "create_requirement_spec",
      request: {},
    });
    const missingArtifactObservationId = `${project.id}-missing-artifact`;
    await expect(store.commitToolObservation({
      invocationId: artifactInvocationId,
      observation: {
        observationId: missingArtifactObservationId,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        payload: {},
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-missing-artifact-event`, "artifact_committed", {
        observationId: missingArtifactObservationId,
        status: "succeeded",
      }),
    })).rejects.toThrow("without an Artifact binding");
    expect(await store.getToolInvocation(artifactInvocationId)).toMatchObject({ status: "running" });
    expect(await store.getObservation(missingArtifactObservationId)).toBeNull();

    const checkpointRequest = { question: "请选择本轮重点" };
    const checkpointEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "request_teacher_decision", arguments: checkpointRequest },
    });
    const checkpointInvocationId = `${project.id}-dialogue-checkpoint`;
    await store.startToolInvocation({
      invocationId: checkpointInvocationId,
      envelope: checkpointEnvelope,
      toolName: "request_teacher_decision",
      request: checkpointRequest,
    });
    const forgedArtifactObservationId = `${project.id}-dialogue-forged-artifact`;
    await expect(store.commitToolObservation({
      invocationId: checkpointInvocationId,
      observation: {
        observationId: forgedArtifactObservationId,
        status: "succeeded",
        reasonCodes: ["dialogue_checkpoint_succeeded"],
        payload: {},
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-dialogue-forged-event`, "artifact_committed", {
        observationId: forgedArtifactObservationId,
        status: "succeeded",
      }),
    })).rejects.toThrow("event kind");
    expect(await store.getToolInvocation(checkpointInvocationId)).toMatchObject({ status: "running" });
    expect(await store.getObservation(forgedArtifactObservationId)).toBeNull();

    const checkpointObservationId = `${project.id}-dialogue-observation`;
    await store.commitToolObservation({
      invocationId: checkpointInvocationId,
      observation: {
        observationId: checkpointObservationId,
        status: "needs_input",
        reasonCodes: ["dialogue_checkpoint_requested"],
        payload: { question: checkpointRequest.question },
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-dialogue-event`, "decision_pending", {
        observationId: checkpointObservationId,
        status: "needs_input",
        artifactId: "caller-forged-artifact",
      }),
    });
    expect(await store.getToolInvocation(checkpointInvocationId)).toMatchObject({
      status: "succeeded",
      artifactId: null,
      observationId: checkpointObservationId,
    });
    const checkpointEvent = await prisma.agentEventRecord.findUniqueOrThrow({
      where: { eventId: `${project.id}-dialogue-event` },
    });
    expect(JSON.parse(checkpointEvent.payloadJson)).toEqual(expect.objectContaining({
      observationId: checkpointObservationId,
      status: "needs_input",
      reasonCodes: ["dialogue_checkpoint_requested"],
      toolName: "request_teacher_decision",
    }));
    expect(JSON.parse(checkpointEvent.payloadJson)).not.toHaveProperty("artifactId");
  });

  it("rejects a Provider success without generation evidence or with the wrong Artifact kind", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Provider terminal evidence" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-provider-terminal-evidence", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const source = await prisma.artifact.create({
      data: {
        projectId: project.id, taskId: brief.taskId, taskBriefDigest: brief.digest,
        intentEpoch: brief.intentEpoch, planRevision: 0, origin: "tool_result",
        nodeKey: "ppt_draft", kind: "ppt_draft", title: "课堂图片输入",
        status: "approved", summary: "已确认大纲", markdownContent: "", structuredContentJson: "{}", version: 1,
      },
    });
    const request = { sourceArtifactId: source.id, sourceArtifactVersion: source.version };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 0, intensity: "standard", intentGrant: grant,
      action: { toolName: "generate_classroom_image", arguments: request },
    });
    const invocationId = `${project.id}-provider-terminal-evidence`;
    await store.startArtifactRouteToolInvocation({
      invocationId, envelope, toolName: "generate_classroom_image", request,
    });
    const event = (observationId: string, suffix: string) => ({
      ...eventInput(project.id, brief.taskId, `${project.id}-${suffix}`, "artifact_committed", {
        observationId,
        status: "succeeded",
      }),
      runId: `artifact-route:${invocationId}`,
    });
    const wrongKindObservationId = `${project.id}-wrong-kind-observation`;
    await expect(store.commitToolResult({
      invocationId,
      artifact: artifactInput("错误类型成果"),
      observation: {
        observationId: wrongKindObservationId, status: "succeeded", reasonCodes: ["tool_succeeded"], payload: {},
      },
      event: event(wrongKindObservationId, "wrong-kind-event"),
    })).rejects.toThrow("server result contract");

    const missingEvidenceObservationId = `${project.id}-missing-provider-evidence`;
    await expect(store.commitToolResult({
      invocationId,
      artifact: {
        nodeKey: "image_prompts", kind: "image_prompts", title: "无证据图片", status: "needs_review",
        summary: "不应提交", markdownContent: "", structuredContent: {},
      },
      observation: {
        observationId: missingEvidenceObservationId,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        payload: {},
      },
      event: event(missingEvidenceObservationId, "missing-provider-evidence-event"),
    })).rejects.toThrow("GenerationJob and ValidationReport evidence");
    expect(await store.getToolInvocation(invocationId)).toMatchObject({ status: "running" });
    expect(await store.getObservation(wrongKindObservationId)).toBeNull();
    expect(await store.getObservation(missingEvidenceObservationId)).toBeNull();
  });

  it("binds a reused Artifact to its completed GenerationJob instead of trusting payload IDs", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Artifact replay binding" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-replay-binding", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const sourceArtifact = await prisma.artifact.create({
      data: {
        projectId: project.id,
        taskId: brief.taskId,
        taskBriefDigest: brief.digest,
        intentEpoch: 0,
        planRevision: 0,
        origin: "tool_result",
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "PPT设计稿",
        status: "approved",
        summary: "PPTX生成输入",
        markdownContent: "",
        structuredContentJson: trustedStructuredContentJson(),
        version: 1,
      },
    });
    const request = { sourceArtifactId: sourceArtifact.id, sourceArtifactVersion: sourceArtifact.version };
    const productionEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "generate_pptx_from_design", arguments: request },
    });
    const productionInvocationId = `${project.id}-artifact-production`;
    await store.startToolInvocation({
      invocationId: productionInvocationId,
      envelope: productionEnvelope,
      toolName: "generate_pptx_from_design",
      request,
    });
    const queuedJob = await service.createGenerationJob(project.id, {
      kind: "pptx",
      sourceArtifactId: sourceArtifact.id,
      capabilityId: "coze_ppt",
      idempotencyKey: productionEnvelope.idempotencyKey,
      sourceArtifactIds: [sourceArtifact.id],
      inputSnapshot: {
        toolName: "generate_pptx_from_design",
        arguments: request,
        taskBriefDigest: brief.digest,
        intentEpoch: brief.intentEpoch,
        sourceArtifacts: [{
          artifactId: sourceArtifact.id,
          kind: sourceArtifact.kind,
          version: sourceArtifact.version,
        }],
      },
    });
    const runningJob = (await service.startGenerationJobForExecution(project.id, queuedJob.id)).job;
    const artifactDraft = {
      nodeKey: "pptx_artifact" as const,
      kind: "pptx_artifact" as const,
      title: "已生成课件",
      summary: "真实生成结果",
      markdownContent: "",
      structuredContent: {},
    };
    const validationReport = validateToolExecutionResult({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: project.id,
      result: {
        status: "succeeded",
        artifactDraft,
        artifactTruth: {
          created: true,
          persisted: true,
          placeholder: false,
          producedArtifactKind: "pptx_artifact",
        },
        qualityGate: { passed: true, gates: ["offline_pptx_contract"] },
      },
      inputHash: runningJob.inputHash!,
      intentEpoch: brief.intentEpoch,
    });
    const productionObservationId = `${project.id}-artifact-production-observation`;
    await store.commitToolResult({
      invocationId: productionInvocationId,
      generationJobId: runningJob.id,
      artifact: { ...artifactDraft, status: "needs_review", validationReport },
      observation: {
        observationId: productionObservationId,
        status: "succeeded",
        reasonCodes: ["provider_tool_succeeded"],
        payload: {},
      },
      event: eventInput(
        project.id,
        brief.taskId,
        `${project.id}-artifact-production-event`,
        "artifact_committed",
        { observationId: productionObservationId, status: "succeeded" },
      ),
    });
    const productionInvocation = await store.getToolInvocation(productionInvocationId);
    const artifact = await prisma.artifact.findUniqueOrThrow({ where: { id: productionInvocation!.artifactId! } });
    const generationJob = await prisma.generationJob.findUniqueOrThrow({ where: { id: runningJob.id } });
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 1,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "generate_pptx_from_design", arguments: request },
    });
    const invocationId = `${project.id}-artifact-replay`;
    await store.startArtifactRouteToolInvocation({
      invocationId,
      envelope,
      toolName: "generate_pptx_from_design",
      request,
    });
    const observationId = `${project.id}-artifact-replay-observation`;
    const replayInput = {
      invocationId,
      observation: {
        observationId,
        status: "succeeded",
        reasonCodes: ["generation_result_reused"],
        payload: {},
      },
      event: {
        ...eventInput(project.id, brief.taskId, `${project.id}-artifact-replay-event`, "artifact_committed", {
          observationId,
          status: "succeeded",
        }),
        runId: `artifact-route:${invocationId}`,
      },
    };
    await expect(store.commitToolObservation({
      ...replayInput,
      existingArtifact: { artifactId: artifact.id, generationJobId: "missing-job" },
    })).rejects.toThrow("completed GenerationJob");
    await store.commitToolObservation({
      ...replayInput,
      existingArtifact: { artifactId: artifact.id, generationJobId: generationJob.id },
    });
    expect(await store.getToolInvocation(invocationId)).toMatchObject({
      status: "succeeded",
      artifactId: artifact.id,
      observationId,
    });
    expect(await store.getObservation(observationId)).toMatchObject({ artifactId: artifact.id });
    const event = await prisma.agentEventRecord.findUniqueOrThrow({ where: { eventId: replayInput.event.eventId } });
    expect(JSON.parse(event.payloadJson)).toMatchObject({
      artifactId: artifact.id,
      observationId,
      reasonCodes: ["generation_result_reused"],
      toolName: "generate_pptx_from_design",
    });

    await prisma.validationReportRecord.delete({ where: { generationJobId: generationJob.id } });
    const rejectedEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief: brief,
      planRevision: 2,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "generate_pptx_from_design", arguments: request },
    });
    const rejectedInvocationId = `${project.id}-artifact-replay-without-report`;
    await store.startArtifactRouteToolInvocation({
      invocationId: rejectedInvocationId,
      envelope: rejectedEnvelope,
      toolName: "generate_pptx_from_design",
      request,
    });
    const rejectedObservationId = `${project.id}-artifact-replay-without-report-observation`;
    await expect(store.commitToolObservation({
      invocationId: rejectedInvocationId,
      existingArtifact: { artifactId: artifact.id, generationJobId: generationJob.id },
      observation: {
        observationId: rejectedObservationId,
        status: "succeeded",
        reasonCodes: ["generation_result_reused"],
        payload: {},
      },
      event: {
        ...eventInput(project.id, brief.taskId, `${project.id}-artifact-replay-without-report-event`, "artifact_committed", {
          observationId: rejectedObservationId,
          status: "succeeded",
        }),
        runId: `artifact-route:${rejectedInvocationId}`,
      },
    })).rejects.toThrow("valid persisted Provider evidence");
  });

  it("cannot fail another GenerationJob from the same project and IntentEpoch", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "GenerationJob invocation binding" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-generation-binding", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const createSource = (title: string) => prisma.artifact.create({
      data: {
        projectId: project.id, taskId: brief.taskId, taskBriefDigest: brief.digest,
        intentEpoch: brief.intentEpoch, planRevision: 0, origin: "tool_result",
        nodeKey: "ppt_design_draft", kind: "ppt_design_draft", title,
        status: "approved", summary: title, markdownContent: "", structuredContentJson: trustedStructuredContentJson(), version: 1,
      },
    });
    const [intendedSource, unrelatedSource] = await Promise.all([
      createSource("当前调用输入"),
      createSource("同 epoch 的其他输入"),
    ]);
    const createRunningJob = async (sourceArtifact: typeof intendedSource) => {
      const queued = await service.createGenerationJob(project.id, {
        kind: "pptx",
        sourceArtifactId: sourceArtifact.id,
        capabilityId: "coze_ppt",
        inputSnapshot: {
          source: {
            id: sourceArtifact.id,
            kind: sourceArtifact.kind,
            nodeKey: sourceArtifact.nodeKey,
            version: sourceArtifact.version,
          },
        },
      });
      return (await service.startGenerationJobForExecution(project.id, queued.id)).job;
    };
    const [intendedJob, unrelatedJob] = await Promise.all([
      createRunningJob(intendedSource),
      createRunningJob(unrelatedSource),
    ]);
    const request = {
      sourceArtifactId: intendedSource.id,
      sourceArtifactVersion: intendedSource.version,
    };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 0, intensity: "standard", intentGrant: grant,
      action: { toolName: "generate_pptx_from_design", arguments: request },
    });
    const invocationId = `${project.id}-generation-binding`;
    await store.startArtifactRouteToolInvocation({
      invocationId, envelope, toolName: "generate_pptx_from_design", request,
    });
    const rejectedObservationId = `${project.id}-wrong-job-observation`;
    await expect(store.commitToolFailure({
      invocationId,
      generationJob: { jobId: unrelatedJob.id, status: "failed", errorMessage: "wrong job" },
      observation: {
        observationId: rejectedObservationId,
        status: "failed",
        reasonCodes: ["provider_failed"],
        payload: {},
      },
      event: {
        ...eventInput(project.id, brief.taskId, `${project.id}-wrong-job-event`, "tool_observed", {
          observationId: rejectedObservationId,
          status: "failed",
        }),
        runId: `artifact-route:${invocationId}`,
      },
    })).rejects.toThrow("GenerationJob does not match");
    expect(await store.getToolInvocation(invocationId)).toMatchObject({ status: "running" });
    expect(await store.getObservation(rejectedObservationId)).toBeNull();
    expect(await prisma.generationJob.findUniqueOrThrow({ where: { id: unrelatedJob.id } }))
      .toMatchObject({ status: "running" });

    const observationId = `${project.id}-bound-job-observation`;
    await store.commitToolFailure({
      invocationId,
      generationJob: { jobId: intendedJob.id, status: "failed", errorMessage: "provider failed" },
      observation: { observationId, status: "failed", reasonCodes: ["provider_failed"], payload: {} },
      event: {
        ...eventInput(project.id, brief.taskId, `${project.id}-bound-job-event`, "tool_observed", {
          observationId,
          status: "failed",
        }),
        runId: `artifact-route:${invocationId}`,
      },
    });
    expect(await prisma.generationJob.findUniqueOrThrow({ where: { id: intendedJob.id } }))
      .toMatchObject({ status: "failed" });
  });

  it("rejects terminal replay when any audit, Observation, Event or Artifact fact is incomplete", async () => {
    const missingAudit = await createReplayFixtureWithoutTerminalAudit();
    await expect(replayFailedInvocation(missingAudit)).rejects.toThrow("terminal replay facts");

    const missingEvent = await createFailedReplayFixture("missing-event");
    await prisma.agentEventRecord.delete({ where: { eventId: missingEvent.eventId } });
    await expect(replayFailedInvocation(missingEvent)).rejects.toThrow("terminal replay facts");

    const mismatchedObservation = await createFailedReplayFixture("mismatched-observation");
    await prisma.observationRecord.update({
      where: { observationId: mismatchedObservation.observationId },
      data: { status: "succeeded" },
    });
    await expect(replayFailedInvocation(mismatchedObservation)).rejects.toThrow("terminal replay facts");

    const unexpectedArtifact = await createFailedReplayFixture("unexpected-artifact");
    const artifact = await prisma.artifact.create({
      data: {
        projectId: unexpectedArtifact.projectId,
        taskId: unexpectedArtifact.brief.taskId,
        taskBriefDigest: unexpectedArtifact.brief.digest,
        intentEpoch: unexpectedArtifact.brief.intentEpoch,
        planRevision: 0,
        origin: "main_agent",
        nodeKey: "requirement_spec",
        kind: "requirement_spec",
        title: "不应绑定到失败回放的成果",
        status: "draft",
        summary: "invalid replay fixture",
        markdownContent: "",
        structuredContentJson: "{}",
        version: 1,
      },
    });
    await prisma.toolInvocationRecord.update({
      where: { invocationId: unexpectedArtifact.invocationId },
      data: { artifactId: artifact.id },
    });
    await prisma.observationRecord.update({
      where: { observationId: unexpectedArtifact.observationId },
      data: { artifactId: artifact.id },
    });
    await expect(replayFailedInvocation(unexpectedArtifact)).rejects.toThrow("terminal replay facts");
  });

  it.each([
    ["authority", (report: ValidationReport) => reissueFailureReport(report, { authority: "advisory_semantic" as never })],
    ["domain", (report: ValidationReport) => reissueFailureReport(report, { domain: "generic" })],
    ["stage", (report: ValidationReport) => reissueFailureReport(report, { stage: "video_segment_generate" })],
    ["contract", (report: ValidationReport) => reissueFailureReport(report, {
      contract: { id: "tool:generate_video_segment", version: "tool-v1" },
    })],
    ["inputHash", (report: ValidationReport) => reissueFailureReport(report, { inputHash: "f".repeat(64) })],
    ["IntentEpoch", (report: ValidationReport) => reissueFailureReport(report, { intentEpoch: undefined })],
    ["target digest", (report: ValidationReport) => reissueFailureReport(report, {
      target: { ...report.target, targetDigest: "a".repeat(64) },
    })],
  ])("rejects a failure ValidationReport with caller-controlled %s", async (_label, mutate) => {
    const fixture = await createFailureValidationFixture();
    await expect(fixture.store.commitToolFailure({
      invocationId: fixture.invocationId,
      validationReport: mutate(fixture.report),
      observation: {
        observationId: fixture.observationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: {},
      },
      event: eventInput(fixture.projectId, fixture.brief.taskId, fixture.eventId, "tool_observed", {
        observationId: fixture.observationId,
        status: "failed",
      }),
    })).rejects.toThrow("ValidationReport is invalid");
    expect(await prisma.validationReportRecord.count({ where: { projectId: fixture.projectId } })).toBe(0);
    expect(await fixture.store.getToolInvocation(fixture.invocationId)).toMatchObject({ status: "running" });
  });

  it("persists a server-bound failure ValidationReport with the Tool capability identity", async () => {
    const fixture = await createFailureValidationFixture();
    await fixture.store.commitToolFailure({
      invocationId: fixture.invocationId,
      validationReport: fixture.report,
      observation: {
        observationId: fixture.observationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        payload: {},
      },
      event: eventInput(fixture.projectId, fixture.brief.taskId, fixture.eventId, "tool_observed", {
        observationId: fixture.observationId,
        status: "failed",
      }),
    });
    expect(await prisma.validationReportRecord.findUniqueOrThrow({ where: { id: fixture.report.reportId } }))
      .toMatchObject({ capabilityId: "requirement_spec", stage: "requirement_spec", overallStatus: "failed" });
  });

  it("rejects an Artifact replay produced by a different Tool and GenerationJob contract", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Cross-tool Artifact replay" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-cross-tool-replay", revision: 0, status: "active" },
      checkpoint: null,
    });
    await createRunningTurn(brief);
    const artifact = await prisma.artifact.create({
      data: {
        projectId: project.id, taskId: brief.taskId, taskBriefDigest: brief.digest,
        intentEpoch: 0, planRevision: 0, origin: "tool_result", nodeKey: "image_asset", kind: "image_asset",
        title: "另一工具的图片", status: "needs_review", summary: "不属于PPTX工具", markdownContent: "",
        structuredContentJson: "{}", version: 1,
      },
    });
    const generationJob = await prisma.generationJob.create({
      data: {
        projectId: project.id, kind: "image", sourceArtifactId: "source-artifact", intentEpoch: 0,
        status: "succeeded", pollState: "completed", resultArtifactId: artifact.id,
      },
    });
    const request = { sourceArtifactId: "source-artifact" };
    const envelope = createExecutionEnvelope({
      actorUserId: "teacher-1", taskBrief: brief, planRevision: 0, intensity: "standard", intentGrant: grant,
      action: { toolName: "generate_pptx_from_design", arguments: request },
    });
    const invocationId = `${project.id}-cross-tool-replay`;
    await store.startArtifactRouteToolInvocation({
      invocationId, envelope, toolName: "generate_pptx_from_design", request,
    });
    const observationId = `${project.id}-cross-tool-observation`;
    await expect(store.commitToolObservation({
      invocationId,
      existingArtifact: { artifactId: artifact.id, generationJobId: generationJob.id },
      observation: { observationId, status: "succeeded", reasonCodes: ["generation_result_reused"], payload: {} },
      event: {
        ...eventInput(project.id, brief.taskId, `${project.id}-cross-tool-event`, "artifact_committed", {
          observationId, status: "succeeded",
        }),
        runId: `artifact-route:${invocationId}`,
      },
    })).rejects.toThrow("contract");
    expect(await store.getToolInvocation(invocationId)).toMatchObject({ status: "running" });
  });

  it("atomically persists a run failure Observation while pausing the latest TaskAggregate", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "运行失败 Observation" });
    const brief = taskBrief(project.id);
    const grant = intentGrant(brief.taskId, project.id);
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: "plan-run-failure", revision: 4, status: "active" },
      checkpoint: null,
    });
    const observationId = `${project.id}-runtime-failure`;
    const committed = await store.commitRunFailure({
      taskBrief: brief,
      intentGrant: grant,
      observation: {
        observationId,
        status: "failed",
        reasonCodes: ["control_plane_lifecycle_conflict"],
        payload: { failureSignature: "a".repeat(64), summary: "控制面状态冲突" },
      },
      event: eventInput(project.id, brief.taskId, `${project.id}-runtime-failure-event`, "run_failed"),
    });

    expect(committed.aggregate).toMatchObject({
      status: "paused_recovery",
      plan: { revision: 4, status: "paused_recovery" },
    });
    expect(await store.getObservation(observationId)).toMatchObject({
      observationId,
      status: "failed",
      reasonCodes: ["control_plane_lifecycle_conflict"],
    });
    expect(committed.event).toMatchObject({ kind: "run_failed", sequence: expect.any(Number) });
  });
});

function taskBrief(projectId: string) {
  return createTaskBrief({
    taskId: `task-${projectId}`,
    projectId,
    intentEpoch: 0,
    goal: "整理百分数备课需求",
    requestedOutputs: ["requirement_spec"],
    constraints: ["五年级数学"],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: "message-1",
  });
}

function intentGrant(taskId: string, projectId: string): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId,
    projectId,
    intentEpoch: 0,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: "standard.v1",
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

function snapshotScope(brief: ReturnType<typeof taskBrief>, maxPlanRevision: number) {
  return {
    projectId: brief.projectId,
    taskId: brief.taskId,
    intentEpoch: brief.intentEpoch,
    maxPlanRevision,
  };
}

function eventInput(
  projectId: string,
  taskId: string,
  eventId: string,
  kind: "task_created" | "task_updated" | "tool_started" | "tool_observed" | "artifact_committed" | "decision_pending" | "run_failed",
  payload: Record<string, unknown> = {},
) {
  return {
    eventId,
    projectId,
    taskId,
    runId: "turn:message-1",
    intentEpoch: 0,
    kind,
    visibility: "internal" as const,
    occurredAt: "2026-07-14T00:00:00.000Z",
    payload,
  };
}

async function createRunningTurn(
  brief: ReturnType<typeof taskBrief>,
  overrides: { actorUserId?: string; actorAuthMode?: string; authSessionId?: string | null } = {},
) {
  return prisma.conversationTurnJob.create({
    data: {
      projectId: brief.projectId,
      teacherMessageId: brief.sourceMessageId,
      status: "running",
      actorUserId: overrides.actorUserId ?? "teacher-1",
      actorAuthMode: overrides.actorAuthMode ?? "local",
      authSessionId: overrides.authSessionId ?? null,
    },
  });
}

async function createFailedReplayFixture(label: string) {
  const service = createWorkbenchService();
  const project = await service.createProject({ title: `Terminal replay ${label}` });
  const brief = taskBrief(project.id);
  const grant = intentGrant(brief.taskId, project.id);
  const store = createControlPlaneStore();
  await store.upsertTaskAggregate({
    taskBrief: brief,
    intentGrant: grant,
    plan: { planId: `plan-replay-${label}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  await createRunningTurn(brief);
  const request = { goal: brief.goal, label };
  const envelope = createExecutionEnvelope({
    actorUserId: "teacher-1",
    taskBrief: brief,
    planRevision: 0,
    intensity: "standard",
    intentGrant: grant,
    action: { toolName: "create_requirement_spec", arguments: request },
  });
  const invocationId = `${project.id}-replay-${label}`;
  const observationId = `${invocationId}-observation`;
  const eventId = `${invocationId}-event`;
  await store.startToolInvocation({ invocationId, envelope, toolName: "create_requirement_spec", request });
  await store.commitToolFailure({
    invocationId,
    observation: { observationId, status: "failed", reasonCodes: ["validation_failed"], payload: {} },
    event: eventInput(project.id, brief.taskId, eventId, "tool_observed", {
      observationId,
      status: "failed",
    }),
  });
  return { store, projectId: project.id, brief, envelope, request, invocationId, observationId, eventId };
}

async function createReplayFixtureWithoutTerminalAudit() {
  const fixture = await createClaimedReplayFixture("missing-audit");
  await prisma.observationRecord.create({
    data: {
      observationId: fixture.observationId,
      projectId: fixture.projectId,
      taskId: fixture.brief.taskId,
      invocationId: fixture.invocationId,
      intentEpoch: fixture.brief.intentEpoch,
      status: "failed",
      reasonCodesJson: JSON.stringify(["validation_failed"]),
      payloadJson: "{}",
    },
  });
  await prisma.agentEventRecord.create({
    data: {
      eventId: fixture.eventId,
      projectId: fixture.projectId,
      taskId: fixture.brief.taskId,
      runId: `turn:${fixture.brief.sourceMessageId}`,
      intentEpoch: fixture.brief.intentEpoch,
      sequence: 1,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date("2026-07-14T00:00:00.000Z"),
      envelopeJson: "{}",
      payloadJson: JSON.stringify({
        observationId: fixture.observationId,
        status: "failed",
        reasonCodes: ["validation_failed"],
        toolName: "create_requirement_spec",
      }),
    },
  });
  await prisma.toolInvocationRecord.update({
    where: { invocationId: fixture.invocationId },
    data: { status: "failed", observationId: fixture.observationId, finishedAt: new Date() },
  });
  return fixture;
}

async function createClaimedReplayFixture(label: string) {
  const service = createWorkbenchService();
  const project = await service.createProject({ title: `Claimed terminal replay ${label}` });
  const brief = taskBrief(project.id);
  const grant = intentGrant(brief.taskId, project.id);
  const store = createControlPlaneStore();
  await store.upsertTaskAggregate({
    taskBrief: brief,
    intentGrant: grant,
    plan: { planId: `plan-claimed-replay-${label}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  await createRunningTurn(brief);
  const request = { goal: brief.goal, label };
  const envelope = createExecutionEnvelope({
    actorUserId: "teacher-1",
    taskBrief: brief,
    planRevision: 0,
    intensity: "standard",
    intentGrant: grant,
    action: { toolName: "create_requirement_spec", arguments: request },
  });
  const invocationId = `${project.id}-claimed-replay-${label}`;
  await store.startToolInvocation({ invocationId, envelope, toolName: "create_requirement_spec", request });
  return {
    store,
    projectId: project.id,
    brief,
    envelope,
    request,
    invocationId,
    observationId: `${invocationId}-observation`,
    eventId: `${invocationId}-event`,
  };
}

function replayFailedInvocation(fixture: Awaited<ReturnType<typeof createFailedReplayFixture>>) {
  return fixture.store.startToolInvocation({
    invocationId: `${fixture.invocationId}-replay-request`,
    envelope: fixture.envelope,
    toolName: "create_requirement_spec",
    request: fixture.request,
  });
}

async function createFailureValidationFixture() {
  const service = createWorkbenchService();
  const project = await service.createProject({ title: `Failure validation ${randomUUID()}` });
  const brief = taskBrief(project.id);
  const grant = intentGrant(brief.taskId, project.id);
  const store = createControlPlaneStore();
  await store.upsertTaskAggregate({
    taskBrief: brief,
    intentGrant: grant,
    plan: { planId: `plan-validation-${project.id}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  await createRunningTurn(brief);
  const tool = getToolDefinition("create_requirement_spec");
  const contract = resolveRuntimeContract(tool);
  const request = { goal: brief.goal };
  const envelope = createExecutionEnvelope({
    actorUserId: "teacher-1",
    taskBrief: brief,
    planRevision: 0,
    intensity: "standard",
    intentGrant: grant,
    action: { toolName: tool.id, arguments: request },
  });
  const invocationId = `${project.id}-validation`;
  await store.startToolInvocation({ invocationId, envelope, toolName: tool.id, request });
  const report = createValidationReport({
    reportId: `${invocationId}-report`,
    createdAt: "2026-07-19T00:00:00.000Z",
    domain: "lesson",
    stage: contract.capabilityId,
    target: { kind: "tool_invocation", targetId: invocationId },
    contract: { id: contract.id, version: contract.version },
    inputHash: envelope.idempotencyKey,
    intentEpoch: brief.intentEpoch,
    overallStatus: "failed",
    gates: [],
  });
  return {
    store,
    projectId: project.id,
    brief,
    invocationId,
    report,
    observationId: `${invocationId}-observation`,
    eventId: `${invocationId}-event`,
  };
}

function reissueFailureReport(report: ValidationReport, patch: Partial<ValidationReport>) {
  const input = omitFixtureFields(report, "reportDigest");
  return createValidationReport({ ...input, ...patch } as never);
}

function orchestrationAuditDigest(event: Record<string, unknown>) {
  const payload = Object.fromEntries(Object.entries(event).filter(([key]) => !["sequence", "eventDigest", "createdAt"].includes(key)));
  if (payload.occurredAt instanceof Date) payload.occurredAt = payload.occurredAt.toISOString();
  return createHash("sha256")
    .update("shanhai-orchestration-audit-event.v1\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}

function artifactInput(title: string) {
  return {
    nodeKey: "requirement_spec" as const,
    kind: "requirement_spec" as const,
    title,
    status: "needs_review" as const,
    summary: "结构化需求规格。",
    markdownContent: "# 需求规格",
    structuredContent: { goal: "整理百分数备课需求" },
  };
}

function trustedStructuredContentJson() {
  return JSON.stringify({
    artifactQualityState: {
      validationStatus: "passed",
      reviewStatus: "passed",
      downstreamEligibility: "eligible",
    },
  });
}

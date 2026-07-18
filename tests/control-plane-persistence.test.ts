import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import { prisma } from "@/server/db/client";
import { createWorkbenchService } from "@/server/workbench/service";

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
    })).rejects.toThrow("terminal status");
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
    })).rejects.toThrow("terminal status");
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
  kind: "task_created" | "task_updated" | "tool_started" | "tool_observed" | "artifact_committed" | "run_failed",
  payload: Record<string, unknown> = {},
) {
  return {
    eventId,
    projectId,
    taskId,
    runId: "run-1",
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

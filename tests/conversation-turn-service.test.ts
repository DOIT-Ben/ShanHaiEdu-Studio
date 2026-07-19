import { describe, expect, it, vi } from "vitest";

import { FixtureAgentRuntime } from "./helpers/fixture-agent-runtime";
import { createWorkbenchActor } from "@/server/auth/actor";
import { readAgentObservationsFromMessages } from "@/server/conversation/react-control";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import type {
  MainConversationAgent,
  MainConversationAgentInput,
} from "@/server/conversation/main-conversation-agent";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import {
  createTaskBrief,
  type IntentGrant,
  type PendingDecision,
  type TaskRequestedOutput,
} from "@/server/conversation/task-contract";
import { prisma } from "@/server/db/client";
import {
  createPendingDecisionForAction,
  STANDARD_BUDGET_POLICY_VERSION,
} from "@/server/guards/action-policy";
import { createWorkbenchService as createWorkbenchServiceBase } from "@/server/workbench/service";

describe("ConversationTurnService current control contract", () => {
  it("keeps an undecided format discussion in the current IntentEpoch without exposing a Tool loop", async () => {
    const { service, project, controlPlaneStore } = await createProjectFixture("普通讨论零 Tool");
    const seeded = await seedTask({
      service,
      controlPlaneStore,
      projectId: project.id,
      requestedOutputs: ["ppt"],
      goal: "制作五年级数学百分数公开课 PPT",
    });
    const respond = vi.fn();
    const intakeTask = vi.fn(async () => ({
      kind: "conversation" as const,
      turn: chatTurn("可以先比较 PPT 和视频分别适合解决什么教学问题。"),
    }));
    const turnService = createConversationTurnService({
      service,
      runtime: new FixtureAgentRuntime(),
      agent: { intakeTask, async respond(input) { respond(input); return chatTurn("不应调用"); } },
      controlPlaneStore,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "是否改成视频，我还没决定，先聊聊两者的区别。",
    });

    expect(result.agentTurn).toMatchObject({ state: "chatting", shouldRunToolNow: false });
    expect(result.assistantMessage?.content).toContain("先比较 PPT 和视频");
    expect(intakeTask).toHaveBeenCalledOnce();
    expect(respond).not.toHaveBeenCalled();
    expect((await service.getProject(project.id)).intentEpoch).toBe(0);
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "active",
      taskBrief: { taskId: seeded.taskBrief.taskId, digest: seeded.taskBrief.digest },
    });
    expect(await service.getArtifacts(project.id)).toEqual([]);
    await expect(prisma.toolInvocationRecord.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("commits one TaskBrief and gives the Main Agent the native Tool loop", async () => {
    const fixture = await createProjectFixture("TaskBrief 与 native loop", {
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const { service, project, executionIdentity, controlPlaneStore } = fixture;
    const lease = await acquireLease(service, project.id);
    let capturedInput: MainConversationAgentInput | undefined;
    const agent: MainConversationAgent = {
      async intakeTask(input) {
        return requirementTask(input.userMessage);
      },
      async respond(input) {
        capturedInput = input;
        return succeededTurn("本轮目标已经明确，可以开始整理需求。");
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new FixtureAgentRuntime(),
        agent,
        controlPlaneStore,
        executionIdentity,
        executionFence: lease.fence,
      });

      const result = await turnService.createTurn(project.id, {
        role: "teacher",
        content: "只做五年级数学百分数的需求规格，不生成教案、PPT、图片、视频或整包。",
      });

      expect(capturedInput?.taskBrief).toMatchObject({
        projectId: project.id,
        intentEpoch: 0,
        requestedOutputs: ["requirement_spec"],
        excludedOutputs: expect.arrayContaining(["lesson_plan", "ppt", "image", "video", "package"]),
      });
      expect(capturedInput?.intentGrant).toMatchObject({
        projectId: project.id,
        standardWorkAuthorized: true,
        budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
      });
      expect(capturedInput?.agentToolLoop?.allowedToolNames).toEqual(expect.arrayContaining([
        "request_teacher_decision",
        "create_requirement_spec",
      ]));
      expect(result.assistantMessage?.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "activity",
          activityKind: "task",
          label: "本轮目标已明确",
          status: "completed",
        }),
      ]));

      const teacher = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
      expect(teacher.metadata.taskBrief).toMatchObject({
        taskId: capturedInput?.taskBrief?.taskId,
        digest: capturedInput?.taskBrief?.digest,
      });
      await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
        status: "active",
        taskBrief: { digest: capturedInput?.taskBrief?.digest },
      });
    } finally {
      await service.releaseProjectExecutionLease(lease.fence);
    }
  });

  it("executes a model-selected business Tool only through agentToolLoop and persists its Observation", async () => {
    const fixture = await createProjectFixture("native business Tool", {
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const { service, project, actor, executionIdentity, controlPlaneStore } = fixture;
    const lease = await acquireLease(service, project.id);
    const agent: MainConversationAgent = {
      async intakeTask(input) {
        return requirementTask(input.userMessage);
      },
      async respond(input) {
        await seedRunningTurnJob(input, actor.userId);
        const observation = await input.agentToolLoop!.dispatch({
          callId: "requirement-spec-call",
          toolName: "create_requirement_spec",
          arguments: {},
        });
        expect(observation).toMatchObject({ status: "succeeded" });
        return succeededTurn("需求规格已经生成并保存。");
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new FixtureAgentRuntime(),
        agent,
        controlPlaneStore,
        executionIdentity,
        executionFence: lease.fence,
      });

      await turnService.createTurn(project.id, {
        role: "teacher",
        content: "只做五年级数学百分数的需求规格。",
      });

      expect(await service.getArtifacts(project.id)).toEqual([
        expect.objectContaining({
          kind: "requirement_spec",
          taskId: expect.any(String),
          taskBriefDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      expect(readAgentObservationsFromMessages(await service.getMessages(project.id))).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actionKey: "create_requirement_spec",
          status: "succeeded",
          reasonCodes: expect.arrayContaining(["business_tool_succeeded"]),
        }),
      ]));
      await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
        status: "active",
        plan: { revision: 1 },
      });
    } finally {
      await service.releaseProjectExecutionLease(lease.fence);
    }
  });

  it("confirms only the bound PendingDecision and resumes its signed checkpoint", async () => {
    const fixture = await createProjectFixture("确认 PendingDecision");
    const { service, project, actor, executionIdentity, controlPlaneStore } = fixture;
    const lease = await acquireLease(service, project.id);
    const pending = await seedPendingDecision({
      service,
      controlPlaneStore,
      projectId: project.id,
      actorUserId: actor.userId,
    });
    let capturedInput: MainConversationAgentInput | undefined;
    const agent: MainConversationAgent = {
      async intakeTask() {
        throw new Error("confirmation must reuse the frozen TaskBrief");
      },
      async respond(input) {
        capturedInput = input;
        return succeededTurn("授权已确认，继续当前任务。");
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new FixtureAgentRuntime(),
        agent,
        controlPlaneStore,
        executionIdentity,
        executionFence: lease.fence,
      });
      await turnService.createTurn(project.id, {
        role: "teacher",
        content: "确认继续",
        confirmedActionId: pending.decision.actionId,
      });

      expect(capturedInput?.taskBrief).toMatchObject({
        taskId: pending.taskBrief.taskId,
        digest: pending.taskBrief.digest,
      });
      expect(capturedInput?.intentGrant).toMatchObject({ standardWorkAuthorized: true });
      expect(capturedInput?.agentToolLoop?.resumeCheckpoint).toMatchObject({
        schemaVersion: "react-checkpoint.v1",
        task: { authorization: { standardWorkAuthorized: true } },
      });
      expect(await readPendingDecision(service, project.id, pending.decisionMessageId)).toMatchObject({
        decisionId: pending.decision.decisionId,
        actionId: pending.decision.actionId,
        status: "confirmed",
      });
      await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
        status: "active",
        checkpoint: { schemaVersion: "react-checkpoint.v1" },
      });
    } finally {
      await service.releaseProjectExecutionLease(lease.fence);
    }
  });

  it("cancels the bound PendingDecision without invoking the Main Agent", async () => {
    const fixture = await createProjectFixture("取消 PendingDecision");
    const { service, project, actor, executionIdentity, controlPlaneStore } = fixture;
    const pending = await seedPendingDecision({
      service,
      controlPlaneStore,
      projectId: project.id,
      actorUserId: actor.userId,
    });
    const respond = vi.fn(async () => succeededTurn("不应调用"));
    const turnService = createConversationTurnService({
      service,
      runtime: new FixtureAgentRuntime(),
      agent: { async intakeTask() { throw new Error("must not intake"); }, respond },
      controlPlaneStore,
      executionIdentity,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "取消",
      confirmedActionId: pending.decision.actionId,
    });

    expect(respond).not.toHaveBeenCalled();
    expect(result.assistantMessage?.content).toContain("已取消当前任务");
    expect((await service.getProject(project.id)).intentEpoch).toBe(1);
    expect(await readPendingDecision(service, project.id, pending.decisionMessageId)).toMatchObject({
      decisionId: pending.decision.decisionId,
      status: "canceled",
    });
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "canceled",
      checkpoint: { schemaVersion: "react-checkpoint.v1" },
    });
  });

  it("keeps the task paused when a confirmation carries the wrong actionId", async () => {
    const fixture = await createProjectFixture("错误 actionId");
    const { service, project, actor, executionIdentity, controlPlaneStore } = fixture;
    const pending = await seedPendingDecision({
      service,
      controlPlaneStore,
      projectId: project.id,
      actorUserId: actor.userId,
    });
    const respond = vi.fn(async () => chatTurn("不应调用"));
    const turnService = createConversationTurnService({
      service,
      runtime: new FixtureAgentRuntime(),
      agent: {
        async intakeTask() {
          throw new Error("a confirmation-shaped reply must reuse the frozen task");
        },
        respond,
      },
      controlPlaneStore,
      executionIdentity,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "确认继续",
      confirmedActionId: `wrong:${crypto.randomUUID()}`,
    });

    expect(respond).not.toHaveBeenCalled();
    expect(result.assistantMessage?.content).toContain("没有执行任何操作");
    expect(result.assistantMessage?.metadata.pendingDecision).toMatchObject({
      decisionId: pending.decision.decisionId,
      status: "pending",
    });
    expect(await readPendingDecision(service, project.id, pending.decisionMessageId)).toMatchObject({
      decisionId: pending.decision.decisionId,
      status: "pending",
    });
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "paused_recovery",
      checkpoint: { checkpointDigest: pending.checkpoint.checkpointDigest },
    });
  });

  it("persists a retryable failure and naturally resumes the same TaskBrief", async () => {
    const { service, project, controlPlaneStore } = await createProjectFixture("失败恢复", {
      grade: "七年级",
      subject: "语文",
      lessonTopic: "春",
    });
    const intakeTask = vi.fn(async (input: { userMessage: string }) => requirementTask(input.userMessage));
    let respondCount = 0;
    let frozenTaskId = "";
    let frozenDigest = "";
    const agent: MainConversationAgent = {
      intakeTask,
      async respond(input) {
        respondCount += 1;
        if (respondCount === 1) {
          frozenTaskId = input.taskBrief!.taskId;
          frozenDigest = input.taskBrief!.digest;
          return retryableFailureTurn();
        }
        expect(input.taskBrief).toMatchObject({ taskId: frozenTaskId, digest: frozenDigest });
        return succeededTurn("已从保存位置继续当前任务。");
      },
    };
    const turnService = createConversationTurnService({
      service,
      runtime: new FixtureAgentRuntime(),
      agent,
      controlPlaneStore,
    });

    const failed = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "只整理七年级语文《春》的备课需求。",
    });
    expect(failed.assistantMessage?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "error-recovery",
        reasonCode: "main_agent_provider_unavailable",
        recovery: expect.objectContaining({ kind: "retry" }),
      }),
    ]));
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "paused_recovery",
      taskBrief: { taskId: frozenTaskId, digest: frozenDigest },
    });

    const resumed = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "继续刚才的任务",
    });
    expect(resumed.agentTurn).toMatchObject({ state: "succeeded" });
    expect(intakeTask).toHaveBeenCalledOnce();
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "active",
      taskBrief: { taskId: frozenTaskId, digest: frozenDigest },
    });
  });

  it("rejects a queued TaskBrief after its IntentEpoch has changed", async () => {
    const { service, project, controlPlaneStore } = await createProjectFixture("过期队列任务");
    const seeded = await seedTask({
      service,
      controlPlaneStore,
      projectId: project.id,
      requestedOutputs: ["requirement_spec"],
      goal: "整理需求规格",
    });
    await service.advanceProjectIntentEpoch(project.id, 0);
    const intakeTask = vi.fn(async () => requirementTask("不应重新接收"));
    const turnService = createConversationTurnService({
      service,
      runtime: new FixtureAgentRuntime(),
      agent: { intakeTask, async respond() { throw new Error("must not run"); } },
      controlPlaneStore,
    });

    await expect(turnService.executeQueuedTurn(project.id, {
      teacherMessageId: seeded.teacherMessage.id,
    })).rejects.toThrow("queued_task_brief_binding_invalid");
    expect(intakeTask).not.toHaveBeenCalled();
    expect((await service.getProject(project.id)).intentEpoch).toBe(1);
  });
});

async function createProjectFixture(
  title: string,
  projectInput: { grade?: string; subject?: string; lessonTopic?: string } = {},
) {
  const actor = createWorkbenchActor({
    userId: `conversation-turn-${crypto.randomUUID()}`,
    displayName: "Conversation Turn Test Actor",
    authMode: "local",
  });
  const executionIdentity = {
    actorUserId: actor.userId,
    actorAuthMode: "local" as const,
    authSessionId: null,
  };
  const service = createWorkbenchServiceBase(undefined, actor, executionIdentity);
  const project = await service.createProject({ title: `${title}-${crypto.randomUUID()}`, ...projectInput });
  return { actor, executionIdentity, service, project, controlPlaneStore: createControlPlaneStore() };
}

async function acquireLease(
  service: ReturnType<typeof createWorkbenchServiceBase>,
  projectId: string,
) {
  const holderId = `turn-worker-${crypto.randomUUID()}`;
  const lease = await service.acquireProjectExecutionLease({ projectId, holderId, leaseMs: 60_000 });
  if (!lease) throw new Error("test execution lease was not acquired");
  return {
    fence: { projectId, holderId, fencingToken: lease.fencingToken },
  };
}

async function seedTask(input: {
  service: ReturnType<typeof createWorkbenchServiceBase>;
  controlPlaneStore: ReturnType<typeof createControlPlaneStore>;
  projectId: string;
  requestedOutputs: TaskRequestedOutput[];
  goal: string;
  standardWorkAuthorized?: boolean;
  status?: "active" | "paused_recovery";
}) {
  const project = await input.service.getProject(input.projectId);
  const teacherMessage = await input.service.addMessage(input.projectId, {
    role: "teacher",
    content: input.goal,
  });
  const taskBrief = createTaskBrief({
    taskId: `task:${teacherMessage.id}`,
    projectId: input.projectId,
    intentEpoch: project.intentEpoch ?? 0,
    goal: input.goal,
    requestedOutputs: input.requestedOutputs,
    constraints: [],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: teacherMessage.id,
  });
  const intentGrant = createGrant(taskBrief, input.standardWorkAuthorized ?? true);
  const status = input.status ?? "active";
  const plan = { planId: `plan:${taskBrief.taskId}`, revision: 0, status };
  await input.service.updateMessageMetadata(input.projectId, teacherMessage.id, { taskBrief, intentGrant });
  await input.controlPlaneStore.upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan,
    status,
    checkpoint: null,
  });
  return { teacherMessage, taskBrief, intentGrant, plan };
}

async function seedPendingDecision(input: {
  service: ReturnType<typeof createWorkbenchServiceBase>;
  controlPlaneStore: ReturnType<typeof createControlPlaneStore>;
  projectId: string;
  actorUserId: string;
}) {
  const seeded = await seedTask({
    service: input.service,
    controlPlaneStore: input.controlPlaneStore,
    projectId: input.projectId,
    requestedOutputs: ["requirement_spec"],
    goal: "整理当前课程的需求规格",
    standardWorkAuthorized: false,
    status: "paused_recovery",
  });
  const checkpoint = createMainAgentReActCheckpoint({
    request: { instructions: "continue the current task", input: seeded.taskBrief.goal },
    seed: {
      projectId: input.projectId,
      taskId: seeded.taskBrief.taskId,
      taskBriefDigest: seeded.taskBrief.digest,
      intentEpoch: seeded.taskBrief.intentEpoch,
      planRevision: seeded.plan.revision,
      generationIntensity: seeded.taskBrief.generationIntensity,
      authorization: {
        standardWorkAuthorized: seeded.intentGrant.standardWorkAuthorized,
        budgetPolicyVersion: seeded.intentGrant.budgetPolicyVersion,
        maxCostCredits: seeded.intentGrant.maxCostCredits,
        maxExternalProviderCalls: seeded.intentGrant.maxExternalProviderCalls,
      },
    },
    records: [],
    currentToolNames: ["create_requirement_spec"],
  });
  const decision = createPendingDecisionForAction({
    action: "external_generation",
    decision: { kind: "human_gate", reason: "missing_grant" },
    actionId: `action:${crypto.randomUUID()}`,
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    taskId: seeded.taskBrief.taskId,
    intentEpoch: seeded.taskBrief.intentEpoch,
    planId: seeded.plan.planId,
    intentGrant: seeded.intentGrant,
  });
  await input.controlPlaneStore.upsertTaskAggregate({
    taskBrief: seeded.taskBrief,
    intentGrant: seeded.intentGrant,
    plan: seeded.plan,
    status: "paused_recovery",
    checkpoint,
  });
  const event = await input.controlPlaneStore.appendEvent({
    eventId: crypto.randomUUID(),
    projectId: input.projectId,
    taskId: seeded.taskBrief.taskId,
    runId: `turn:${seeded.teacherMessage.id}`,
    intentEpoch: seeded.taskBrief.intentEpoch,
    kind: "decision_pending",
    visibility: "teacher",
    occurredAt: new Date().toISOString(),
    payload: { decisionId: decision.decisionId, actionId: decision.actionId },
  });
  await input.controlPlaneStore.saveSemanticSnapshot(buildSemanticContextSnapshot({
    taskBrief: seeded.taskBrief,
    plan: seeded.plan,
    pendingDecision: decision,
    trustedArtifactRefs: [],
    observationRefs: [],
    recentMessages: [{ role: "teacher", content: seeded.teacherMessage.content }],
  }), event.sequence);
  const decisionMessage = await input.service.addMessage(input.projectId, {
    role: "assistant",
    content: `${decision.question}\n\n${decision.impactSummary}`,
    metadata: { pendingDecision: decision },
  });
  return {
    ...seeded,
    checkpoint,
    decision,
    decisionMessageId: decisionMessage.id,
  };
}

async function readPendingDecision(
  service: ReturnType<typeof createWorkbenchServiceBase>,
  projectId: string,
  messageId: string,
) {
  const message = (await service.getMessages(projectId)).find((candidate) => candidate.id === messageId);
  return message?.metadata.pendingDecision as PendingDecision | undefined;
}

async function seedRunningTurnJob(input: MainConversationAgentInput, actorUserId: string) {
  if (!input.taskBrief) throw new Error("test task is missing");
  await prisma.conversationTurnJob.create({
    data: {
      projectId: input.taskBrief.projectId,
      teacherMessageId: input.taskBrief.sourceMessageId,
      status: "running",
      actorUserId,
      actorAuthMode: "local",
    },
  });
}

function requirementTask(goal: string) {
  return {
    kind: "task" as const,
    proposal: {
      goal,
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
    },
  };
}

function createGrant(taskBrief: ReturnType<typeof createTaskBrief>, standardWorkAuthorized: boolean): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: standardWorkAuthorized ? STANDARD_BUDGET_POLICY_VERSION : null,
    maxCostCredits: null,
    maxExternalProviderCalls: standardWorkAuthorized ? 2 : null,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

function chatTurn(body: string) {
  return {
    assistantMessage: { body },
    state: "chatting" as const,
    quickReplies: [],
    recommendedOptions: [],
    shouldRunToolNow: false,
    runtimeKind: "openai" as const,
  };
}

function succeededTurn(body: string) {
  return {
    ...chatTurn(body),
    state: "succeeded" as const,
  };
}

function retryableFailureTurn() {
  return {
    ...chatTurn("智能生成服务暂时不可用，当前进度已经保存。"),
    state: "failed_retryable" as const,
    failure: {
      phase: "agent_tool_loop" as const,
      reasonCode: "main_agent_provider_unavailable",
      category: "provider_unavailable" as const,
      retryability: "after_provider_health_change" as const,
      summary: "当前智能服务通道暂时不可用。",
    },
  };
}

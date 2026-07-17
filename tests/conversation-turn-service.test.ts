import { describe, expect, it, vi } from "vitest";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { buildAgentHarnessBudgetEvent, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant, type TaskRequestedOutput } from "@/server/conversation/task-contract";
import { evaluateActionPolicy, STANDARD_BUDGET_POLICY_VERSION } from "@/server/guards/action-policy";
import { appendAgentObservationMetadata, createAgentObservation, readAgentObservationsFromMessages, readLatestRunCheckpointFromMessages } from "@/server/conversation/react-control";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import { createMainConversationAgentFromEnv } from "@/server/conversation/model-main-conversation-agent";
import type { CapabilityId } from "@/server/capabilities/types";
import { createToolObservation, readActiveToolObservationsFromMessages } from "@/server/capabilities/tool-observation";
import { routeToolCall } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import { createWorkbenchService as createWorkbenchServiceBase } from "@/server/workbench/service";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import { withPassedValidationReport } from "./support/validation-report";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";
import { validPptDirectorOutput } from "./support/ppt-director-output-fixture";

function createWorkbenchService(...args: Parameters<typeof createWorkbenchServiceBase>) {
  if (args.length > 0) return createWorkbenchServiceBase(...args);
  const actor = createWorkbenchActor({
    userId: `conversation-turn-test-${crypto.randomUUID()}`,
    displayName: "Conversation Turn Test Actor",
    authMode: "local",
  });
  return createWorkbenchServiceBase(undefined, actor, {
    actorUserId: actor.userId,
    actorAuthMode: "local",
    authSessionId: null,
  });
}

const legacyProviderMocks = vi.hoisted(() => ({
  generateImageFromArtifact: vi.fn(async () => {
    throw new Error("legacy image provider bypass invoked");
  }),
  generateVideoFromArtifact: vi.fn(async () => {
    throw new Error("legacy video provider bypass invoked");
  }),
}));

vi.mock("@/server/image-generation/image-generation-run", () => ({
  generateImageFromArtifact: legacyProviderMocks.generateImageFromArtifact,
}));

vi.mock("@/server/video-generation/video-generation-run", () => ({
  generateVideoFromArtifact: legacyProviderMocks.generateVideoFromArtifact,
}));

const fullDeliveryCapabilityIds = [
  "requirement_spec",
  "lesson_plan",
  "ppt_outline",
  "ppt_design",
  "ppt_sample_assets",
  "ppt_key_samples",
  "ppt_full_assets",
  "ppt_full_deck",
  "image_asset",
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "asset_image_generate",
  "video_segment_plan",
  "video_segment_generate",
  "video_narration_generate",
  "concat_only_assemble",
  "final_package",
];

describe("M54-B3 ConversationTurnService route contract", () => {
  it("returns one teacher-safe recoverable failure when native Main Agent configuration is unavailable", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: `provider-unavailable-${crypto.randomUUID()}` });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: createMainConversationAgentFromEnv({
        NODE_ENV: "development",
        SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
      }),
      enableNativeToolControlPlane: true,
      enableTaskGrantAutonomy: true,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "五年级数学百分数，帮我做一份PPT大纲",
    });

    expect(result.agentTurn).toMatchObject({
      state: "failed_retryable",
      shouldRunToolNow: false,
      quickReplies: [],
      failure: {
        reasonCode: "main_agent_provider_unavailable",
        retryability: "after_provider_health_change",
      },
    });
    expect(result.assistantMessage?.content).toContain("智能生成服务暂时不可用");
    expect(result.assistantMessage?.content).not.toMatch(/schema|provider|debug|local path|token/i);
    expect(result.assistantMessage?.parts?.filter((part) => part.type === "error-recovery")).toEqual([
      expect.objectContaining({
        reasonCode: "main_agent_provider_unavailable",
        recovery: expect.objectContaining({ kind: "retry" }),
      }),
    ]);
  });

  it("forwards one validated task ExecutionEnvelope through the compatibility ToolRouter boundary", async () => {
    const actor = createWorkbenchActor({
      userId: `teacher-${crypto.randomUUID()}`,
      displayName: "Teacher",
      authMode: "local",
    });
    const executionIdentity = { actorUserId: actor.userId, actorAuthMode: "local" as const, authSessionId: null };
    const service = createWorkbenchServiceBase(undefined, actor, executionIdentity);
    const project = await service.createProject({
      title: "Compatibility ToolRouter execution envelope",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const controlPlaneStore = createControlPlaneStore();
    const routed = vi.fn(async (routerInput: Parameters<typeof routeToolCall>[0]) => {
      expect(routerInput.executionEnvelope).toMatchObject({
        actorUserId: actor.userId,
        projectId: project.id,
        intentEpoch: 0,
        planRevision: 0,
        intensity: "standard",
      });
      expect(routerInput.executionEnvelope?.taskBriefDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(routerInput.executionEnvelope?.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
      return routeToolCall(routerInput);
    });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      controlPlaneStore,
      toolRouter: routed,
      executionIdentity,
      enableTaskGrantAutonomy: true,
    });

    const body = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "请做五年级数学百分数公开课PPT，用投篮命中率导入，约10页。",
    });

    expect(routed).toHaveBeenCalledTimes(1);
    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      taskBrief: { projectId: project.id },
      intentGrant: { standardWorkAuthorized: true },
      plan: { revision: 0 },
    });
  });

  it("atomically replaces a legacy fixed-call grant with the TaskBrief-scoped budget", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: `legacy-budget-${crypto.randomUUID()}` });
    const teacher = await service.addMessage(project.id, { role: "teacher", content: "生成五年级数学百分数公开课 PPT" });
    const taskBrief = createTaskBrief({
      taskId: `task:${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: teacher.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: teacher.id,
    });
    const legacyGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: project.id,
      intentEpoch: 0,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: "v1-standard",
      maxCostCredits: null,
      maxExternalProviderCalls: 3,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    await service.updateMessageMetadata(project.id, teacher.id, { taskBrief, intentGrant: legacyGrant });
    const controlPlaneStore = createControlPlaneStore();
    await controlPlaneStore.upsertTaskAggregate({
      taskBrief,
      intentGrant: legacyGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "active" },
      checkpoint: null,
    });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      controlPlaneStore,
      enableTaskGrantAutonomy: true,
      agent: {
        async intakeTask() {
          throw new Error("queued recovery must reuse the frozen TaskBrief");
        },
        async respond() {
          return {
            assistantMessage: { body: "已读取当前任务。" },
            state: "succeeded" as const,
            quickReplies: [],
            recommendedOptions: [],
            shouldRunToolNow: false,
            runtimeKind: "openai" as const,
          };
        },
      },
    });

    await turnService.executeQueuedTurn(project.id, { teacherMessageId: teacher.id });

    const persistedTeacher = (await service.getMessages(project.id)).find((message) => message.id === teacher.id)!;
    expect(persistedTeacher.metadata.intentGrant).toMatchObject({
      budgetPolicyVersion: "v1-standard-task-scope.v1",
      maxExternalProviderCalls: 2,
    });
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      intentGrant: {
        budgetPolicyVersion: "v1-standard-task-scope.v1",
        maxExternalProviderCalls: 2,
      },
    });
  });

  it("replays a frozen redirect message without advancing IntentEpoch a second time", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Frozen redirect recovery" });
    const teacher = await service.addMessage(project.id, { role: "teacher", content: "改成只做视频脚本" });
    const taskBrief = createTaskBrief({
      taskId: `task:${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: teacher.content,
      requestedOutputs: ["video_script"],
      constraints: [],
      excludedOutputs: ["ppt", "image", "video", "package"],
      generationIntensity: "standard",
      sourceMessageId: teacher.id,
    });
    const intentGrant = createStandardGrantFixture(taskBrief);
    await service.updateMessageMetadata(project.id, teacher.id, { taskBrief, intentGrant });
    const controlPlaneStore = createControlPlaneStore();
    await controlPlaneStore.upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 4, status: "paused_recovery" },
      status: "paused_recovery",
      checkpoint: null,
    });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      controlPlaneStore,
      agent: {
        async intakeTask() { throw new Error("frozen redirect must not be re-intaken"); },
        async respond() {
          return {
            assistantMessage: { body: "已从原改道任务继续。" },
            state: "succeeded" as const,
            quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
            runtimeKind: "openai" as const,
          };
        },
      },
    });

    await turnService.executeQueuedTurn(project.id, { teacherMessageId: teacher.id });

    expect((await service.getProject(project.id)).intentEpoch).toBe(0);
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      taskBrief: { digest: taskBrief.digest },
      plan: { revision: 4 },
    });
  });

  it("resumes a paused TaskAggregate from natural language without creating a new task identity", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Natural recovery", grade: "七年级", subject: "语文", lessonTopic: "春" });
    const original = await service.addMessage(project.id, { role: "teacher", content: "做一份七年级语文《春》的课件" });
    const taskBrief = createTaskBrief({
      taskId: `task:${original.id}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: original.content,
      requestedOutputs: ["ppt"],
      constraints: ["七年级语文", "课题《春》"],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: original.id,
    });
    const intentGrant = createStandardGrantFixture(taskBrief);
    await service.updateMessageMetadata(project.id, original.id, { taskBrief, intentGrant });
    const controlPlaneStore = createControlPlaneStore();
    await controlPlaneStore.upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 1, status: "paused_recovery" },
      status: "paused_recovery",
      checkpoint: null,
    });
    const intakeTask = vi.fn(async () => { throw new Error("resume must reuse the frozen TaskBrief"); });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      controlPlaneStore,
      enableNativeToolControlPlane: true,
      agent: {
        intakeTask,
        async respond() {
          return {
            assistantMessage: { body: "已继续七年级语文《春》课件任务。" },
            state: "succeeded" as const,
            quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
            runtimeKind: "openai" as const,
          };
        },
      },
    });

    const resumed = await turnService.createTurn(project.id, { role: "teacher", content: "继续刚才的七年级语文《春》课件任务" });

    expect(intakeTask).not.toHaveBeenCalled();
    expect(resumed.agentTurn?.assistantMessage.body).toContain("继续七年级语文《春》");
    await expect(controlPlaneStore.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "active",
      taskBrief: { taskId: taskBrief.taskId, digest: taskBrief.digest },
    });
  });

  it("resumes the same frozen task after a Main Agent chosen DialogueCheckpoint receives a natural-language answer", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: "Dialogue recovery", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const controlPlaneStore = createControlPlaneStore();
    const intakeTask = vi.fn(async (input: { userMessage: string }) => pptTaskProposal(input.userMessage));
    let respondCount = 0;
    let frozenTaskId = "";
    let frozenTaskBriefDigest = "";
    let frozenIntentEpoch = -1;

    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      controlPlaneStore,
      executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
      executionFence: fence,
      enableTaskGrantAutonomy: true,
      enableNativeToolControlPlane: true,
      agent: {
        intakeTask,
        async respond(input: MainConversationAgentInput) {
          respondCount += 1;
          if (respondCount === 1) {
            frozenTaskId = input.taskBrief!.taskId;
            frozenTaskBriefDigest = input.taskBrief!.digest;
            frozenIntentEpoch = input.taskBrief!.intentEpoch;
            const loop = input.agentToolLoop!;
            const result = await loop.dispatch({
              callId: "dialogue-call",
              toolName: "request_teacher_decision",
              arguments: {
                question: "这份课件更偏向概念理解还是解题训练？",
                understandingSummary: "当前目标是制作认识百分数的数学课件。",
                impactSummary: "不同侧重会改变例题比例和页面结构。",
                options: [
                  { id: "concept", label: "概念理解", description: "强调意义建构", recommended: true },
                  { id: "practice", label: "解题训练", description: "强调题型练习", recommended: false },
                ],
                allowFreeText: true,
              },
            });
            expect(result).toMatchObject({ status: "blocked", pauseKind: "dialogue_checkpoint" });
            const checkpoint = createMainAgentReActCheckpoint({
              request: { instructions: "test", input: input.userMessage },
              seed: loop.getCheckpointSeed?.(),
              records: [{
                round: 1,
                toolName: "request_teacher_decision",
                callDigest: "d".repeat(64),
                observation: result.observation,
              }],
              currentToolNames: loop.allowedToolNames,
            });
            await loop.onRecoveryCheckpoint?.({
              reason: "dialogue_checkpoint_required",
              toolRoundsUsed: 1,
              observationIds: [result.observation.observationId!],
              checkpoint,
            });
            return {
              assistantMessage: { body: "我需要你判断一个会影响结果的理解边界。" },
              state: "needs_input" as const,
              quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
              runtimeKind: "openai" as const,
            };
          }

          expect(input.taskBrief).toMatchObject({
            taskId: frozenTaskId,
            digest: frozenTaskBriefDigest,
            intentEpoch: frozenIntentEpoch,
          });
          expect(input.agentToolLoop?.resumeCheckpoint).toMatchObject({ schemaVersion: "react-checkpoint.v1" });
          expect(input.conversationContext?.semanticSnapshot?.pendingDecision).toMatchObject({
            schemaVersion: "dialogue-checkpoint.v1",
            status: "answered",
            responseText: "以概念理解为主，保留两页练习。",
          });
          return {
            assistantMessage: { body: "明白，我会以概念理解为主，并保留两页练习。" },
            state: "continuing_workflow" as const,
            quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
            runtimeKind: "openai" as const,
          };
        },
      },
    });

    try {
      const first = await turnService.createTurn(project.id, { role: "teacher", content: "帮我做一个数学的认识百分数的PPT" });
      expect(first.assistantMessage?.parts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "dialogue-checkpoint",
          question: "这份课件更偏向概念理解还是解题训练？",
        }),
      ]));
      expect(first.assistantMessage?.parts?.some((part) => part.type === "error-recovery")).toBe(false);
      await expect(controlPlaneStore.getTaskAggregate(project.id, frozenIntentEpoch)).resolves.toMatchObject({
        status: "paused_recovery",
        taskBrief: { taskId: frozenTaskId, digest: frozenTaskBriefDigest },
      });

      const resumed = await turnService.createTurn(project.id, { role: "teacher", content: "以概念理解为主，保留两页练习。" });
      expect(resumed.agentTurn?.assistantMessage.body).toContain("概念理解");
      expect(intakeTask).toHaveBeenCalledTimes(1);
      await expect(controlPlaneStore.getTaskAggregate(project.id, frozenIntentEpoch)).resolves.toMatchObject({
        status: "active",
        taskBrief: { taskId: frozenTaskId, digest: frozenTaskBriefDigest },
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("fails closed when a queued message carries a TaskBrief from an old IntentEpoch", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stale queued TaskBrief" });
    const teacher = await service.addMessage(project.id, { role: "teacher", content: "做一份PPT" });
    const taskBrief = createTaskBrief({
      taskId: `task:${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: teacher.content,
      requestedOutputs: ["ppt"],
      constraints: [], excludedOutputs: [], generationIntensity: "standard", sourceMessageId: teacher.id,
    });
    await service.updateMessageMetadata(project.id, teacher.id, {
      taskBrief,
      intentGrant: createStandardGrantFixture(taskBrief),
    });
    await service.advanceProjectIntentEpoch(project.id, 0);
    const intakeTask = vi.fn(async () => pptTaskProposal(teacher.content));
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: { intakeTask, async respond() { throw new Error("must not run"); } },
    });

    await expect(turnService.executeQueuedTurn(project.id, { teacherMessageId: teacher.id }))
      .rejects.toThrow(/queued_task_brief_binding_invalid/);
    expect(intakeTask).not.toHaveBeenCalled();
    expect((await service.getProject(project.id)).intentEpoch).toBe(1);
  });

  it("preserves TaskBrief and IntentGrant when the native business Tool appends its Observation", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "V1-9R5 native Tool metadata persistence",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const agent = {
      async intakeTask(input: { userMessage: string }) {
        return pptTaskProposal(input.userMessage);
      },
      async respond(input: MainConversationAgentInput) {
        const result = await input.agentToolLoop!.dispatch({
          callId: "create-ppt-outline",
          toolName: "create_ppt_outline",
          arguments: {},
        });
        expect(result).toMatchObject({ status: "succeeded" });
        return {
          assistantMessage: { body: "已继续处理任务。" },
          state: "chatting" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent,
        agentToolExecutor: async () => { throw new Error("agent Tool executor must not be called"); },
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
      });

      await turnService.createTurn(project.id, {
        role: "teacher",
        content: "请做五年级数学百分数公开课PPT，用投篮命中率导入，约10页。",
      });
      const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;

      expect(teacherMessage.metadata).toMatchObject({
        taskBrief: {
          projectId: project.id,
          requestedOutputs: ["ppt"],
          goal: expect.stringContaining("投篮命中率"),
        },
        intentGrant: {
          projectId: project.id,
          standardWorkAuthorized: true,
          budgetPolicyVersion: "v1-standard-task-scope.v1",
          maxExternalProviderCalls: expect.any(Number),
        },
        agentObservations: [expect.objectContaining({ actionKey: "create_ppt_outline", status: "succeeded" })],
      });
      const persistedIntentGrant = teacherMessage.metadata.intentGrant;
      expect(
        typeof persistedIntentGrant === "object" &&
        persistedIntentGrant !== null &&
        "maxExternalProviderCalls" in persistedIntentGrant &&
        typeof persistedIntentGrant.maxExternalProviderCalls === "number"
          ? persistedIntentGrant.maxExternalProviderCalls
          : 0,
      ).toBeGreaterThan(0);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("preserves a native recovery checkpoint when the outer runtime failure is committed", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "V1-9 native recovery checkpoint authority",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const controlPlaneStore = createControlPlaneStore();
    const agent = {
      async intakeTask(input: { userMessage: string }) {
        return pptTaskProposal(input.userMessage);
      },
      async respond(input: MainConversationAgentInput) {
        const loop = input.agentToolLoop!;
        const checkpoint = createMainAgentReActCheckpoint({
          request: { instructions: "test", input: input.userMessage },
          seed: loop.getCheckpointSeed?.(),
          records: [],
          currentToolNames: loop.allowedToolNames,
        });
        await loop.onRecoveryCheckpoint?.({
          reason: "completion_contract_unsatisfied",
          toolRoundsUsed: 0,
          observationIds: [],
          checkpoint,
          remainingRequestedOutputs: ["ppt"],
        });
        return {
          assistantMessage: { body: "当前任务尚未完整完成。" },
          state: "failed_retryable" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
          failure: {
            phase: "agent_tool_loop" as const,
            reasonCode: "main_agent_execution_failed",
            category: "unexpected" as const,
            retryability: "not_retryable" as const,
            summary: "本轮智能处理没有可靠完成。",
          },
        };
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent,
        agentToolExecutor: async () => { throw new Error("agent Tool executor must not be called"); },
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
        controlPlaneStore,
      });

      await turnService.createTurn(project.id, {
        role: "teacher",
        content: "请做五年级数学百分数公开课PPT，约10页。",
      });
      const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
      const taskBrief = teacherMessage.metadata.taskBrief as { intentEpoch: number };
      const aggregate = await controlPlaneStore.getTaskAggregate(project.id, taskBrief.intentEpoch);

      expect(teacherMessage.metadata.agentRunCheckpoint).toMatchObject({
        status: "paused",
        reason: "completion_contract_unsatisfied",
        observationRefs: [expect.any(String)],
      });
      expect(teacherMessage.metadata.agentObservations).toEqual(expect.arrayContaining([
        expect.objectContaining({ actionKey: "main_agent_completion_contract", reasonCodes: expect.arrayContaining(["completion_contract_unsatisfied"]) }),
        expect.objectContaining({ actionKey: expect.stringMatching(/^main_agent_runtime:/), reasonCodes: ["main_agent_execution_failed"] }),
      ]));
      expect(aggregate).toMatchObject({
        status: "paused_recovery",
        checkpoint: { schemaVersion: "react-checkpoint.v1", checkpointDigest: expect.any(String) },
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("routes a model-selected ppt_design through the persisted Director binding", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: "V1-9R5 persisted Director binding", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await seedTaskAggregate(service, project.id, ["ppt"], { goal: "请继续制作五年级数学百分数公开课PPT。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "百分数课件大纲",
      status: "needs_review",
      summary: "十页投篮命中率叙事大纲。",
      markdownContent: "# 百分数课件大纲",
      structuredContent: {
        artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" },
      },
    });
    await service.approveArtifact(project.id, outline.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    let agentCalls = 0;
    const agent = {
      async intakeTask(input: { userMessage: string }) {
        return pptTaskProposal(input.userMessage);
      },
      async respond(input: MainConversationAgentInput) {
        agentCalls += 1;
        if (agentCalls === 1) {
          await input.agentToolLoop!.dispatch({
            callId: "director-before-design",
            toolName: "ppt_director_plan_or_repair",
            arguments: { goal: "制作十页百分数课件", stage: "page_design", targetPageIds: [], focus: null },
          });
          await input.agentToolLoop!.dispatch({
            callId: "design-after-director",
            toolName: "create_ppt_design_draft",
            arguments: {},
          });
        }
        return {
          assistantMessage: { body: "逐页设计已经保存。" },
          state: "succeeded" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };
    const executor = vi.fn(async (envelope) => {
      const directorOutput: any = validPptDirectorOutput();
      directorOutput.evidence_bindings[0].source_artifact_kind = envelope.approvedArtifactRefs[0].kind;
      directorOutput.evidence_bindings[0].source_type = "teacher_material";
      return {
        status: "succeeded" as const,
        toolId: "ppt_director.plan_or_repair" as const,
        invocationId: envelope.invocationId,
        structuredOutput: directorOutput,
        assistantSummary: "已形成完整逐页设计。",
        artifactCreated: false as const,
      };
    });
    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent,
        agentToolExecutor: executor,
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
      });
      const body = await turnService.createTurn(project.id, {
        role: "teacher",
        content: "继续",
      });

      expect(executor).toHaveBeenCalledTimes(1);
      const design = (await service.getArtifacts(project.id)).find((artifact) => artifact.kind === "ppt_design_draft");
      expect(design).toMatchObject({
        kind: "ppt_design_draft",
        structuredContent: {
          directorInvocationId: expect.any(String),
          artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" },
        },
      });
      expect(body.artifact).toBeUndefined();
      expect((await service.getArtifacts(project.id)).filter((artifact) => artifact.kind === "ppt_draft")).toHaveLength(1);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("starts a complete one-sentence PPT task without a routine confirmation", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-9R2 automatic task", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime(), enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "请做五年级数学百分数公开课 PPT，导入用投篮命中率情境，约 10 页。" });
    const messages = await service.getMessages(project.id);
    const teacherMessage = messages.find((message) => message.role === "teacher")!;

    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(body.artifact).toMatchObject({ nodeKey: "ppt_draft", kind: "ppt_draft", status: "needs_review" });
    expect(teacherMessage.metadata).toMatchObject({
      taskBrief: { goal: expect.stringContaining("投篮命中率"), intentEpoch: 0 },
      intentGrant: { standardWorkAuthorized: true, intensity: "standard" },
    });
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("starts a complete material-package task without an initial routine confirmation", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-9R5 complete package", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime(), enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "请做五年级数学百分数公开课完整材料包，包括教案、约 10 页 PPT、课堂视觉图、A 侧投篮命中率独立创意导入视频和最终整包。课程锚点只做与课程任务之间的最小回接。",
    });

    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(body.artifact).toMatchObject({ nodeKey: "requirement_spec", kind: "requirement_spec", status: "needs_review" });
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
    const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
    expect(teacherMessage.metadata.taskBrief).toMatchObject({
      requestedOutputs: ["image", "lesson_plan", "package", "ppt", "video"],
    });
  });

  it("does not let a model-level confirmation preference override an authorized internal task", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "V1-9R2 server-authoritative action policy",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    let agentCalls = 0;
    const agentInputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        agentCalls += 1;
        agentInputs.push(input);
        if (agentCalls === 1) {
          const turn = buildAgentToolTurn("requirement_spec", "requirement_spec");
          return {
            ...turn,
            state: "awaiting_confirmation" as const,
            shouldRunToolNow: false,
            toolPlan: { ...turn.toolPlan, requiresConfirmation: true },
            runtimeKind: "openai" as const,
          };
        }
        if (agentCalls === 2) {
          const turn = buildAgentToolTurn("lesson_plan", "lesson_plan");
          return {
            ...turn,
            state: "awaiting_confirmation" as const,
            shouldRunToolNow: false,
            toolPlan: { ...turn.toolPlan, requiresConfirmation: true },
            runtimeKind: "openai" as const,
          };
        }
        return {
          assistantMessage: { body: "已完成当前任务。" },
          state: "succeeded" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };
    const turnService = createConversationTurnService({
      service,
      runtime: new OfflineModelContractFixtureRuntime(),
      agent,
      enableTaskGrantAutonomy: true,
    });

    const body = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "请做五年级数学百分数公开课需求规格和教案，导入使用投篮命中率情境。",
    });

    expect(agentCalls).toBe(3);
    const artifacts = await service.getArtifacts(project.id);
    expect(artifacts).toContainEqual(expect.objectContaining({
      kind: "requirement_spec",
      status: "needs_review",
      isApproved: false,
      structuredContent: expect.objectContaining({
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      }),
    }));
    expect(artifacts).toContainEqual(expect.objectContaining({ kind: "lesson_plan", status: "needs_review" }));
    expect(body.artifact).toMatchObject({ kind: "lesson_plan" });
    expect(agentInputs[1].conversationContext?.capabilityAvailability)
      .toContainEqual(expect.objectContaining({ capabilityId: "lesson_plan", status: "available" }));
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("asks the Main Agent to replan when it declares success before the TaskBrief is complete", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "V1-9R3 completion contract",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "已确认需求",
      status: "needs_review",
      summary: "百分数公开课",
      markdownContent: "# 已确认需求",
    });
    await service.approveArtifact(project.id, requirement.id);
    const agentInputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        agentInputs.push(input);
        if (agentInputs.length === 1) {
          const turn = buildAgentToolTurn("ppt_outline", "ppt_draft");
          return { ...turn, toolPlan: { ...turn.toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const };
        }
        if (agentInputs.length === 3) {
          const turn = buildAgentToolTurn("ppt_design", "ppt_design_draft");
          return { ...turn, toolPlan: { ...turn.toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const };
        }
        return {
          assistantMessage: { body: "当前步骤已经完成。" },
          state: "chatting" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };
    const turnService = createConversationTurnService({
      service,
      runtime: new PptQualityTestRuntime(),
      agent,
      enableTaskGrantAutonomy: true,
    });

    const body = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "请做五年级数学百分数公开课 PPT。",
    });

    expect(body.result).toMatchObject({ status: "succeeded" });
    const persistedTaskBrief = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!.metadata.taskBrief as { taskId: string; digest: string };
    expect((await service.getArtifacts(project.id)).find((artifact) => artifact.kind === "ppt_draft")).toMatchObject({
      taskId: persistedTaskBrief.taskId, taskBriefDigest: persistedTaskBrief.digest, intentEpoch: 0,
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    expect(agentInputs).toHaveLength(5);
    expect(agentInputs[2].replanDirective).toMatchObject({
      reason: "completion_contract_unsatisfied",
      remainingRequestedOutputs: ["ppt"],
    });
    expect(agentInputs[4].replanDirective).toMatchObject({
      reason: "completion_contract_unsatisfied",
      remainingRequestedOutputs: ["ppt"],
    });
    expect((await service.getArtifacts(project.id)).map((artifact) => artifact.kind)).toEqual(expect.arrayContaining([
      "requirement_spec",
      "ppt_draft",
      "ppt_design_draft",
    ]));
    expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false });
    expect(body.artifact).toMatchObject({ kind: "ppt_design_draft" });
  });

  it("executes consecutive authorized internal replans until the Main Agent finishes", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-9R3 autonomous replan", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "已确认需求", status: "needs_review",
      summary: "百分数公开课", markdownContent: "# 已确认需求",
    });
    await service.approveArtifact(project.id, requirement.id);
    const runtime = new PptQualityTestRuntime();
    const inputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        inputs.push(input);
        if (inputs.length === 1) {
          return { ...buildAgentToolTurn("ppt_outline", "ppt_draft"), toolPlan: { ...buildAgentToolTurn("ppt_outline", "ppt_draft").toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const };
        }
        if (inputs.length === 2) {
          return { ...buildAgentToolTurn("ppt_design", "ppt_design_draft"), toolPlan: { ...buildAgentToolTurn("ppt_design", "ppt_design_draft").toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const };
        }
        return {
          assistantMessage: { body: "本轮内部工作已经完成。" },
          state: "succeeded" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };
    const turnService = createConversationTurnService({ service, runtime, agent, enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "请做五年级数学百分数公开课 PPT，导入用投篮命中率情境。" });

    expect(body.result).toMatchObject({ status: "succeeded" });
    expect(inputs).toHaveLength(4);
    expect(inputs[1]).toMatchObject({ intentGrant: { projectId: project.id, standardWorkAuthorized: true }, replanDirective: { reason: "tool_succeeded" } });
    expect(inputs[2]).toMatchObject({ intentGrant: { projectId: project.id, standardWorkAuthorized: true }, replanDirective: { reason: "tool_succeeded" } });
    expect(inputs[3].replanDirective).toMatchObject({
      reason: "completion_contract_unsatisfied",
      remainingRequestedOutputs: ["ppt"],
    });
    expect(inputs[2].conversationContext?.agentWorldState?.agentObservations).toHaveLength(2);
    expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false });
    expect((await service.getArtifacts(project.id)).map((artifact) => artifact.kind)).toEqual(expect.arrayContaining(["ppt_draft", "ppt_design_draft"]));
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
    expect(body.assistantMessage?.metadata.completionContract).toMatchObject({
      status: "blocked",
      remainingRequestedOutputs: ["ppt"],
    });
  });

  it("keeps the bounded autonomous Tool budget above the complete material-package chain", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-9R3 bounded replan", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "已确认需求", status: "needs_review",
      summary: "百分数公开课", markdownContent: "# 已确认需求",
    });
    await service.approveArtifact(project.id, requirement.id);
    const runtime = new OfflineModelContractFixtureRuntime();
    const inputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        inputs.push(input);
        const turn = buildAgentToolTurn("lesson_plan", "lesson_plan", { iteration: inputs.length });
        return {
          ...turn,
          toolPlan: { ...turn.toolPlan, requiresConfirmation: false },
          runtimeKind: "openai" as const,
        };
      },
    };
    const turnService = createConversationTurnService({ service, runtime, agent, enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "请做五年级数学百分数公开课教案。" });

    expect(inputs.length).toBeGreaterThan(fullDeliveryCapabilityIds.length);
    expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false });
    expect(body.assistantMessage?.content).toContain("达到安全步数上限");
    expect(body.assistantMessage?.metadata.agentRunCheckpoint).toMatchObject({
      status: "paused",
      reason: "budget_exhausted",
    });
    const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
    expect(teacherMessage.metadata.agentObservations).toHaveLength(inputs.length - 1);
  });

  it("lets the OpenAI Main Agent observe a successful business Tool result and choose the next action", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-3 success replan", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await seedTaskAggregate(service, project.id, ["lesson_plan"], { goal: "继续完善这套公开课" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "已确认需求",
      markdownContent: "# 需求规格",
    });
    await service.approveArtifact(project.id, requirement.id);
    const runtime = new OfflineModelContractFixtureRuntime();
    const run = vi.spyOn(runtime, "run");
    const inputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        inputs.push(input);
        return inputs.length === 1
          ? { ...buildAgentToolTurn("lesson_plan", "lesson_plan"), toolPlan: { ...buildAgentToolTurn("lesson_plan", "lesson_plan").toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const }
          : {
              assistantMessage: { body: "已读取教案结果，本轮工作完成。" },
              state: "succeeded" as const,
              quickReplies: [],
              recommendedOptions: [],
              shouldRunToolNow: false,
              runtimeKind: "openai" as const,
            };
      },
    };
    const turnService = createConversationTurnService({ service, runtime, agent, enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "继续当前任务" });
    const messages = await service.getMessages(project.id);

    expect(body.result).toMatchObject({ status: "succeeded" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(inputs).toHaveLength(2);
    expect(inputs[1].replanDirective).toMatchObject({ reason: "tool_succeeded", previousActionKey: "lesson_plan:lesson_plan" });
    expect(inputs[1].conversationContext?.agentWorldState).toMatchObject({
      trustedInputs: expect.arrayContaining([expect.objectContaining({ kind: "lesson_plan", downstreamEligible: true })]),
      agentObservations: [expect.objectContaining({ actionKey: "lesson_plan:lesson_plan", status: "succeeded" })],
    });
    expect((await service.getArtifacts(project.id)).find((artifact) => artifact.kind === "lesson_plan")?.origin)
      .toBe("tool_result");
    expect(body.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: false,
    });
    expect(body.assistantMessage?.metadata).toMatchObject({
      orchestrationMode: "main_agent_observe_replan",
    });
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
    expect(messages.filter((message) => message.metadata.orchestrationMode === "main_agent_observe_replan")).toHaveLength(2);
  });

  it("lets the OpenAI Main Agent change course after a failed business Tool result", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-3 failure replan", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "failed",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "failed" },
          failure: { category: "timeout", retryable: true },
          assistantMessage: { title: "暂未完成", body: "这一步暂时没有完成，可以调整后继续。" },
          nextSuggestedAction: { type: "retry", label: "稍后重试" },
        };
      },
    };
    const inputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        inputs.push(input);
        if (inputs.length === 1) return { ...buildAgentToolTurn("requirement_spec", "requirement_spec"), toolPlan: { ...buildAgentToolTurn("requirement_spec", "requirement_spec").toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const };
        return {
          assistantMessage: { body: "这一步没有完成。我先暂停执行，请补充你最看重的课堂目标。" },
          state: "needs_input" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };
    const turnService = createConversationTurnService({ service, runtime, agent, enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "请先整理五年级数学百分数公开课备课需求" });

    expect(inputs).toHaveLength(2);
    expect(inputs[1].replanDirective).toMatchObject({ reason: "tool_failed", previousActionKey: "requirement_spec:requirement_spec" });
    expect(inputs[1].conversationContext?.agentWorldState?.agentObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionKey: "requirement_spec:requirement_spec", status: "failed", reasonCodes: expect.arrayContaining(["timeout"]) }),
    ]));
    const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
    expect(teacherMessage.metadata.taskBrief).toMatchObject({ goal: expect.stringContaining("百分数公开课"), digest: expect.any(String) });
    expect(readActiveToolObservationsFromMessages(await service.getMessages(project.id))).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: expect.any(String), inputDigest: expect.any(String), errorCategory: "timeout", artifactCreated: false }),
    ]));
    expect(body.agentTurn).toMatchObject({ state: "needs_input", shouldRunToolNow: false });
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("retries a timeout twice under the original TaskBrief and then stops without a deterministic artifact", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-9R4 bounded timeout recovery", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    let runtimeCalls = 0;
    const runtime: AgentRuntime = {
      async run(input) {
        runtimeCalls += 1;
        return {
          status: "failed",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "failed" },
          failure: { category: "timeout", retryable: true },
          assistantMessage: { title: "本次生成没有完成", body: "当前输入已保留，可以稍后重试。" },
          nextSuggestedAction: { type: "retry", label: "重试本次生成" },
        };
      },
    };
    const agentInputs: MainConversationAgentInput[] = [];
    const agent = {
      async respond(input: MainConversationAgentInput) {
        agentInputs.push(input);
        if (agentInputs.length <= 2) {
          const turn = buildAgentToolTurn("requirement_spec", "requirement_spec");
          return { ...turn, toolPlan: { ...turn.toolPlan, requiresConfirmation: false }, runtimeKind: "openai" as const };
        }
        return {
          assistantMessage: { body: "连续两次没有完成，已暂停自动重试。原任务和输入都已保留。" },
          state: "failed_retryable" as const,
          quickReplies: [{ label: "稍后重试", prompt: "继续原任务", recommended: true }],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };
    const turnService = createConversationTurnService({ service, runtime, agent, enableTaskGrantAutonomy: true });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "请整理五年级数学百分数公开课需求，导入用投篮命中率情境。" });
    const messages = await service.getMessages(project.id);
    const teacherMessage = messages.find((message) => message.role === "teacher")!;
    const observations = readActiveToolObservationsFromMessages(messages);

    expect(runtimeCalls).toBe(2);
    expect(agentInputs).toHaveLength(3);
    expect(teacherMessage.metadata.taskBrief).toMatchObject({ goal: expect.stringContaining("投篮命中率"), digest: expect.any(String) });
    expect(observations).toHaveLength(2);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: expect.any(String), inputDigest: expect.any(String), errorCategory: "timeout" }),
    ]));
    expect(new Set(observations.map((observation) => observation.runId)).size).toBe(2);
    expect(await service.getArtifacts(project.id)).toEqual([]);
    expect(body.agentTurn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false });
    expect(body.agentTurn?.artifactRefs ?? []).toEqual([]);
  });

  it("passes AgentWorldState and capability availability into the main agent context", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M62 世界状态项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const draft = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "待确认需求规格",
      markdownContent: "# 需求规格",
    });
    await service.approveArtifact(project.id, draft.id);

    let capturedInput: MainConversationAgentInput | undefined;
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond(input) {
          capturedInput = input;
          return {
            assistantMessage: { body: "收到，我会结合当前项目状态判断。" },
            state: "chatting",
            quickReplies: [],
            recommendedOptions: [],
            shouldRunToolNow: false,
            runtimeKind: "deterministic",
          };
        },
      },
    });

    await turnService.createTurn(project.id, { role: "teacher", content: "继续下一步" });

    expect(capturedInput?.conversationContext?.agentWorldState).toMatchObject({
      currentNodeKey: "requirement_spec",
      trustedInputs: [expect.objectContaining({ kind: "requirement_spec", isApproved: true })],
    });
    expect(capturedInput?.conversationContext?.capabilityAvailability).toContainEqual(
      expect.objectContaining({ capabilityId: "lesson_plan", status: "available" }),
    );
    expect(capturedInput?.conversationContext?.capabilityAvailability).toContainEqual(
      expect.objectContaining({ capabilityId: "asset_image_generate", status: expect.not.stringMatching(/^available$/) }),
    );
  });

  it("does not replace a model-selected unavailable capability with a server-chosen prerequisite", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M62 可用性门禁项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "待审 PPT 设计稿",
      status: "needs_review",
      summary: "尚未确认",
      markdownContent: "# 待审设计稿",
    });

    let capturedInput: MainConversationAgentInput | undefined;
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      enableTaskGrantAutonomy: true,
      agent: {
        async respond(input) {
          capturedInput = input;
          return {
            assistantMessage: { body: "我现在执行 PPTX 生成。" },
            state: "running_tool",
            quickReplies: [],
            recommendedOptions: [],
            toolPlan: {
              planId: "coze_ppt:test",
              capabilityId: "coze_ppt",
              reasonForUser: "我可以先为你生成 PPTX 文件。",
              internalReason: "test",
              inputDraft: {},
              missingInputs: [],
              upstreamPlan: [],
              nextSuggestedCapabilities: [],
              requiresConfirmation: false,
              expectedArtifactKind: "pptx_artifact",
            },
            shouldRunToolNow: true,
            runtimeKind: "deterministic",
          };
        },
      },
    });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "直接生成 PPTX" });

    expect(capturedInput?.conversationContext?.capabilityAvailability)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "coze_ppt", status: "needs_approved_inputs", missingApprovedInputs: ["ppt_design"] }),
        expect.objectContaining({ capabilityId: "ppt_design", status: "needs_approved_inputs", missingApprovedInputs: ["ppt_outline"] }),
        expect.objectContaining({ capabilityId: "ppt_outline", status: "available", missingApprovedInputs: [] }),
        expect.objectContaining({ capabilityId: "requirement_spec", status: "blocked", missingApprovedInputs: [] }),
      ]));
    expect(body.agentTurn?.toolPlan?.capabilityId).toBe("coze_ppt");
    expect(body.agentTurn).toMatchObject({ state: "collecting_inputs", shouldRunToolNow: false });
    expect(body.artifact).toBeUndefined();
    expect(await service.getGenerationJobs(project.id)).toEqual([]);
  });

  it("writes tool observations for blocked execution and passes them into the next agent world state", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M63 observation 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "待审 PPT 设计稿",
      status: "needs_review",
      summary: "尚未确认",
      markdownContent: "# 待审设计稿",
    });

    let calls = 0;
    let capturedSecondInput: MainConversationAgentInput | undefined;
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond(input) {
          calls += 1;
          if (calls === 1) {
            return {
              assistantMessage: { body: "我现在执行 PPTX 生成。" },
              state: "running_tool",
              quickReplies: [],
              recommendedOptions: [],
              toolPlan: {
                planId: "coze_ppt:test",
                capabilityId: "coze_ppt",
                reasonForUser: "我可以先为你生成 PPTX 文件。",
                internalReason: "test",
                inputDraft: {},
                missingInputs: [],
                upstreamPlan: [],
                nextSuggestedCapabilities: [],
                requiresConfirmation: false,
                expectedArtifactKind: "pptx_artifact",
              },
              shouldRunToolNow: true,
              runtimeKind: "deterministic",
            };
          }
          capturedSecondInput = input;
          return {
            assistantMessage: { body: "我会先参考上一次失败原因再判断。" },
            state: "chatting",
            quickReplies: [],
            recommendedOptions: [],
            shouldRunToolNow: false,
            runtimeKind: "deterministic",
          };
        },
      },
    });

    const blockedBody = await turnService.createTurn(project.id, { role: "teacher", content: "直接生成 PPTX" });

    expect(blockedBody.agentTurn).toMatchObject({ state: "collecting_inputs", shouldRunToolNow: false, artifactRefs: [] });
    expect(blockedBody.artifact).toBeUndefined();
    expect(await service.getGenerationJobs(project.id)).toEqual([]);

    const observations = readActiveToolObservationsFromMessages(await service.getMessages(project.id));
    expect(observations).toEqual([
      expect.objectContaining({
        capabilityId: "coze_ppt",
        expectedArtifactKind: "pptx_artifact",
        kind: "blocked_by_policy",
        status: "active",
        artifactCreated: false,
      }),
    ]);
    expect(JSON.stringify(observations)).not.toMatch(/schema|provider|storage|debug|local path|token|C:\\|API/i);

    await turnService.createTurn(project.id, { role: "teacher", content: "继续下一步" });

    expect(capturedSecondInput?.conversationContext?.agentWorldState?.toolObservations).toEqual([
      expect.objectContaining({ capabilityId: "coze_ppt", kind: "blocked_by_policy", artifactCreated: false }),
    ]);
    expect(capturedSecondInput?.conversationContext?.agentWorldState?.agentObservations).toEqual([
      expect.objectContaining({ source: "tool", status: "needs_input", minimalNextAction: "ask_teacher" }),
    ]);
  });

  it("does not let policy blocks consume the tool retry budget", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M63 budget 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await seedTaskAggregate(service, project.id, ["requirement_spec"], { goal: "继续整理需求" });
    const firstFailure = buildAgentHarnessBudgetEvent({
      capabilityId: "requirement_spec",
      expectedArtifactKind: "requirement_spec",
      status: "failed",
      kind: "tool_failed",
      createdAt: "2026-07-09T00:00:00.000Z",
    });
    const secondFailure = buildAgentHarnessBudgetEvent({
      capabilityId: "requirement_spec",
      expectedArtifactKind: "requirement_spec",
      status: "blocked",
      kind: "blocked_by_policy",
      createdAt: "2026-07-09T00:01:00.000Z",
    });
    const pendingToolPlan = {
      planId: "requirement_spec:test",
      capabilityId: "requirement_spec" as const,
      reasonForUser: "我可以先整理需求。",
      internalReason: "test",
      inputDraft: {},
      missingInputs: [],
      upstreamPlan: [],
      nextSuggestedCapabilities: [],
      requiresConfirmation: true,
      expectedArtifactKind: "requirement_spec" as const,
    };
    const assistantPlanMessage = await service.addMessage(project.id, {
      role: "assistant",
      content: "之前这一步没有完成，请确认后再继续。",
      metadata: {
        agentHarnessBudgetEvents: [firstFailure, secondFailure],
        pendingDeliveryPlan: {
          status: "pending",
          teacherRequest: "继续整理需求",
          toolPlan: pendingToolPlan,
          runtimeKind: "deterministic",
        },
      },
    });
    const actionId = `human:${project.id}:requirement_spec:${assistantPlanMessage.id}`;
    await service.updateMessageMetadata(project.id, assistantPlanMessage.id, {
      ...assistantPlanMessage.metadata,
      pendingDeliveryPlan: {
        ...(assistantPlanMessage.metadata.pendingDeliveryPlan as Record<string, unknown>),
        actionId,
      },
    });

    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond() {
          return {
            assistantMessage: { body: "我现在执行需求整理。" },
            state: "running_tool",
            quickReplies: [],
            recommendedOptions: [],
            toolPlan: {
              planId: "requirement_spec:test",
              capabilityId: "requirement_spec",
              reasonForUser: "我可以先整理需求。",
              internalReason: "test",
              inputDraft: {},
              missingInputs: [],
              upstreamPlan: [],
              nextSuggestedCapabilities: [],
              requiresConfirmation: true,
              expectedArtifactKind: "requirement_spec",
            },
            shouldRunToolNow: true,
            runtimeKind: "deterministic",
          };
        },
      },
    });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "继续整理需求", confirmedActionId: actionId });
    const messages = await service.getMessages(project.id);
    const events = readAgentHarnessBudgetEventsFromMessages(messages);

    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(body.assistantMessage?.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|capabilityId|runtimeKind|token|C:\\/i);
    expect(body.artifact).toMatchObject({ kind: "requirement_spec" });
    expect(await service.getArtifacts(project.id)).toHaveLength(1);
    expect(events.some((event) => event.kind === "retry_exhausted")).toBe(false);
  });

  it("invalidates the old action and intent epoch when the teacher revises an active offer", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2C revision 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const oldActionId = await seedPendingPlan(service, project.id, "ppt_outline", "ppt_draft");
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond() {
          return {
            assistantMessage: { body: "我会按新要求重新规划。" },
            state: "running_tool",
            quickReplies: [],
            recommendedOptions: [],
            toolPlan: {
              planId: "ppt:revised-by-main-agent",
              capabilityId: "ppt_outline" as const,
              reasonForUser: "按修改后的叙事要求重做 PPT 大纲。",
              internalReason: "main_agent_replanned_from_teacher_revision",
              inputDraft: { teacherGoal: "把叙事大纲改成先冲突后揭秘，不要按刚才那版执行" },
              missingInputs: [],
              upstreamPlan: [],
              nextSuggestedCapabilities: [],
              requiresConfirmation: false,
              expectedArtifactKind: "ppt_draft",
            },
            shouldRunToolNow: true,
            runtimeKind: "deterministic",
          };
        },
      },
    });

    const revised = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "把叙事大纲改成先冲突后揭秘，不要按刚才那版执行",
      confirmedActionId: oldActionId,
    });
    const messages = await service.getMessages(project.id);
    const oldPlanMessage = messages.find((message) => pendingDeliveryPlanOf(message).actionId === oldActionId);
    const latestActionId = await getLatestPendingActionId(service, project.id);

    expect((await service.getProject(project.id)).intentEpoch).toBe((project.intentEpoch ?? 0) + 1);
    expect(pendingDeliveryPlanOf(oldPlanMessage).status).toBe("superseded");
    expect(latestActionId).not.toBe(oldActionId);
    expect(revised.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(revised.artifact).toMatchObject({ kind: "ppt_draft", intentEpoch: (project.intentEpoch ?? 0) + 1 });
    expect(readAgentObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "teacher_revision", status: "repair", reasonCodes: ["main_agent_selected_plan_revision"] }),
    ]));

    const staleConfirmation = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "确认开始",
      confirmedActionId: oldActionId,
    });
    expect(staleConfirmation.agentTurn).toMatchObject({ shouldRunToolNow: false });
    expect(staleConfirmation.artifact).toBeUndefined();
  });

  it("pauses an active offer without manufacturing another confirmation on resume", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-4 pause resume", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const oldActionId = await seedPendingPlan(service, project.id, "ppt_outline", "ppt_draft");
    const controlPlaneStore = createControlPlaneStore();
    const initialAggregate = await controlPlaneStore.getTaskAggregate(project.id, project.intentEpoch ?? 0);
    expect(initialAggregate).not.toBeNull();
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
        agent: {
          async respond() {
            return {
              assistantMessage: { body: "已恢复刚才的任务。" },
              state: "chatting" as const,
              quickReplies: [],
              recommendedOptions: [],
              shouldRunToolNow: false,
              runtimeKind: "openai" as const,
            };
          },
        },
    });

    const paused = await turnService.createTurn(project.id, { role: "teacher", content: "先暂停这个任务，稍后再继续" });
    let messages = await service.getMessages(project.id);
    const pausedPlanMessage = messages.find((message) => pendingDeliveryPlanOf(message).actionId === oldActionId);

    expect(paused.agentTurn).toMatchObject({ state: "chatting", shouldRunToolNow: false });
    expect((await service.getProject(project.id)).intentEpoch).toBe(project.intentEpoch ?? 0);
    expect(pendingDeliveryPlanOf(pausedPlanMessage).status).toBe("paused");
    expect(readLatestRunCheckpointFromMessages(messages)).toMatchObject({ reason: "teacher_requested_pause", status: "paused" });
    await expect(controlPlaneStore.getTaskAggregate(project.id, project.intentEpoch ?? 0)).resolves.toMatchObject({
      taskBrief: {
        taskId: initialAggregate!.taskBrief.taskId,
        digest: initialAggregate!.taskBrief.digest,
        intentEpoch: project.intentEpoch ?? 0,
      },
      status: "paused_recovery",
    });

    const resumed = await turnService.createTurn(project.id, { role: "teacher", content: "恢复刚才的任务" });
    messages = await service.getMessages(project.id);
    const newActionId = await getLatestPendingActionId(service, project.id);

    expect(resumed.agentTurn).toMatchObject({ state: "chatting", shouldRunToolNow: false });
    expect(resumed.agentTurn?.state).not.toBe("awaiting_confirmation");
    expect(newActionId).toBeFalsy();
    expect(pendingDeliveryPlanOf(messages.find((message) => pendingDeliveryPlanOf(message).actionId === oldActionId)).status).toBe("superseded");
    expect(readLatestRunCheckpointFromMessages(messages)).toBeNull();
    expect((await service.getProject(project.id)).intentEpoch).toBe(project.intentEpoch ?? 0);
    await expect(controlPlaneStore.getTaskAggregate(project.id, project.intentEpoch ?? 0)).resolves.toMatchObject({
      taskBrief: {
        taskId: initialAggregate!.taskBrief.taskId,
        digest: initialAggregate!.taskBrief.digest,
        intentEpoch: project.intentEpoch ?? 0,
      },
      status: "active",
      checkpoint: null,
    });
  });

  it("cancels an active offer, advances IntentEpoch, and rejects the old action", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-4 cancel", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const oldActionId = await seedPendingPlan(service, project.id, "ppt_outline", "ppt_draft");
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: { async respond() { return { ...buildAgentToolTurn("ppt_outline", "ppt_draft"), state: "chatting", shouldRunToolNow: false }; } },
    });

    const canceled = await turnService.createTurn(project.id, { role: "teacher", content: "取消当前任务" });
    const messages = await service.getMessages(project.id);

    expect(canceled.agentTurn).toMatchObject({ state: "chatting", shouldRunToolNow: false });
    expect((await service.getProject(project.id)).intentEpoch).toBe((project.intentEpoch ?? 0) + 1);
    expect(pendingDeliveryPlanOf(messages.find((message) => pendingDeliveryPlanOf(message).actionId === oldActionId)).status).toBe("canceled");
    expect(readLatestRunCheckpointFromMessages(messages)).toBeNull();

    const stale = await turnService.createTurn(project.id, { role: "teacher", content: "确认开始", confirmedActionId: oldActionId });
    expect(stale.agentTurn).toMatchObject({ shouldRunToolNow: false });
    expect(stale.artifact).toBeUndefined();
  });

  it("asks one concrete question when multiple active offers make continuation ambiguous", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-4 ambiguity", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await seedPendingPlan(service, project.id, "ppt_outline", "ppt_draft");
    await seedPendingPlan(service, project.id, "lesson_plan", "lesson_plan");
    const agent = { respond: vi.fn(async () => ({ ...buildAgentToolTurn("ppt_outline", "ppt_draft"), shouldRunToolNow: false })) };
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime(), agent });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "继续下一步" });

    expect(agent.respond).not.toHaveBeenCalled();
    expect(body.agentTurn).toMatchObject({ state: "collecting_inputs", shouldRunToolNow: false });
    expect(body.assistantMessage?.content).toMatch(/公开课教案.*PPT 大纲|PPT 大纲.*公开课教案/);
    expect(body.assistantMessage?.content.match(/？/g)).toHaveLength(1);
    expect(body.artifact).toBeUndefined();
  });

  it("keeps superseded failures in history but removes them from the current IntentEpoch WorldState", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-4 old failure isolation", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const oldFailure = createAgentObservation({
      projectId: project.id,
      source: "tool",
      status: "failed",
      actionKey: "ppt_outline:ppt_draft",
      inputHash: "old-input",
      reasonCodes: ["old_branch_failure"],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: "ppt_outline",
      minimalNextAction: "repair_upstream",
      teacherSafeSummary: "旧分支失败。",
    });
    await service.addMessage(project.id, { role: "assistant", content: "旧分支失败。", metadata: appendAgentObservationMetadata(undefined, oldFailure) });
    await seedPendingPlan(service, project.id, "ppt_outline", "ppt_draft");
    const inputs: MainConversationAgentInput[] = [];
    let intakeCalls = 0;
    const agent = {
      async intakeTask(input: { userMessage: string; activeTask?: { taskId: string } }) {
        intakeCalls += 1;
        if (intakeCalls === 1 && input.activeTask) {
          return {
            kind: "control" as const,
            control: {
              kind: "redirect" as const,
              reasonCode: "teacher_requested_redirect" as const,
              advanceIntentEpoch: true,
              userMessage: input.userMessage,
            },
            replacementProposal: {
              goal: input.userMessage,
              requestedOutputs: ["ppt"],
              constraints: ["叙事大纲先冲突后揭秘"],
              excludedOutputs: [],
            },
          };
        }
        return { kind: "conversation" as const };
      },
      async respond(input: MainConversationAgentInput) {
        inputs.push(input);
        return { assistantMessage: { body: "收到。" }, state: "chatting" as const, quickReplies: [], recommendedOptions: [], shouldRunToolNow: false, runtimeKind: "openai" as const };
      },
    };
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime(), agent });

    await turnService.createTurn(project.id, { role: "teacher", content: "把大纲改成先冲突后揭秘" });
    await turnService.createTurn(project.id, { role: "teacher", content: "先聊聊新的开场" });

    const historical = readAgentObservationsFromMessages(await service.getMessages(project.id));
    const current = inputs.at(-1)?.conversationContext?.agentWorldState?.agentObservations ?? [];
    expect(historical).toEqual(expect.arrayContaining([expect.objectContaining({ reasonCodes: ["old_branch_failure"] })]));
    expect(current).toEqual(expect.arrayContaining([expect.objectContaining({ source: "teacher_revision" })]));
    expect(current).not.toEqual(expect.arrayContaining([expect.objectContaining({ reasonCodes: ["old_branch_failure"] })]));
  });

  it("uses the existing PPT impact analyzer for an exact page revision and preserves unaffected artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "V1-4 page impact", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const design = await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "PPT逐页设计",
      status: "needs_review",
      summary: "已完成逐页设计",
      markdownContent: "# PPT逐页设计",
      structuredContent: { pptDesignPackage: validPptDesignPackage() },
    });
    await service.approveArtifact(project.id, design.id);
    await seedPendingPlan(service, project.id, "ppt_design", "ppt_design_draft");
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond() {
          return {
            ...buildAgentToolTurn("ppt_design", "ppt_design_draft", {
              teacherGoal: "只修改第6页的文字和排版，其他页保持不变",
              targetPageIds: ["page_06"],
            }),
            state: "chatting" as const,
            shouldRunToolNow: false,
          };
        },
      },
    });

    await turnService.createTurn(project.id, { role: "teacher", content: "只修改第6页的文字和排版，其他页保持不变" });
    const messages = await service.getMessages(project.id);
    const revisionMessage = messages.find((message) => message.role === "teacher" && message.content.includes("第6页"));
    const impact = revisionMessage?.metadata.conversationControlImpact as Record<string, unknown>;

    expect(impact).toMatchObject({ impactScope: "unit", preservedArtifacts: true });
    expect(impact.domainImpact).toMatchObject({
      nextAction: "repair_unit",
      invalidatedPageIds: ["page_06"],
      invalidateReports: true,
      impactDigest: expect.any(String),
    });
    expect(await service.getArtifact(project.id, design.id)).toMatchObject({ status: "approved", isApproved: true });
  });

  it("persists a checkpoint and blocks the third identical failed tool attempt", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2C repeated failure 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const actionId = await seedPendingPlan(service, project.id, "requirement_spec", "requirement_spec");
    const toolRouter = vi.fn(async (input: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => ({
      status: "retryable_failed",
      toolId: "create_requirement_spec",
      capabilityId: "requirement_spec",
      observation: createToolObservation({
        projectId: input.projectId,
        sourceMessageId: input.sourceMessageId,
        capabilityId: "requirement_spec",
        expectedArtifactKind: "requirement_spec",
        kind: "tool_failed",
        teacherSafeSummary: "这一步暂时没有完成。",
        internalReasonSanitized: "temporary_failure",
        retryPolicy: { retryable: true, nextAction: "retry_later" },
      }),
      artifactCreated: false,
      errorCategory: "temporary_failure",
      budgetEvent: buildAgentHarnessBudgetEvent({
        capabilityId: "requirement_spec",
        expectedArtifactKind: "requirement_spec",
        status: "retryable_failed",
        kind: "tool_failed",
      }),
    }));
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      toolRouter,
      agent: { async respond() { return buildAgentToolTurn("requirement_spec", "requirement_spec"); } },
    });

    await turnService.createTurn(project.id, { role: "teacher", content: "继续同一步", confirmedActionId: actionId });
    await turnService.createTurn(project.id, { role: "teacher", content: "继续同一步", confirmedActionId: actionId });
    const third = await turnService.createTurn(project.id, { role: "teacher", content: "继续同一步", confirmedActionId: actionId });
    const messages = await service.getMessages(project.id);

    expect(toolRouter).toHaveBeenCalledTimes(2);
    expect(third.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false });
    expect(third.assistantMessage?.content).toContain("稍后从这里继续");
    expect(readLatestRunCheckpointFromMessages(messages)).toMatchObject({
      projectId: project.id,
      status: "paused",
      reason: "repeated_failure",
    });
  });

  it("runs confirmed requirement_spec through the injected ToolRouter and persists one succeeded budget event", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M64-E router requirement 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const actionId = await seedPendingPlan(service, project.id, "requirement_spec", "requirement_spec");
    let capturedRouterInput: Parameters<typeof routeToolCall>[0] | undefined;
    const toolRouter = vi.fn(async (input: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => {
      capturedRouterInput = input;
      return withPassedValidationReport(input, {
        status: "succeeded",
        toolId: "create_requirement_spec",
        capabilityId: "requirement_spec",
        artifactDraft: {
          nodeKey: "requirement_spec",
          kind: "requirement_spec",
          title: "Router 需求规格",
          summary: "Router 已整理需求规格。",
          markdownContent: "# Router 需求规格",
          structuredContent: { fromRouter: true },
        },
        assistantSummary: "Router 已整理需求规格。",
        budgetEvent: {
          capabilityId: "requirement_spec",
          actionKey: "create_requirement_spec:requirement_spec",
          status: "succeeded",
          kind: "tool_succeeded",
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      }, { stage: "requirement_spec", domain: "lesson", toolId: "create_requirement_spec" });
    });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      toolRouter,
      agent: { async respond() { return buildAgentToolTurn("requirement_spec", "requirement_spec"); } },
    });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "确认开始", confirmedActionId: actionId });
    const messages = await service.getMessages(project.id);
    const events = readAgentHarnessBudgetEventsFromMessages(messages);

    expect(toolRouter).toHaveBeenCalledTimes(1);
    expect(capturedRouterInput).toMatchObject({
      capabilityId: "requirement_spec",
      projectId: project.id,
      userInstruction: "测试请求",
      approvedArtifacts: [],
      artifactRefs: [],
      sourceMessageId: body.message.id,
    });
    expect(body.artifact).toMatchObject({
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      status: "needs_review",
      structuredContent: { fromRouter: true },
    });
    expect(body.assistantMessage?.artifactRefs).toEqual([body.artifact!.id]);
    expect(events.filter((event) => event.status === "succeeded" && event.capabilityId === "requirement_spec")).toEqual([
      expect.objectContaining({
        capabilityId: "requirement_spec",
        actionKey: "requirement_spec:requirement_spec",
        status: "succeeded",
        kind: "tool_succeeded",
      }),
    ]);
  });

  it("routes coze_ppt with approved artifactRefs and records only router observation on quality gate failure", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M64-E router coze 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "已确认 PPT 设计稿",
        status: "needs_review",
        summary: "逐页四层设计稿已确认。",
        markdownContent: "# 已确认 PPT 设计稿",
        structuredContent: { pages: [{ page: 1, title: "导入" }] },
      });
      await service.approveArtifact(project.id, design.id);
      const actionId = await seedPendingPlan(service, project.id, "coze_ppt", "pptx_artifact");
      let capturedRouterInput: Parameters<typeof routeToolCall>[0] | undefined;
      const toolRouter = vi.fn(async (input: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => {
        capturedRouterInput = input;
        return {
          status: "failed",
          toolId: "generate_pptx_from_design",
          capabilityId: "coze_ppt",
          provider: "coze_ppt",
          observation: createToolObservation({
            projectId: input.projectId,
            sourceMessageId: input.sourceMessageId,
            capabilityId: "coze_ppt",
            expectedArtifactKind: "pptx_artifact",
            kind: "quality_gate_failed",
            teacherSafeSummary: "PPTX 没有通过交付校验，请先调整设计稿后再继续。",
            internalReasonSanitized: "quality_gate_failed",
            retryPolicy: { retryable: false, nextAction: "fix_inputs" },
          }),
          artifactCreated: false,
          errorCategory: "quality_gate_failed",
          budgetEvent: {
            capabilityId: "coze_ppt",
            actionKey: "generate_pptx_from_design:pptx_artifact",
            status: "failed",
            kind: "quality_gate_failed",
            createdAt: "2026-07-10T00:00:00.000Z",
          },
        };
      });
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        agent: { async respond() { return buildAgentToolTurn("coze_ppt", "pptx_artifact"); } },
      });

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实 PPTX", confirmedActionId: actionId });
      const artifacts = await service.getArtifacts(project.id);
      const messages = await service.getMessages(project.id);
      const observations = readActiveToolObservationsFromMessages(messages);
      const events = readAgentHarnessBudgetEventsFromMessages(messages);

      expect(toolRouter).toHaveBeenCalledTimes(1);
      expect(capturedRouterInput?.artifactRefs).toEqual([
        expect.objectContaining({
          kind: "ppt_design_draft",
          artifactId: design.id,
          title: "已确认 PPT 设计稿",
          summary: "逐页四层设计稿已确认。",
          markdownContent: "# 已确认 PPT 设计稿",
          structuredContent: expect.objectContaining({ pages: [{ page: 1, title: "导入" }] }),
        }),
      ]);
      expect(capturedRouterInput?.project).toMatchObject({
        id: project.id,
        grade: "五年级",
        subject: "数学",
        lessonTopic: "百分数",
      });
      expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false, artifactRefs: [] });
      expect(body.artifact).toBeUndefined();
      expect(artifacts).toHaveLength(1);
      expect(await service.getGenerationJobs(project.id)).toEqual([
        expect.objectContaining({
          kind: "pptx",
          sourceArtifactId: design.id,
          status: "failed",
          resultArtifactId: null,
          errorMessage: "PPTX 没有通过交付校验，请先调整设计稿后再继续。",
        }),
      ]);
      expect(observations).toEqual([
        expect.objectContaining({ capabilityId: "coze_ppt", kind: "quality_gate_failed", artifactCreated: false }),
      ]);
      expect(events.filter((event) => event.capabilityId === "coze_ppt")).toEqual([
        expect.objectContaining({
          capabilityId: "coze_ppt",
          actionKey: "coze_ppt:pptx_artifact",
          status: "failed",
          kind: "quality_gate_failed",
        }),
      ]);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });

  it("uses the task-scoped standard budget without creating a routine provider confirmation", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M72 provider pending action", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "已确认设计稿",
        status: "needs_review",
        summary: "逐页设计稿",
        markdownContent: "# 设计稿",
      });
      await service.approveArtifact(project.id, design.id);
      const toolRouter = vi.fn(async (routerInput: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => ({
        status: "retryable_failed",
        toolId: "generate_pptx_from_design",
        capabilityId: "coze_ppt",
        observation: createToolObservation({
          projectId: routerInput.projectId,
          sourceMessageId: routerInput.sourceMessageId,
          capabilityId: "coze_ppt",
          expectedArtifactKind: "pptx_artifact",
          kind: "tool_failed",
          teacherSafeSummary: "本次生成暂时没有完成。",
          internalReasonSanitized: "temporary_failure",
          retryPolicy: { retryable: true, nextAction: "retry_later" },
        }),
        artifactCreated: false,
        errorCategory: "temporary_failure",
        budgetEvent: buildAgentHarnessBudgetEvent({
          capabilityId: "coze_ppt",
          expectedArtifactKind: "pptx_artifact",
          status: "retryable_failed",
          kind: "tool_failed",
          providerSubmitted: true,
        }),
      }));
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        agent: { async respond() { return buildAgentToolTurn("coze_ppt", "pptx_artifact"); } },
        enableTaskGrantAutonomy: true,
      });

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实 PPTX" });
      const pending = pendingDeliveryPlanOf(body.assistantMessage);
      const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;

      expect(body.agentTurn?.state).not.toBe("awaiting_confirmation");
      expect(body.assistantMessage?.content).not.toContain("费用规则尚未披露");
      expect(pending.pendingDecision).toBeUndefined();
      expect(toolRouter).toHaveBeenCalledTimes(1);
      expect(teacherMessage.metadata.intentGrant).toMatchObject({
        budgetPolicyVersion: "v1-standard-task-scope.v1",
        maxExternalProviderCalls: 2,
      });
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });

  it("uses the disclosed task budget and asks only for a real budget upgrade", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    const previousImageChannel = process.env.IMAGE_PROVIDER_CHANNEL;
    const previousImageKey = process.env.MINIMAX_API_KEY;
    const previousImageUrl = process.env.MINIMAX_BASE_URL;
    const previousImageModel = process.env.MINIMAX_IMAGE_MODEL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    process.env.IMAGE_PROVIDER_CHANNEL = "minimax";
    process.env.MINIMAX_API_KEY = "test-key";
    process.env.MINIMAX_BASE_URL = "https://example.invalid/image";
    process.env.MINIMAX_IMAGE_MODEL = "image-01";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "V1-9R task budget disclosure", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft", kind: "ppt_design_draft", title: "已确认设计稿", status: "needs_review",
        summary: "逐页设计稿", markdownContent: "# 设计稿",
      });
      await service.approveArtifact(project.id, design.id);
      const agentInputs: MainConversationAgentInput[] = [];
      const agent = {
        async respond(input: MainConversationAgentInput) {
          agentInputs.push(input);
          if (agentInputs.length <= 2) {
            return { ...buildAgentToolTurn("coze_ppt", "pptx_artifact"), runtimeKind: "openai" as const };
          }
          if (agentInputs.length === 3) {
            return { ...buildAgentToolTurn("ppt_sample_assets", "image_prompts"), runtimeKind: "openai" as const };
          }
          return {
            assistantMessage: { body: "已完成当前任务范围内的尝试。" }, state: "succeeded" as const,
            quickReplies: [], recommendedOptions: [], shouldRunToolNow: false, runtimeKind: "openai" as const,
          };
        },
      };
      const toolRouter = vi.fn(async (routerInput: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => {
        const isSampleAssetCall = routerInput.toolName === "generate_ppt_sample_assets";
        const capabilityId = isSampleAssetCall ? "ppt_sample_assets" as const : "coze_ppt" as const;
        const expectedArtifactKind = isSampleAssetCall ? "image_prompts" : "pptx_artifact";
        return {
        status: "retryable_failed",
        toolId: isSampleAssetCall ? "generate_ppt_sample_assets" : "generate_pptx_from_design",
        capabilityId,
        observation: createToolObservation({
          projectId: routerInput.projectId, sourceMessageId: routerInput.sourceMessageId,
          capabilityId, expectedArtifactKind, kind: "tool_failed",
          teacherSafeSummary: "本次生成暂时没有完成。", internalReasonSanitized: "temporary_failure",
          retryPolicy: { retryable: true, nextAction: "retry_later" },
        }),
        artifactCreated: false,
        errorCategory: "temporary_failure",
        budgetEvent: buildAgentHarnessBudgetEvent({
          capabilityId, expectedArtifactKind,
          status: "retryable_failed", kind: "tool_failed", providerSubmitted: true,
        }),
        };
      });
      const turnService = createConversationTurnService({
        service, runtime: new DeterministicRuntime(), toolRouter, agent, enableTaskGrantAutonomy: true,
      });

      const upgradeTurn = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实 PPTX" });
      const pending = pendingDeliveryPlanOf(upgradeTurn.assistantMessage);
      expect(pending.pendingDecision).toMatchObject({
        kind: "budget_upgrade", reasonCode: "budget_upgrade", maxCostCredits: null, maxExternalProviderCalls: 4,
      });
      expect(toolRouter).toHaveBeenCalledTimes(2);
      const initialTeacherMessage = (await service.getMessages(project.id))
        .find((message) => message.role === "teacher" && message.content === "生成真实 PPTX");
      expect(initialTeacherMessage?.metadata.intentGrant).toMatchObject({
        budgetPolicyVersion: "v1-standard-task-scope.v1", maxCostCredits: null, maxExternalProviderCalls: 2,
      });

      const confirmedTurn = await turnService.createTurn(project.id, {
        role: "teacher", content: "确认升级当前任务预算", confirmedActionId: pending.actionId,
      });
      const confirmationMessage = (await service.getMessages(project.id))
        .find((message) => message.role === "teacher" && message.content.includes("确认升级"));

      expect(confirmationMessage?.metadata.intentGrant).toMatchObject({
        budgetPolicyVersion: "v1-standard-task-scope.v1", maxCostCredits: null, maxExternalProviderCalls: 4,
      });
      expect(pendingDeliveryPlanOf(confirmedTurn.assistantMessage).pendingDecision).toBeUndefined();
      expect(confirmedTurn.assistantMessage?.content).toContain("本次生成暂时没有完成");
      expect(toolRouter).toHaveBeenCalledTimes(3);
      expect(confirmedTurn.agentTurn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false });
      expect((await service.getMessages(project.id)).filter((message) => pendingDeliveryPlanOf(message).status === "pending")).toHaveLength(0);

      await service.addMessage(project.id, {
        role: "system",
        content: "任务预算事件",
        metadata: {
          agentHarnessBudgetEvent: buildAgentHarnessBudgetEvent({
            capabilityId: "ppt_sample_assets", expectedArtifactKind: "image_prompts",
            status: "succeeded", kind: "tool_succeeded", providerSubmitted: true,
          }),
        },
      });
      const cappedService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        enableTaskGrantAutonomy: true,
        agent: { async respond() { return { ...buildAgentToolTurn("coze_ppt", "pptx_artifact"), runtimeKind: "openai" as const }; } },
      });
      const cappedTurn = await cappedService.createTurn(project.id, { role: "teacher", content: "继续" });
      const upgradePending = pendingDeliveryPlanOf(cappedTurn.assistantMessage);
      expect(upgradePending.pendingDecision).toMatchObject({
        kind: "budget_upgrade", reasonCode: "budget_upgrade", maxExternalProviderCalls: 6,
      });
      expect(toolRouter).toHaveBeenCalledTimes(3);
      expect(evaluateActionPolicy({
        risk: "external_generation",
        intentGrant: confirmationMessage?.metadata.intentGrant as IntentGrant,
        externalProviderCallsUsed: 3,
      })).toEqual({ kind: "allow", reason: "within_task_grant" });
      await expect(createControlPlaneStore().getTaskAggregate(project.id, project.intentEpoch ?? 0))
        .resolves.toMatchObject({ intentGrant: { maxExternalProviderCalls: 4 } });
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
      restoreEnv("IMAGE_PROVIDER_CHANNEL", previousImageChannel);
      restoreEnv("MINIMAX_API_KEY", previousImageKey);
      restoreEnv("MINIMAX_BASE_URL", previousImageUrl);
      restoreEnv("MINIMAX_IMAGE_MODEL", previousImageModel);
    }
  });

  it("does not create a budget decision when a full-package task replans into a standard external Tool", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "V1-9R replan budget decision", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const requirement = await service.saveArtifact(project.id, {
        nodeKey: "requirement_spec", kind: "requirement_spec", title: "需求规格", status: "needs_review",
        summary: "已确认需求", markdownContent: "# 需求规格",
      });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft", kind: "ppt_design_draft", title: "PPT 设计稿", status: "needs_review",
        summary: "已确认设计", markdownContent: "# PPT 设计稿",
      });
      await service.approveArtifact(project.id, requirement.id);
      await service.approveArtifact(project.id, design.id);
      let calls = 0;
      const agent = {
        async respond() {
          calls += 1;
          const turn = calls === 1
            ? buildAgentToolTurn("lesson_plan", "lesson_plan")
            : buildAgentToolTurn("coze_ppt", "pptx_artifact");
          return { ...turn, toolPlan: { ...turn.toolPlan, requiresConfirmation: calls !== 1 }, runtimeKind: "openai" as const };
        },
      };
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent,
        enableTaskGrantAutonomy: true,
        toolRouter: async (routerInput) => {
          if (routerInput.toolName !== "generate_pptx_from_design") return routeToolCall(routerInput);
          return {
            status: "retryable_failed",
            toolId: "generate_pptx_from_design",
            capabilityId: "coze_ppt",
            observation: createToolObservation({
              projectId: routerInput.projectId,
              sourceMessageId: routerInput.sourceMessageId,
              capabilityId: "coze_ppt",
              expectedArtifactKind: "pptx_artifact",
              kind: "tool_failed",
              teacherSafeSummary: "本次生成暂时没有完成。",
              internalReasonSanitized: "temporary_failure",
              retryPolicy: { retryable: true, nextAction: "retry_later" },
            }),
            artifactCreated: false,
            errorCategory: "temporary_failure",
            budgetEvent: buildAgentHarnessBudgetEvent({
              capabilityId: "coze_ppt",
              expectedArtifactKind: "pptx_artifact",
              status: "retryable_failed",
              kind: "tool_failed",
              providerSubmitted: true,
            }),
          };
        },
      });

      const body = await turnService.createTurn(project.id, {
        role: "teacher",
        content: "请完成五年级数学百分数公开课完整材料包，包括教案、PPT、图片、视频和最终整包。",
      });
      const pending = pendingDeliveryPlanOf(body.assistantMessage);

      expect(calls).toBeGreaterThan(2);
      expect(body.agentTurn?.state).not.toBe("awaiting_confirmation");
      expect(pending.pendingDecision).toBeUndefined();
      const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
      expect(teacherMessage.metadata.intentGrant).toMatchObject({
        budgetPolicyVersion: "v1-standard-task-scope.v1",
        maxExternalProviderCalls: expect.any(Number),
      });
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });

  it("blocks a succeeded coze_ppt result when artifact truth is missing and the quality gate failed", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M64-E router truth gate 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "已确认 PPT 设计稿",
        status: "needs_review",
        summary: "逐页四层设计稿已确认。",
        markdownContent: "# 已确认 PPT 设计稿",
        structuredContent: { pages: [{ page: 1, title: "导入" }] },
      });
      await service.approveArtifact(project.id, design.id);
      const actionId = await seedPendingPlan(service, project.id, "coze_ppt", "pptx_artifact");
      const toolRouter = vi.fn(async (): Promise<ToolExecutionResult> => ({
        status: "succeeded",
        toolId: "generate_pptx_from_design",
        capabilityId: "coze_ppt",
        provider: "coze_ppt",
        artifactDraft: {
          nodeKey: "pptx_artifact",
          kind: "pptx_artifact",
          title: "未通过校验的 PPTX",
          summary: "Router 声称已生成 PPTX。",
          markdownContent: "# 未通过校验的 PPTX",
          structuredContent: { slideCount: 1, fromRouter: true },
        },
        qualityGate: {
          passed: false,
          gates: ["pptx_valid", "slide_count_matches_design"],
        },
        assistantSummary: "Router 声称 PPTX 已生成。",
        budgetEvent: {
          capabilityId: "coze_ppt",
          actionKey: "generate_pptx_from_design:pptx_artifact",
          status: "succeeded",
          kind: "tool_succeeded",
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      }));
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        agent: { async respond() { return buildAgentToolTurn("coze_ppt", "pptx_artifact"); } },
      });

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实 PPTX", confirmedActionId: actionId });
      const artifacts = await service.getArtifacts(project.id);
      const jobs = await service.getGenerationJobs(project.id);
      const messages = await service.getMessages(project.id);
      const observations = readActiveToolObservationsFromMessages(messages);
      const events = readAgentHarnessBudgetEventsFromMessages(messages);

      expect(toolRouter).toHaveBeenCalledTimes(1);
      expect(body.artifact).toBeUndefined();
      expect(artifacts).toEqual([expect.objectContaining({ id: design.id, kind: "ppt_design_draft" })]);
      expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false, artifactRefs: [] });
      expect(jobs).toEqual([
        expect.objectContaining({
          kind: "pptx",
          sourceArtifactId: design.id,
          status: "failed",
          resultArtifactId: null,
          errorMessage: expect.any(String),
        }),
      ]);
      expect(observations).toEqual([
        expect.objectContaining({ capabilityId: "coze_ppt", kind: "quality_gate_failed", artifactCreated: false }),
      ]);
      expect(events.filter((event) => event.capabilityId === "coze_ppt")).toEqual([
        expect.objectContaining({
          capabilityId: "coze_ppt",
          actionKey: "coze_ppt:pptx_artifact",
          status: "failed",
          kind: "quality_gate_failed",
        }),
      ]);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });

  it("routes coze_ppt success through ToolRouter and records succeeded generation job", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M64-E router coze success 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "已确认 PPT 设计稿",
        status: "needs_review",
        summary: "逐页四层设计稿已确认。",
        markdownContent: "# 已确认 PPT 设计稿",
        structuredContent: { pages: [{ page: 1, title: "导入" }] },
      });
      await service.approveArtifact(project.id, design.id);
      const actionId = await seedPendingPlan(service, project.id, "coze_ppt", "pptx_artifact");
      let capturedRouterInput: Parameters<typeof routeToolCall>[0] | undefined;
      const toolRouter = vi.fn(async (input: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => {
        capturedRouterInput = input;
        return withPassedValidationReport(input, {
          status: "succeeded",
          toolId: "generate_pptx_from_design",
          capabilityId: "coze_ppt",
          provider: "coze_ppt",
          artifactTruth: {
            created: true,
            persisted: true,
            placeholder: false,
            producedArtifactKind: "pptx_artifact",
          },
          qualityGate: { passed: true, gates: ["pptx_valid"] },
          artifactDraft: {
            nodeKey: "pptx_artifact",
            kind: "pptx_artifact",
            title: "真实 PPTX 文件",
            summary: "Router 已生成真实 PPTX。",
            markdownContent: "# 真实 PPTX 文件",
            structuredContent: { slideCount: 1, fromRouter: true },
          },
          assistantSummary: "真实 PPTX 已生成并通过基础校验：1 页。",
          budgetEvent: {
            capabilityId: "coze_ppt",
            actionKey: "generate_pptx_from_design:pptx_artifact",
            status: "succeeded",
            kind: "tool_succeeded",
            createdAt: "2026-07-10T00:00:00.000Z",
          },
        }, { stage: "coze_ppt", domain: "ppt", toolId: "generate_pptx_from_design" });
      });
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        agent: { async respond() { return buildAgentToolTurn("coze_ppt", "pptx_artifact"); } },
      });

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实 PPTX", confirmedActionId: actionId });
      const jobs = await service.getGenerationJobs(project.id);

      expect(toolRouter).toHaveBeenCalledTimes(1);
      expect(capturedRouterInput?.project).toMatchObject({
        id: project.id,
        grade: "五年级",
        subject: "数学",
        lessonTopic: "百分数",
      });
      expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false, artifactRefs: [body.artifact!.id] });
      expect(body.artifact).toMatchObject({
        nodeKey: "pptx_artifact",
        kind: "pptx_artifact",
        status: "needs_review",
        structuredContent: { slideCount: 1, fromRouter: true },
      });
      expect(jobs).toEqual([
        expect.objectContaining({
          kind: "pptx",
          sourceArtifactId: design.id,
          status: "succeeded",
          resultArtifactId: body.artifact!.id,
          errorMessage: null,
        }),
      ]);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });

  it("routes confirmed image_asset through ToolRouter and completes its generation job from the router result", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousChannel = process.env.IMAGE_PROVIDER_CHANNEL;
    const previousKey = process.env.MINIMAX_API_KEY;
    const previousBase = process.env.MINIMAX_BASE_URL;
    const previousModel = process.env.MINIMAX_IMAGE_MODEL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.IMAGE_PROVIDER_CHANNEL = "minimax";
    process.env.MINIMAX_API_KEY = "test-key";
    process.env.MINIMAX_BASE_URL = "https://example.invalid/image";
    process.env.MINIMAX_IMAGE_MODEL = "image-01";
    legacyProviderMocks.generateImageFromArtifact.mockClear();
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M64-R router image 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const outline = await service.saveArtifact(project.id, {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "已确认 PPT 大纲",
        status: "needs_review",
        summary: "课堂图片来源大纲已确认。",
        markdownContent: "# PPT 大纲",
      });
      await service.approveArtifact(project.id, outline.id);
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "已确认 PPT 设计稿",
        status: "needs_review",
        summary: "课堂图片设计约束已确认。",
        markdownContent: "# PPT 设计稿",
      });
      await service.approveArtifact(project.id, design.id);
      const actionId = await seedPendingPlan(service, project.id, "image_asset", "image_prompts");
      let capturedRouterInput: Parameters<typeof routeToolCall>[0] | undefined;
      const toolRouter = vi.fn(async (input: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => {
        capturedRouterInput = input;
        return withPassedValidationReport(input, {
          status: "succeeded",
          toolId: "generate_classroom_image",
        capabilityId: "image_asset",
        provider: "image_generation",
        artifactTruth: {
          created: true,
          persisted: true,
          placeholder: false,
          producedArtifactKind: "image_prompts",
        },
        qualityGate: { passed: true, gates: ["image_valid"] },
          artifactDraft: {
            nodeKey: "image_prompts",
            kind: "image_prompts",
            title: "Router 课堂视觉图",
            summary: "Router 已生成课堂视觉图。",
            markdownContent: "# Router 课堂视觉图",
            structuredContent: { fromRouter: "image_asset", fileName: "router-image.png" },
          },
          assistantSummary: "Router 已生成课堂视觉图。",
          budgetEvent: {
            capabilityId: "image_asset",
            actionKey: "generate_classroom_image:image_prompts",
            status: "succeeded",
            kind: "tool_succeeded",
            createdAt: "2026-07-10T00:00:00.000Z",
          },
        }, { stage: "image_asset", domain: "ppt", toolId: "generate_classroom_image" });
      });
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        agent: { async respond() { return buildAgentToolTurn("image_asset", "image_prompts"); } },
      });

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成课堂视觉图", confirmedActionId: actionId });
      const jobs = await service.getGenerationJobs(project.id);

      expect(legacyProviderMocks.generateImageFromArtifact.mock.calls.length).toBe(0);
      expect(toolRouter).toHaveBeenCalledTimes(1);
      expect(capturedRouterInput).toMatchObject({
        capabilityId: "image_asset",
        projectId: project.id,
        sourceMessageId: body.message.id,
        artifactRefs: expect.arrayContaining([
          expect.objectContaining({ artifactId: outline.id, kind: "ppt_draft" }),
          expect.objectContaining({ artifactId: design.id, kind: "ppt_design_draft" }),
        ]),
      });
      expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false, artifactRefs: [body.artifact!.id] });
      expect(body.artifact).toMatchObject({
        nodeKey: "image_prompts",
        kind: "image_prompts",
        status: "needs_review",
        structuredContent: { fromRouter: "image_asset", fileName: "router-image.png" },
      });
      expect(jobs).toEqual([
        expect.objectContaining({
          kind: "image",
          sourceArtifactId: outline.id,
          status: "succeeded",
          resultArtifactId: body.artifact!.id,
          errorMessage: null,
        }),
      ]);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("IMAGE_PROVIDER_CHANNEL", previousChannel);
      restoreEnv("MINIMAX_API_KEY", previousKey);
      restoreEnv("MINIMAX_BASE_URL", previousBase);
      restoreEnv("MINIMAX_IMAGE_MODEL", previousModel);
    }
  });

  it("routes confirmed video_segment_generate through ToolRouter and completes its generation job from the router result", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousMode = process.env.VIDEO_PROVIDER_MODE;
    const previousKey = process.env.EVOLINK_API_KEY;
    const previousBase = process.env.EVOLINK_BASE_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.VIDEO_PROVIDER_MODE = "evolink";
    process.env.EVOLINK_API_KEY = "test-key";
    process.env.EVOLINK_BASE_URL = "https://example.invalid/video";
    legacyProviderMocks.generateVideoFromArtifact.mockClear();
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M64-R router video 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const storyboard = await service.saveArtifact(project.id, {
        nodeKey: "storyboard_generate",
        kind: "storyboard_generate",
        title: "已确认视频分镜",
        status: "needs_review",
        summary: "视频分镜已确认。",
        markdownContent: "# 视频分镜",
      });
      await service.approveArtifact(project.id, storyboard.id);
      const assetImages = await service.saveArtifact(project.id, {
        nodeKey: "asset_image_generate",
        kind: "asset_image_generate",
        title: "已确认视频资产图",
        status: "needs_review",
        summary: "视频资产图已确认。",
        markdownContent: "# 视频资产图",
      });
      await service.approveArtifact(project.id, assetImages.id);
      const segmentPlan = await service.saveArtifact(project.id, {
        nodeKey: "video_segment_plan",
        kind: "video_segment_plan",
        title: "已确认分镜视频计划",
        status: "needs_review",
        summary: "分镜视频计划已确认。",
        markdownContent: "# 分镜视频计划",
      });
      await service.approveArtifact(project.id, segmentPlan.id);
      const actionId = await seedPendingPlan(service, project.id, "video_segment_generate", "video_segment_generate", { shotIds: ["shot_01"] });
      let capturedRouterInput: Parameters<typeof routeToolCall>[0] | undefined;
      const toolRouter = vi.fn(async (input: Parameters<typeof routeToolCall>[0]): Promise<ToolExecutionResult> => {
        capturedRouterInput = input;
        return withPassedValidationReport(input, {
          status: "succeeded",
          toolId: "generate_video_segment",
        capabilityId: "video_segment_generate",
        provider: "video_generation",
        artifactTruth: {
          created: true,
          persisted: true,
          placeholder: false,
          producedArtifactKind: "video_segment_generate",
        },
        qualityGate: { passed: true, gates: ["video_valid"] },
          artifactDraft: {
            nodeKey: "video_segment_generate",
            kind: "video_segment_generate",
            title: "Router 分镜视频片段",
            summary: "Router 已生成分镜视频片段。",
            markdownContent: "# Router 分镜视频片段",
            structuredContent: { fromRouter: "video_segment_generate", fileName: "router-segment.mp4" },
          },
          assistantSummary: "Router 已生成分镜视频片段。",
          budgetEvent: {
            capabilityId: "video_segment_generate",
            actionKey: "generate_video_segment:video_segment_generate",
            status: "succeeded",
            kind: "tool_succeeded",
            createdAt: "2026-07-10T00:00:00.000Z",
          },
        }, { stage: "video_segment_generate", domain: "video", toolId: "generate_video_segment" });
      });
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        toolRouter,
        agent: { async respond() { return buildAgentToolTurn("video_segment_generate", "video_segment_generate", { shotIds: ["shot_01"] }); } },
      });

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成分镜视频片段", confirmedActionId: actionId });
      const jobs = await service.getGenerationJobs(project.id);

      expect(legacyProviderMocks.generateVideoFromArtifact.mock.calls.length).toBe(0);
      expect(toolRouter).toHaveBeenCalledTimes(1);
      expect(capturedRouterInput).toMatchObject({
        capabilityId: "video_segment_generate",
        projectId: project.id,
        sourceMessageId: body.message.id,
        toolInput: { shotIds: ["shot_01"] },
        artifactRefs: expect.arrayContaining([
          expect.objectContaining({ artifactId: storyboard.id, kind: "storyboard_generate" }),
          expect.objectContaining({ artifactId: assetImages.id, kind: "asset_image_generate" }),
          expect.objectContaining({ artifactId: segmentPlan.id, kind: "video_segment_plan" }),
        ]),
      });
      expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false, artifactRefs: [body.artifact!.id] });
      expect(body.artifact).toMatchObject({
        nodeKey: "video_segment_generate",
        kind: "video_segment_generate",
        status: "needs_review",
        structuredContent: { fromRouter: "video_segment_generate", fileName: "router-segment.mp4" },
      });
      expect(jobs).toEqual([
        expect.objectContaining({
          kind: "video",
          sourceArtifactId: segmentPlan.id,
          unitId: "shot_01",
          status: "succeeded",
          resultArtifactId: body.artifact!.id,
          errorMessage: null,
        }),
      ]);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("VIDEO_PROVIDER_MODE", previousMode);
      restoreEnv("EVOLINK_API_KEY", previousKey);
      restoreEnv("EVOLINK_BASE_URL", previousBase);
    }
  });

  it("records internal runtime failures as tool observations and budget events without leaking engineering words", async () => {
    const failingRuntime: AgentRuntime = {
      async run(input) {
        return {
          status: "failed",
          run: {
            runId: input.runId,
            projectId: input.projectId,
            task: input.task,
            runtimeKind: "deterministic",
            status: "failed",
          },
          assistantMessage: {
            title: "生成失败",
            body: "API provider debug token=abc C:\\secret\\draft.md 暂时失败。",
          },
          nextSuggestedAction: { type: "retry", label: "稍后重试" },
        };
      },
    };
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M63 runtime failure 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: failingRuntime });

    await turnService.createTurn(project.id, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const body = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "确认开始",
      confirmedActionId: await getLatestPendingActionId(service, project.id),
    });
    const messages = await service.getMessages(project.id);

    expect(body.agentTurn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false, artifactRefs: [] });
    expect(body.assistantMessage?.content).not.toMatch(/\bAPI\b|provider|debug|token|C:\\/i);
    expect(body.artifact).toBeUndefined();
    expect(await service.getArtifacts(project.id)).toEqual([]);
    expect(readActiveToolObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "ppt_outline", kind: "tool_failed", artifactCreated: false }),
    ]));
    expect(readAgentHarnessBudgetEventsFromMessages(messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "ppt_outline", status: "retryable_failed", kind: "tool_failed" }),
    ]));
    expect(readAgentObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "validation", status: "failed", actionKey: "ppt_outline:ppt_draft" }),
    ]));
  });

  it("accepts explicit natural-language confirmation for the unique safe internal pending action", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M63 plan guard observation 项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const body = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });
    const observations = readActiveToolObservationsFromMessages(await service.getMessages(projectId));

    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(body.artifact).toMatchObject({ kind: "ppt_draft" });
    expect(observations.some((observation) => observation.kind === "blocked_by_policy")).toBe(false);
  });

  it("records quality gate failures as quality_gate_failed observations and budget events", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M63 quality gate 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "不完整 PPT 设计稿",
        status: "needs_review",
        summary: "缺少逐页四层结构",
        markdownContent: "# 不完整设计稿",
      });
      await service.approveArtifact(project.id, design.id);
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent: { async respond() { return buildAgentToolTurn("coze_ppt", "pptx_artifact"); } },
      });
      const actionId = await seedPendingPlan(service, project.id, "coze_ppt", "pptx_artifact");

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实 PPTX", confirmedActionId: actionId });
      const messages = await service.getMessages(project.id);

      expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false, artifactRefs: [] });
      expect(body.artifact).toBeUndefined();
      expect(await service.getArtifacts(project.id)).toHaveLength(1);
      expect(readActiveToolObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "coze_ppt", kind: "quality_gate_failed", artifactCreated: false }),
      ]));
      expect(readAgentHarnessBudgetEventsFromMessages(messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "coze_ppt", actionKey: "coze_ppt:pptx_artifact", status: "failed", kind: "quality_gate_failed" }),
      ]));
      expect(JSON.stringify(readActiveToolObservationsFromMessages(messages))).not.toMatch(/provider|debug|token|API|local path|C:\\/i);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });

  it("records external missing source as a blocked observation and budget event", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousKey = process.env.IMAGEGEN_MYSELF_PRIMARY_API_KEY;
    const previousBase = process.env.IMAGEGEN_MYSELF_PRIMARY_BASE_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.IMAGEGEN_MYSELF_PRIMARY_API_KEY = "test-key";
    process.env.IMAGEGEN_MYSELF_PRIMARY_BASE_URL = "https://example.invalid/image";
    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "M63 external missing 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
      const design = await service.saveArtifact(project.id, {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        title: "已确认 PPT 设计稿",
        status: "needs_review",
        summary: "前置已确认",
        markdownContent: "# 已确认 PPT 设计稿",
      });
      await service.approveArtifact(project.id, design.id);
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent: { async respond() { return buildAgentToolTurn("image_asset", "image_prompts"); } },
      });
      const actionId = await seedPendingPlan(service, project.id, "image_asset", "image_prompts");

      const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成真实课堂视觉图", confirmedActionId: actionId });
      const messages = await service.getMessages(project.id);

      expect(body.agentTurn).toMatchObject({ state: "collecting_inputs", shouldRunToolNow: false, artifactRefs: [] });
      expect(body.artifact).toBeUndefined();
      expect(readActiveToolObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "image_asset", kind: "blocked_by_policy", artifactCreated: false }),
      ]));
      expect(readAgentHarnessBudgetEventsFromMessages(messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "image_asset", status: "blocked", kind: "blocked_by_policy" }),
      ]));
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("IMAGEGEN_MYSELF_PRIMARY_API_KEY", previousKey);
      restoreEnv("IMAGEGEN_MYSELF_PRIMARY_BASE_URL", previousBase);
    }
  });

  it("does not persist a HumanGate pending plan for an unavailable model-selected capability", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M62 模型不可用计划项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "待审 PPT 设计稿",
      status: "needs_review",
      summary: "尚未确认",
      markdownContent: "# 待审设计稿",
    });

    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond() {
          return {
            assistantMessage: { body: "我可以开始生成 PPTX 文件。" },
            state: "awaiting_confirmation",
            quickReplies: [{ label: "确认开始", prompt: "确认开始。", recommended: true }],
            recommendedOptions: [],
            toolPlan: {
              planId: "coze_ppt:test",
              capabilityId: "coze_ppt",
              reasonForUser: "我可以开始生成 PPTX 文件。",
              internalReason: "model_selected_capability",
              inputDraft: {},
              missingInputs: [],
              upstreamPlan: [],
              nextSuggestedCapabilities: [],
              requiresConfirmation: true,
              expectedArtifactKind: "pptx_artifact",
            },
            shouldRunToolNow: false,
            runtimeKind: "openai",
          };
        },
      },
    });

    const body = await turnService.createTurn(project.id, { role: "teacher", content: "生成 PPTX" });
    const messages = await service.getMessages(project.id);

    expect(body.agentTurn).toMatchObject({ state: "collecting_inputs", shouldRunToolNow: false });
    expect(body.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
    expect(messages.at(-1)?.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("returns a main-agent turn for casual chat without creating artifacts", async () => {
    const { turnService, projectId } = await createServiceProject();

    const body = await turnService.createTurn(projectId, { role: "teacher", content: "你好" });

    expect(body).toMatchObject({
      message: { role: "teacher", content: "你好" },
      assistantMessage: { role: "assistant", content: expect.stringContaining("小酷") },
      agentTurn: {
        state: "chatting",
        shouldRunToolNow: false,
      },
    });
    expect(body.agentTurn!.toolPlan).toBeUndefined();
    expect(body.artifact).toBeUndefined();
  });

  it("does not run a tool when the teacher confirms without a pending plan", async () => {
    const { turnService, projectId } = await createServiceProject();

    const body = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });

    expect(body.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(body.agentTurn!.toolPlan).toBeUndefined();
    expect(body.artifact).toBeUndefined();
  });

  it("does not treat casual chat as a pending generation plan", async () => {
    const { turnService, projectId } = await createServiceProject();

    await turnService.createTurn(projectId, { role: "teacher", content: "你好" });
    const body = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });

    expect(body.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(body.artifact).toBeUndefined();
  });

  it("plans a PPT workflow first, then confirmation creates a PPT outline artifact through the turn service", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M54-B3 接线项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });

    expect(planningBody.agentTurn).toMatchObject({
      state: "awaiting_confirmation",
      toolPlan: {
        capabilityId: "ppt_outline",
        requiresConfirmation: true,
      },
      shouldRunToolNow: false,
    });
    expect(planningBody.artifact).toBeUndefined();
    expect(planningBody.assistantMessage!.content).not.toMatch(/schema|provider|node_id|debug|local path/i);

    const confirmBody = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "确认开始",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toMatchObject({
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      status: "needs_review",
      structuredContent: {
        capabilityId: "ppt_outline",
        providerStatus: "deterministic_draft",
      },
    });
    expect(confirmBody.agentTurn!.artifactRefs).toEqual([confirmBody.artifact!.id]);
  });

  it("persists one task contract across a teacher request and its control message", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "V1-9R1 task contract",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "请做五年级数学百分数公开课 PPT，导入用投篮命中率情境，约 10 页。" });
    const firstMessage = (await service.getMessages(projectId)).find((message) => message.role === "teacher")!;
    const firstBrief = firstMessage.metadata.taskBrief as { digest: string; goal: string; intentEpoch: number };
    const firstGrant = firstMessage.metadata.intentGrant as { taskId: string; intensity: string };

    expect(firstBrief).toMatchObject({ goal: expect.stringContaining("投篮命中率"), intentEpoch: 0 });
    expect(firstGrant).toMatchObject({ taskId: expect.any(String), intensity: "standard" });

    await turnService.createTurn(projectId, { role: "teacher", content: "继续" });
    const messages = await service.getMessages(projectId);
    const controlMessage = messages.filter((message) => message.role === "teacher").at(-1)!;

    expect(controlMessage.metadata).toMatchObject({
      taskBrief: { digest: firstBrief.digest, goal: firstBrief.goal, intentEpoch: firstBrief.intentEpoch },
      intentGrant: { taskId: firstGrant.taskId, intensity: "standard" },
    });
  });

  it("keeps an explicitly local video-script task from expanding into PPT, media, or a full package", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "V1-9R5 local scope",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, {
      role: "teacher",
      content: "只做五年级数学百分数公开课的独立创意导入视频脚本，不做 PPT，不生成图片或成片，也不打包。",
    });
    const teacherMessage = (await service.getMessages(projectId)).find((message) => message.role === "teacher")!;

    expect(teacherMessage.metadata.taskBrief).toMatchObject({
      requestedOutputs: ["video_script"],
      excludedOutputs: expect.arrayContaining(["ppt", "image", "video", "package"]),
    });
  });

  it("preserves a Main Agent provider failure instead of forcing a local video-script Tool", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "V1-9R5 local scope provider failure",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      enableTaskGrantAutonomy: true,
      agent: {
        async respond() {
          return {
            assistantMessage: { body: "智能生成服务暂时不可用，暂时不能可靠理解并推进这次需求。" },
            state: "failed_retryable" as const,
            failure: {
              phase: "agent_tool_loop" as const,
              reasonCode: "main_agent_provider_policy_blocked",
              category: "provider_policy" as const,
              retryability: "after_provider_health_change" as const,
              summary: "当前智能服务通道拒绝了这次请求。",
            },
            quickReplies: [],
            recommendedOptions: [],
            shouldRunToolNow: false,
            runtimeKind: "openai" as const,
          };
        },
      },
    });

    const body = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "只做五年级数学百分数公开课的 B 侧机械信标独立创意导入视频脚本，不做 PPT，不生成图片或成片，也不打包。",
    });
    const messages = await service.getMessages(project.id);

    expect(body.agentTurn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false });
    expect(body.agentTurn?.toolPlan).toBeUndefined();
    expect(body.assistantMessage?.content).toContain("智能生成服务暂时不可用");
    expect(await service.getArtifacts(project.id)).toEqual([]);
    expect(readActiveToolObservationsFromMessages(messages)).toEqual([]);
    expect(readAgentObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "tool",
        status: "failed",
        reasonCodes: ["main_agent_provider_policy_blocked"],
        responsibleStage: "main_agent_runtime",
        minimalNextAction: "pause",
      }),
    ]));
    expect(body.assistantMessage?.metadata.recovery).toMatchObject({
      reasonCode: "main_agent_provider_policy_blocked",
      kind: "retry",
    });
    expect(body.assistantMessage?.parts?.filter((part) => part.type === "error-recovery")).toHaveLength(1);
    const taskBrief = messages.find((message) => message.role === "teacher")?.metadata.taskBrief as { taskId: string; digest: string };
    const events = await createControlPlaneStore().listEvents(project.id);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: taskBrief.taskId,
        kind: "run_failed",
        payload: expect.objectContaining({
          reasonCode: "main_agent_provider_policy_blocked",
          taskBriefDigest: taskBrief.digest,
        }),
      }),
    ]));
    expect(readAgentObservationsFromMessages(messages).some((observation) =>
      observation.minimalNextAction === "ask_teacher" || observation.reasonCodes.includes("blocked_by_policy")
    )).toBe(false);
  });

  it("advances IntentEpoch for a natural-language redirect without a pending plan", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "V1-9R1 redirect without pending plan",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const respond = vi.fn(async () => ({
      assistantMessage: { body: "已保存原始 PPT 任务。" },
      state: "chatting" as const,
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
      runtimeKind: "openai" as const,
    }));
    const intakeTask = vi.fn(async (input: { userMessage: string; activeTask?: { taskId: string } }) => {
      if (!input.activeTask) return pptTaskProposal(input.userMessage);
      return {
        kind: "control" as const,
        control: {
          kind: "redirect" as const,
          reasonCode: "teacher_requested_redirect" as const,
          advanceIntentEpoch: true,
          userMessage: input.userMessage,
        },
        replacementProposal: {
          goal: input.userMessage,
          requestedOutputs: ["video_script"],
          constraints: ["机械信标独立创意导入"],
          excludedOutputs: ["ppt", "image", "video", "package"],
        },
      };
    });
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      enableTaskGrantAutonomy: true,
      agent: {
        intakeTask,
        respond,
      },
    });

    await turnService.createTurn(project.id, {
      role: "teacher",
      content: "请做五年级数学百分数公开课 PPT，约 10 页。",
    });
    await turnService.createTurn(project.id, {
      role: "teacher",
      content: "改成只做机械信标独立创意导入视频脚本，不做 PPT、图片、成片或整包。",
    });

    const updatedProject = await service.getProject(project.id);
    const teacherMessages = (await service.getMessages(project.id)).filter((message) => message.role === "teacher");
    expect(updatedProject.intentEpoch).toBe(1);
    expect(teacherMessages[0].metadata.taskBrief).toMatchObject({ intentEpoch: 0, requestedOutputs: ["ppt"] });
    expect(teacherMessages[1].metadata).toMatchObject({
      taskBrief: { intentEpoch: 1, requestedOutputs: ["video_script"], excludedOutputs: expect.arrayContaining(["ppt", "image", "video", "package"]) },
      intentGrant: { intentEpoch: 1 },
      conversationControlImpact: {
        previousIntentEpoch: 0,
        nextIntentEpoch: 1,
        reasonCode: "teacher_redirected_without_pending_plan",
      },
    });
    expect(intakeTask).toHaveBeenCalledTimes(2);
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it("lets the main agent confirm a pending plan from a short start reply", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-C 短确认项目",
      grade: "四年级",
      subject: "语文",
      lessonTopic: "观潮",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "四年级语文《观潮》第一课时，帮我先整理备课需求" });

    expect(planningBody.agentTurn).toMatchObject({
      state: "awaiting_confirmation",
      toolPlan: { capabilityId: "requirement_spec", requiresConfirmation: true },
    });

    const confirmBody = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "开始。",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec", status: "needs_review" });

    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);
    expect(pendingDeliveryPlanOf(assistantPlanMessage).status).toBe("confirmed");
  });

  it.each(["确认需求并生成大纲", "确认需求然后生成大纲"])("handles the wording '%s' as one unique internal confirmation", async (confirmation) => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M72 截图确认需求并生成大纲",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const body = await turnService.createTurn(projectId, { role: "teacher", content: confirmation });

    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(body.artifact).toMatchObject({ nodeKey: "ppt_draft", kind: "ppt_draft" });
    expect((await service.getMessages(projectId)).at(-1)?.content).not.toContain("没有拿到");
  });

  it("persists a HumanGate actionId on pending plans", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 actionId 项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);

    expect(pendingDeliveryPlanOf(assistantPlanMessage).actionId).toBe(
      `human:${projectId}:ppt_outline:${planningBody.assistantMessage?.id}`,
    );
  });

  it("does not execute a pending plan when the persisted HumanGate actionId is missing", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 actionId 缺失项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);
    const { actionId: _actionId, ...pendingWithoutActionId } = pendingDeliveryPlanOf(assistantPlanMessage);
    await service.updateMessageMetadata(projectId, assistantPlanMessage!.id, {
      ...assistantPlanMessage!.metadata,
      pendingDeliveryPlan: pendingWithoutActionId,
    });

    const confirmBody = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toBeUndefined();
  });

  it("executes the unique safe internal pending plan from explicit natural-language confirmation", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 当前确认缺失项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const confirmBody = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });

    expect(confirmBody.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(confirmBody.artifact).toMatchObject({ kind: "ppt_draft" });
  });

  it("executeQueuedTurn reads confirmedActionId from teacher message metadata to confirm a pending plan", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 队列确认项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const actionId = await getLatestPendingActionId(service, projectId);
    const queuedTeacherMessage = await service.addMessage(projectId, {
      role: "teacher",
      content: "确认开始",
      metadata: { confirmedActionId: actionId },
    });

    const confirmBody = await turnService.executeQueuedTurn(projectId, { teacherMessageId: queuedTeacherMessage.id });

    expect(confirmBody.message.id).toBe(queuedTeacherMessage.id);
    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "ppt_draft", status: "needs_review" });

    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);
    expect(pendingDeliveryPlanOf(assistantPlanMessage)).toMatchObject({ status: "confirmed", actionId });
  });

  it("executeQueuedTurn accepts explicit natural confirmation for a safe internal pending plan", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 队列确认缺失项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const queuedTeacherMessage = await service.addMessage(projectId, { role: "teacher", content: "确认开始" });

    const confirmBody = await turnService.executeQueuedTurn(projectId, { teacherMessageId: queuedTeacherMessage.id });

    expect(confirmBody.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(confirmBody.artifact).toMatchObject({ kind: "ppt_draft" });
  });

  it("executeQueuedTurn blocks a pending plan when the teacher message metadata has the wrong confirmedActionId", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 队列确认错误项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const queuedTeacherMessage = await service.addMessage(projectId, {
      role: "teacher",
      content: "确认开始",
      metadata: { confirmedActionId: "human:wrong:requirement_spec:message" },
    });

    const confirmBody = await turnService.executeQueuedTurn(projectId, { teacherMessageId: queuedTeacherMessage.id });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toBeUndefined();
  });

  it("returns a delivery plan for complete material package requests before confirmation", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-A 完整材料包项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const body = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" });

    expect(body.agentTurn).toMatchObject({
      state: "awaiting_confirmation",
      shouldRunToolNow: false,
      deliveryPlan: {
        title: "公开课完整交付计划",
        currentStepId: "requirement_spec",
      },
    });
    expect(body.agentTurn!.deliveryPlan!.steps.map((step: { capabilityId: string }) => step.capabilityId)).toEqual(fullDeliveryCapabilityIds);
    expect(body.artifact).toBeUndefined();
    expect(JSON.stringify(body.agentTurn!.deliveryPlan)).not.toMatch(/schema|provider|node_id|storage|debug|local path/i);
  });

  it("does not have the service choose a fixed next Tool after the first step", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-A 确认项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" });
    const confirmBody = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "确认开始，按这个计划推进。",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: false,
      deliveryPlan: {
        currentStepId: "requirement_spec",
      },
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });
    expect(confirmBody.assistantMessage?.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("persists the pending delivery plan on the assistant planning message", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-A 计划持久化项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" });

    expect(planningBody.assistantMessage!.metadata).toMatchObject({
      pendingDeliveryPlan: {
        status: "pending",
        teacherRequest: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
        toolPlan: {
          capabilityId: "requirement_spec",
          requiresConfirmation: true,
        },
        deliveryPlan: {
          currentStepId: "requirement_spec",
        },
      },
    });

    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);

    expect(assistantPlanMessage!.metadata).toMatchObject({
      pendingDeliveryPlan: {
        status: "pending",
        teacherRequest: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      },
    });
  });

  it("confirms the persisted pending plan even when casual chat is inserted before confirmation", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-A 绑定确认项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningBody = await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" });

    await turnService.createTurn(projectId, { role: "teacher", content: "先等一下，我问个无关问题：今天适合怎样开场？" });
    const confirmBody = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "确认开始",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: false,
      deliveryPlan: {
        currentStepId: "requirement_spec",
      },
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });

    const messagesBody = { messages: await service.getMessages(projectId) };
    const assistantPlanMessage = messagesBody.messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);

    expect(pendingDeliveryPlanOf(assistantPlanMessage).status).toBe("confirmed");

    const latestAssistantMessage = messagesBody.messages.at(-1);
    expect(latestAssistantMessage!.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("does not continue the legacy fixed plan or force the PPT Director boundary", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-B 全链路项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    }, new PptQualityTestRuntime());

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" });

    const body = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "确认开始",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(body.agentTurn).toMatchObject({ state: "succeeded", shouldRunToolNow: false });
    expect(body.artifact).toMatchObject({ nodeKey: "requirement_spec", status: "needs_review" });
    expect(body.agentTurn!.quickReplies).toEqual([]);
    expect(body.assistantMessage!.metadata.pendingDeliveryPlan).toBeUndefined();
    expect((await service.getArtifacts(projectId)).some((artifact) => artifact.kind === "ppt_design_draft")).toBe(false);
  });
});

/**
 * Legacy explicit-confirmation compatibility fixture. These tests preserve the opt-out path
 * and are not evidence that current V1-9R tasks should pause at every internal node.
 */
async function createServiceProject(
  input: Record<string, unknown> = {},
  runtime: AgentRuntime = new DeterministicRuntime(),
) {
  const service = createWorkbenchService();
  const project = await service.createProject({ title: "测试项目", ...input });
  const turnService = createConversationTurnService({ service, runtime });

  return { service, turnService, projectId: project.id };
}

class PptQualityTestRuntime implements AgentRuntime {
  private readonly deterministic = new OfflineModelContractFixtureRuntime();

  async run(input: Parameters<AgentRuntime["run"]>[0]) {
    const result = await this.deterministic.run(input);
    if (input.task !== "ppt_design" || result.status !== "succeeded") return result;

    return {
      ...result,
      run: { ...result.run, runtimeKind: "openai" as const },
      artifactDraft: {
        ...result.artifactDraft,
        generationMode: "model_generated" as const,
        structuredContent: { pptDesignCandidate: validPptDesignSemanticCandidateFixture() },
      },
    };
  }
}

async function getLatestPendingActionId(service: ReturnType<typeof createWorkbenchService>, projectId: string) {
  const messages = await service.getMessages(projectId);
  const pendingMessage = [...messages].reverse().find((message) => pendingDeliveryPlanOf(message).status === "pending");
  return String(pendingDeliveryPlanOf(pendingMessage).actionId ?? "");
}

/** Offline fixture for repository contracts only; it is not real model-orchestration evidence. */
class OfflineModelContractFixtureRuntime implements AgentRuntime {
  private readonly deterministic = new DeterministicRuntime();

  async run(input: Parameters<AgentRuntime["run"]>[0]) {
    const result = await this.deterministic.run(input);
    if (result.status !== "succeeded") return result;
    return {
      ...result,
      run: { ...result.run, runtimeKind: "openai" as const },
      artifactDraft: {
        ...result.artifactDraft,
        generationMode: "model_generated" as const,
      },
    };
  }
}

function validPptDesignSemanticCandidateFixture() {
  return {
    schemaVersion: "ppt-design-semantic-candidate.v1" as const,
    goalSummary: "五年级数学百分数公开课，用投篮命中率建立比较需求。",
    brief: {
      grade: "五年级", subject: "数学", topic: "百分数", audience: "五年级学生",
      useCase: "public_lesson", targetSlideCount: 2,
    },
    evidenceBindings: [{
      evidenceId: "evidence-textbook", pageRefs: ["教材第84-85页"], claims: ["用投篮命中率引出百分数比较"],
    }],
    objectives: [{
      objectiveId: "objective-1", statement: "理解百分数用于表示比较关系", evidenceRefs: ["evidence-textbook"],
    }],
    narrative: {
      openingTension: "两组命中数不同，不能直接判断谁更准。",
      learningProgression: ["观察数据", "统一比较标准"],
      closingResolution: "用百分数说明命中水平。",
    },
    pagePlans: [
      {
        pageNumber: 1, objectiveIds: ["objective-1"], narrativeJob: "提出两组投篮数据能否直接比较的矛盾",
        teachingAction: "引导学生说明仅看命中数为什么不公平", takeawayTitle: "谁的投篮更准",
        primaryVisualBrief: "两组投篮数据形成可观察的球场记分牌",
      },
      {
        pageNumber: 2, objectiveIds: ["objective-1"], narrativeJob: "建立统一标准并形成百分数表达",
        teachingAction: "组织学生把命中次数和投篮总数配对比较", takeawayTitle: "统一标准才能公平比较",
        primaryVisualBrief: "两块记分牌转化为统一百分比刻度",
      },
    ],
    downstreamUse: "production_design_expansion",
  } as const;
}

async function seedTaskAggregate(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
  requestedOutputs: string[],
  options: { goal?: string; planId?: string } = {},
) {
  const project = await service.getProject(projectId);
  const controlPlaneStore = createControlPlaneStore();
  const existing = await controlPlaneStore.getTaskAggregate(projectId, project.intentEpoch ?? 0);
  if (existing) {
    return {
      taskBrief: existing.taskBrief,
      intentGrant: existing.intentGrant,
      teacherMessage: null,
    };
  }
  const teacherMessage = await service.addMessage(projectId, {
    role: "teacher",
    content: options.goal ?? "测试请求",
  });
  const taskBrief = createTaskBrief({
    taskId: `task:${teacherMessage.id}`,
    projectId,
    intentEpoch: project.intentEpoch ?? 0,
    goal: teacherMessage.content,
    requestedOutputs,
    constraints: [],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: teacherMessage.id,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
    maxCostCredits: null,
    maxExternalProviderCalls: 2,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await service.updateMessageMetadata(projectId, teacherMessage.id, { taskBrief, intentGrant });
  await controlPlaneStore.upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: {
      planId: options.planId ?? `plan:${taskBrief.taskId}`,
      revision: 0,
      status: "active",
    },
    checkpoint: null,
  });
  return { taskBrief, intentGrant, teacherMessage };
}

async function seedPendingPlan(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
  capabilityId: CapabilityId,
  expectedArtifactKind: string,
  inputDraft: Record<string, unknown> = {},
) {
  const toolTurn = buildAgentToolTurn(capabilityId, expectedArtifactKind, inputDraft);
  const { taskBrief, intentGrant } = await seedTaskAggregate(service, projectId, [requestedOutputForArtifactKind(expectedArtifactKind)], {
    planId: toolTurn.toolPlan!.planId,
  });
  const assistantMessage = await service.addMessage(projectId, {
    role: "assistant",
    content: "请确认是否执行这一步。",
    metadata: {
      taskBrief,
      intentGrant,
      pendingDeliveryPlan: {
        status: "pending",
        teacherRequest: "测试请求",
        toolPlan: toolTurn.toolPlan,
        runtimeKind: "deterministic",
        taskBrief,
        intentGrant,
      },
    },
  });
  const actionId = `human:${projectId}:${capabilityId}:${assistantMessage.id}`;
  const pendingDeliveryPlan = assistantMessage.metadata.pendingDeliveryPlan;
  await service.updateMessageMetadata(projectId, assistantMessage.id, {
    ...assistantMessage.metadata,
    pendingDeliveryPlan: {
      ...(typeof pendingDeliveryPlan === "object" && pendingDeliveryPlan && !Array.isArray(pendingDeliveryPlan) ? pendingDeliveryPlan : {}),
      actionId,
    },
  });

  return actionId;
}

function pendingDeliveryPlanOf(message?: { metadata: Record<string, unknown> }) {
  return (message?.metadata.pendingDeliveryPlan ?? {}) as {
    status?: string;
    actionId?: string;
    teacherRequest?: string;
    toolPlan?: { capabilityId?: string; planId?: string };
    pendingDecision?: {
      schemaVersion?: string;
      status?: string;
      kind?: string;
      reasonCode?: string;
      projectId?: string;
      taskId?: string;
      intentEpoch?: number;
      planId?: string;
      actionId?: string;
      maxCostCredits?: number | null;
      maxExternalProviderCalls?: number | null;
    };
  };
}

function requestedOutputForArtifactKind(artifactKind: string): TaskRequestedOutput {
  const outputs: Record<string, TaskRequestedOutput> = {
    requirement_spec: "requirement_spec",
    lesson_plan: "lesson_plan",
    ppt_draft: "ppt_outline",
    ppt_design_draft: "ppt_design",
    pptx_artifact: "ppt",
    image_prompts: "image",
    video_segment_generate: "video_shot",
  };
  const output = outputs[artifactKind];
  if (!output) throw new Error(`Test fixture requires an explicit requested output mapping for ${artifactKind}.`);
  return output;
}

function pptTaskProposal(goal: string) {
  return {
    kind: "task" as const,
    proposal: {
      goal,
      requestedOutputs: ["ppt"],
      constraints: ["五年级数学百分数"],
      excludedOutputs: [],
    },
  };
}

function createStandardGrantFixture(taskBrief: ReturnType<typeof createTaskBrief>): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
    maxCostCredits: null,
    maxExternalProviderCalls: 2,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

function buildAgentToolTurn(capabilityId: CapabilityId, expectedArtifactKind: string, inputDraft: Record<string, unknown> = {}) {
  return {
    assistantMessage: { body: "我现在执行这一步。" },
    state: "running_tool" as const,
    quickReplies: [],
    recommendedOptions: [],
    toolPlan: {
      planId: `${capabilityId}:test`,
      capabilityId,
      reasonForUser: "我可以继续处理这一步。",
      internalReason: "test",
      inputDraft,
      missingInputs: [],
      upstreamPlan: [],
      nextSuggestedCapabilities: [],
      requiresConfirmation: true,
      expectedArtifactKind,
    },
    shouldRunToolNow: true,
    runtimeKind: "deterministic" as const,
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

import { describe, expect, it, vi } from "vitest";

import { createMainAgentToolLoopOptions } from "@/server/conversation/main-agent-tool-loop-config";
import type { MainAgentReActDispatchResult } from "@/server/conversation/main-agent-controlled-react-loop";
import { readAgentObservationsFromMessages, readLatestRunCheckpointFromMessages } from "@/server/conversation/react-control";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";
import { createWorkbenchActor } from "@/server/auth/actor";
import {
  createValidationReport,
  hashArtifactDraft,
  validateToolExecutionResult,
  validationDomainForCapability,
} from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import { buildAgentHarnessBudgetEvent, countSubmittedExternalProviderCalls, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";
import { buildCapabilityAvailability } from "@/server/capabilities/capability-availability";
import { getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { validPptDirectorOutput } from "../support/ppt-director-output-fixture";
import { validPptDesignPackage } from "../support/ppt-quality-fixture";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant, type TaskBrief } from "@/server/conversation/task-contract";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import type { BusinessToolSkillRuntime } from "@/server/skills/business-tool-skill-runtime";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import { getToolDefinition } from "@/server/tools/tool-registry";
import { prisma } from "@/server/db/client";

describe("V1-3 Main Agent Agent Tool loop config", () => {
  it("atomically persists production ReAct segment checkpoints with the current semantic snapshot", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: `V1-control-plane-segment-${crypto.randomUUID()}`,
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const message = await service.addMessage(project.id, { role: "teacher", content: "制作一份百分数公开课PPT。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: ["十页"],
      excludedOutputs: ["video"],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("Tool execution is not part of this checkpoint test"); },
        taskBrief,
        intentGrant,
        controlPlaneStore,
      });
      const checkpoint = createMainAgentReActCheckpoint({
        request: { instructions: "test", input: taskBrief.goal },
        seed: config!.getCheckpointSeed?.(),
        records: [],
        currentToolNames: config!.allowedToolNames,
      });

      expect(config?.maxToolRoundsPerSegment).toBe(8);
      await config!.onSegmentCheckpoint?.({
        segmentIndex: 1,
        toolRoundsUsed: 8,
        pendingToolName: "create_ppt_outline",
        observationIds: [],
        checkpoint,
      });

      expect((await controlPlaneStore.getTaskAggregate(project.id, taskBrief.intentEpoch))?.checkpoint)
        .toMatchObject({ schemaVersion: "react-checkpoint.v1", checkpointDigest: checkpoint.checkpointDigest });
      expect((await controlPlaneStore.getLatestSemanticSnapshot({
        projectId: project.id,
        taskId: taskBrief.taskId,
        intentEpoch: taskBrief.intentEpoch,
        maxPlanRevision: 0,
      }))?.snapshot).toMatchObject({
        taskBrief: { digest: taskBrief.digest },
        plan: { revision: 0, status: "active" },
      });
      expect(await controlPlaneStore.listEvents(project.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "task_updated",
          payload: expect.objectContaining({ checkpointDigest: checkpoint.checkpointDigest, segmentIndex: 1 }),
        }),
      ]));

      await config!.onRecoveryCheckpoint?.({
        reason: "repeated_tool_failure",
        toolRoundsUsed: 8,
        observationIds: ["latest-observation"],
        checkpoint,
      });

      expect(readLatestRunCheckpointFromMessages(await service.getMessages(project.id))).toMatchObject({
        checkpointId: checkpoint.checkpointDigest,
        reason: "repeated_failure",
        observationRefs: ["latest-observation"],
      });

    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists an adapter failure checkpoint as a teacher-resumable turn boundary", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-adapter-checkpoint-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续制作七年级语文《春》课件。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: ["七年级", "语文"],
      excludedOutputs: ["video"],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("Tool execution is not part of this checkpoint test"); },
        taskBrief,
        intentGrant,
        controlPlaneStore,
      });
      const checkpoint = createMainAgentReActCheckpoint({
        request: { instructions: "test", input: taskBrief.goal },
        seed: config!.getCheckpointSeed?.(),
        records: [{
          round: 1,
          toolName: "create_ppt_outline",
          callDigest: "a".repeat(64),
          observation: {
            observationId: "observation-ppt-outline",
            status: "succeeded",
            reasonCodes: ["business_tool_succeeded"],
          },
        }],
        currentToolNames: config!.allowedToolNames,
      });

      await config!.onRecoveryCheckpoint?.({
        reason: "adapter_failed",
        toolRoundsUsed: 1,
        observationIds: ["observation-ppt-outline"],
        checkpoint,
      });

      expect(readLatestRunCheckpointFromMessages(await service.getMessages(project.id))).toMatchObject({
        checkpointId: checkpoint.checkpointDigest,
        reason: "adapter_failed",
        observationRefs: ["observation-ppt-outline"],
      });
      expect(await controlPlaneStore.getTaskAggregate(project.id, taskBrief.intentEpoch)).toMatchObject({
        status: "paused_recovery",
        checkpoint: expect.objectContaining({ checkpointDigest: checkpoint.checkpointDigest }),
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists a native HumanGate decision and recovery checkpoint without creating an Artifact", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-human-gate-checkpoint-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "先整理当前需求。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const deniedGrant = { ...standardIntentGrant(taskBrief), standardWorkAuthorized: false };
    const controlPlaneStore = await persistTaskAggregate(taskBrief, deniedGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("Tool execution is not part of this checkpoint test"); },
        taskBrief,
        controlPlaneStore,
      });
      const blocked = await config!.dispatch({
        callId: "call-human-gate",
        toolName: "create_requirement_spec",
        arguments: {},
      });
      expect(blocked).toMatchObject({
        status: "blocked",
        observation: { observationId: expect.any(String), nextAction: "ask_teacher" },
      });
      const checkpoint = createMainAgentReActCheckpoint({
        request: { instructions: "test", input: taskBrief.goal },
        seed: config!.getCheckpointSeed?.(),
        records: [{
          round: 1,
          toolName: "create_requirement_spec",
          callDigest: "a".repeat(64),
          observation: {
            observationId: blocked.observation.observationId,
            status: "blocked",
            reasonCodes: ["missing_grant"],
            nextAction: "ask_teacher",
          },
        }],
        currentToolNames: config!.allowedToolNames,
      });

      await config!.onRecoveryCheckpoint?.({
        reason: "human_gate_required",
        toolRoundsUsed: 1,
        observationIds: [blocked.observation.observationId!],
        checkpoint,
      });

      expect(await controlPlaneStore.getTaskAggregate(project.id, taskBrief.intentEpoch)).toMatchObject({
        status: "paused_recovery",
        checkpoint: expect.objectContaining({ checkpointDigest: checkpoint.checkpointDigest }),
      });
      expect(readLatestRunCheckpointFromMessages(await service.getMessages(project.id))).toMatchObject({
        checkpointId: checkpoint.checkpointDigest,
        reason: "human_gate_required",
        observationRefs: [blocked.observation.observationId],
      });
      expect(await service.getArtifacts(project.id)).toHaveLength(0);
      const persistedTeacherMessage = (await service.getMessages(project.id)).find((entry) => entry.id === message.id);
      expect(persistedTeacherMessage?.metadata.pendingDeliveryPlan).toMatchObject({
        status: "pending",
        actionId: expect.any(String),
        taskBrief: { taskId: taskBrief.taskId, digest: taskBrief.digest },
        pendingDecision: {
          status: "pending",
          kind: "authorization",
          actionId: expect.any(String),
          actorUserId: actor.userId,
          taskId: taskBrief.taskId,
        },
      });
      expect((await controlPlaneStore.getLatestSemanticSnapshot({
        projectId: project.id,
        taskId: taskBrief.taskId,
        intentEpoch: taskBrief.intentEpoch,
        maxPlanRevision: 1,
      }))?.snapshot.pendingDecision).toMatchObject({
        status: "pending",
        kind: "authorization",
        actionId: expect.any(String),
      });
      expect(await controlPlaneStore.listEvents(project.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "task_updated",
          payload: expect.objectContaining({
            status: "paused_recovery",
            reasonCode: "human_gate_required",
          }),
        }),
      ]));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists a signed Agent Tool report and observation under the active project lease", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-loop-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT大纲", status: "needs_review",
      summary: "可信逐页大纲", markdownContent: "# PPT大纲",
      origin: "tool_result",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    expect(lease).not.toBeNull();
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: validPptDirectorOutput(),
      assistantSummary: "已形成样张规划。",
      artifactCreated: false as const,
    }));
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [outline],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
        taskBrief,
        intentGrant,
        controlPlaneStore,
      });
      expect(config?.allowedToolNames).toContain("ppt_director_plan_or_repair");
      await config!.prepareTools?.();
      const result = await config!.dispatch({
        callId: "call-1",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });
      await config!.onContextTelemetry?.({
        phase: "continuation",
        toolRound: 1,
        requestCharacters: 4_000,
        estimatedInputTokens: 2_000,
        checkpointCharacters: 1_200,
        checkpointObservationCount: 1,
        toolCount: 4,
        responseDurationMs: 250,
      });
      await config!.onRejectedToolCall?.({
        toolName: "ppt_director_plan_or_repair",
        toolRound: 2,
        reason: "repeated_tool_call",
      });

      expect(result).toMatchObject({ status: "succeeded", observation: { observationId: expect.any(String) } });
      const messages = await service.getMessages(project.id);
      expect(messages.find((item) => item.id === message.id)?.metadata.mainAgentReActContextTelemetry).toEqual([
        {
          phase: "continuation",
          toolRound: 1,
          requestCharacters: 4_000,
          estimatedInputTokens: 2_000,
          checkpointCharacters: 1_200,
          checkpointObservationCount: 1,
          toolCount: 4,
          responseDurationMs: 250,
        },
      ]);
      expect(messages.find((item) => item.id === message.id)?.metadata.mainAgentToolExposureTrace).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: "tools_exposed",
          allowedToolNames: expect.arrayContaining(["ppt_director_plan_or_repair"]),
        }),
        expect.objectContaining({
          event: "tool_rejected",
          selectedToolName: "ppt_director_plan_or_repair",
          rejectionReason: "repeated_tool_call",
        }),
      ]));
      expect(readAgentToolReportsFromMessages(messages)).toEqual([
        expect.objectContaining({ projectId: project.id, toolId: "ppt_director.plan_or_repair", status: "succeeded" }),
      ]);
      expect(readAgentObservationsFromMessages(messages)).toEqual([
        expect.objectContaining({ projectId: project.id, actionKey: "ppt_director.plan_or_repair", status: "succeeded" }),
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("returns a Director blocked decision to the Main Agent for repair instead of inventing a HumanGate", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R-A21-director-repair-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT大纲",
      status: "needs_review",
      summary: "可信逐页大纲",
      markdownContent: "# PPT大纲",
      origin: "tool_result",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: {
        ...validPptDirectorOutput(),
        decision: "blocked",
        summary: "当前设计语义需要由 Main Agent 修复。",
        nextToolIntents: [],
      },
      assistantSummary: "当前设计语义需要修复。",
      artifactCreated: false as const,
    }));
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [outline],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
        taskBrief,
        intentGrant,
        controlPlaneStore,
      });
      const result = await config!.dispatch({
        callId: "director-blocked",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });

      expect(result).toMatchObject({
        status: "blocked",
        observation: { nextAction: "repair_upstream" },
      });
      expect(readAgentObservationsFromMessages(await service.getMessages(project.id))).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actionKey: "ppt_director.plan_or_repair",
          status: "blocked",
          minimalNextAction: "repair_upstream",
        }),
      ]));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("binds one complete Director result to create_ppt_design_draft in the same ReAct loop", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: `V1-9R5-ppt-director-${crypto.randomUUID()}`,
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const message = await service.addMessage(project.id, { role: "teacher", content: "制作十页百分数公开课课件。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "百分数课件大纲", status: "needs_review",
      summary: "十页投篮命中率叙事大纲。", markdownContent: "# 百分数课件大纲",
      origin: "tool_result",
      structuredContent: {
        artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" },
      },
    });
    const artifacts = [await service.getArtifact(project.id, outline.id)];
    const outlineDigest = hashArtifactDraft({
      nodeKey: artifacts[0].nodeKey,
      kind: artifacts[0].kind,
      title: artifacts[0].title,
      summary: artifacts[0].summary,
      markdownContent: artifacts[0].markdownContent,
      structuredContent: artifacts[0].structuredContent,
    });
    const directorOutput: any = validPptDirectorOutput();
    directorOutput.evidence_bindings[0].source_artifact_kind = outline.kind;
    directorOutput.evidence_bindings[0].source_type = "teacher_material";
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    let runtimeCalls = 0;
    const runtime = {
      async run() {
        runtimeCalls += 1;
        throw new Error("generic ppt_design runtime must not execute");
      },
    };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: directorOutput,
      assistantSummary: "已形成完整逐页设计。",
      artifactCreated: false as const,
    }));
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: ["十页"], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);

    try {
      const config = createMainAgentToolLoopOptions({
        service, runtime, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence, executor,
        taskBrief, intentGrant, controlPlaneStore,
      });

      expect(config?.allowedToolNames).toContain("create_ppt_design_draft");
      await expect(config!.dispatch({
        callId: "director-call", toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "制作十页百分数课件", stage: "page_design", targetPageIds: [], focus: null },
      })).resolves.toMatchObject({ status: "succeeded" });
      await expect(config!.dispatch({
        callId: "persist-design", toolName: "create_ppt_design_draft", arguments: {},
      })).resolves.toMatchObject({
        status: "succeeded",
        observation: { artifactRefs: [expect.objectContaining({ kind: "ppt_design_draft" })] },
      });

      expect(runtimeCalls).toBe(0);
      expect(readAgentToolReportsFromMessages(await service.getMessages(project.id))).toEqual([
        expect.objectContaining({
          toolId: "ppt_director.plan_or_repair",
          approvedArtifactRefs: [expect.objectContaining({ artifactId: outline.id, digest: outlineDigest })],
        }),
      ]);
      const designs = (await service.getArtifacts(project.id)).filter((artifact) => artifact.kind === "ppt_design_draft");
      expect(designs).toHaveLength(1);
      expect(designs[0]).toMatchObject({
        status: "needs_review",
        structuredContent: {
          generationMode: "model_generated", providerStatus: "real", runtimeKind: "openai",
          directorInvocationId: expect.any(String),
          artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" },
        },
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("exposes a high-level business tool only after its trusted inputs exist and blocks execution without a task grant", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-tools-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "生成课件样张。" });
    const design = await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft", kind: "ppt_design_draft", title: "内部审查通过的设计", status: "needs_review",
      summary: "逐页设计", markdownContent: "# 逐页设计",
      origin: "tool_result",
      structuredContent: {
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      },
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: project.generationIntensity ?? "standard",
      sourceMessageId: message.id,
    });
    const deniedGrant = { ...standardIntentGrant(taskBrief), standardWorkAuthorized: false };
    const controlPlaneStore = await persistTaskAggregate(taskBrief, deniedGrant, actor.userId);
    const executor = vi.fn(async () => { throw new Error("agent executor must not be called"); });
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [await service.getArtifact(project.id, design.id)],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor, taskBrief, controlPlaneStore,
      });
      expect(config?.allowedToolNames).toContain("generate_ppt_sample_assets");
      expect(config?.allowedToolNames).not.toContain("raw_provider_submit");

      const result = await config!.dispatch({ callId: "business-without-grant", toolName: "generate_ppt_sample_assets", arguments: {} });
      expect(result).toMatchObject({ status: "blocked", observation: { reasonCodes: ["missing_grant"], nextAction: "ask_teacher" } });
      expect(executor).not.toHaveBeenCalled();
      const events = await controlPlaneStore.listEvents(project.id);
      const blockedEvent = events.find((event) => event.kind === "tool_observed");
      expect(blockedEvent).toMatchObject({
        projectId: project.id,
        taskId: taskBrief.taskId,
        payload: { status: "blocked" },
      });
      const observationId = String(blockedEvent?.payload.observationId ?? "");
      expect(result.observation.observationId).toBe(observationId);
      const observation = await controlPlaneStore.getObservation(observationId);
      expect(observation).toMatchObject({ status: "blocked", reasonCodes: ["missing_grant"] });
      if (!observation?.invocationId) throw new Error("Blocked policy observation must bind its ToolInvocation.");
      await expect(controlPlaneStore.getToolInvocation(observation.invocationId)).resolves.toMatchObject({
        projectId: project.id,
        taskId: taskBrief.taskId,
        status: "blocked",
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it.each([
    ["局部教案", "只做五年级数学百分数教案。", ["lesson_plan"], [], ["create_lesson_plan"], []],
    ["局部 PPT 大纲", "只做五年级数学百分数 PPT 结构候选。", ["ppt_outline"], [], ["create_ppt_outline"], []],
    ["局部 PPT 大纲且排除最终 PPTX", "只做PPT结构候选，不生成PPTX。", ["ppt_outline"], ["ppt"], ["create_ppt_outline"], ["assemble_ppt_full_deck"]],
    ["纯图片", "只生成一张课堂图片，不制作 PPT。", ["image"], ["ppt"], [], ["create_ppt_outline"]],
    ["局部视频脚本", "只做五年级数学百分数独立创意导入视频脚本。", ["video_script"], [], ["create_video_course_anchor", "generate_intro_creative_themes"], []],
    ["完整材料包", "请做五年级数学百分数公开课完整材料包。", ["lesson_plan", "ppt", "image", "video", "package"], [], ["create_requirement_spec", "create_lesson_plan", "create_ppt_outline"], []],
    ["排除PPT的材料包", "做材料包，但不要PPT。", ["package"], ["ppt"], ["create_requirement_spec", "create_lesson_plan"], ["create_ppt_outline", "create_ppt_design_draft", "generate_ppt_sample_assets", "assemble_ppt_full_deck"]],
  ])("exposes the qualified first Tools for an explicit %s task without forcing requirement_spec", async (_label, content, requestedOutputs, excludedOutputs, expectedTools, forbiddenTools) => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-initial-tools-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: content,
      requestedOutputs,
      constraints: [],
      excludedOutputs,
      generationIntensity: project.generationIntensity ?? "standard",
      sourceMessageId: message.id,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async () => { throw new Error("not called"); });
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor, taskBrief,
      });

      expect(config?.allowedToolNames).toEqual(expect.arrayContaining(["request_teacher_decision", ...expectedTools]));
      for (const toolName of forbiddenTools) expect(config?.allowedToolNames).not.toContain(toolName);
      if (!requestedOutputs.includes("package") && !requestedOutputs.includes("requirement_spec")) {
        expect(config?.allowedToolNames).not.toContain("create_requirement_spec");
      }
      expect(config?.allowedToolNames).not.toContain("ppt_director_plan_or_repair");
      expect(config?.allowedToolNames).not.toContain("delivery_critic_review");
      expect(executor).not.toHaveBeenCalled();
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("refreshes the qualified Tool set after create_requirement_spec succeeds", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-refresh-tools-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请做五年级数学百分数公开课完整材料包。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const,
      taskId: taskBrief.taskId,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      standardWorkAuthorized: true,
      intensity: "standard" as const,
      budgetPolicyVersion: "v1-standard",
      maxCostCredits: null,
      maxExternalProviderCalls: 3,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async () => ({
      status: "succeeded" as const,
      toolId: "create_requirement_spec",
      capabilityId: "requirement_spec",
      artifactDraft: {
        nodeKey: "requirement_spec" as const,
        kind: "requirement_spec" as const,
        title: "可信任务规格",
        summary: "任务范围和排除项完整。",
        markdownContent: "# 任务规格",
        structuredContent: {
          artifactQualityState: {
            validationStatus: "passed",
            reviewStatus: "passed",
            downstreamEligibility: "eligible",
          },
        },
      },
      assistantSummary: "已形成可信任务规格。",
      budgetEvent: buildAgentHarnessBudgetEvent({
        capabilityId: "requirement_spec",
        actionKey: "create_requirement_spec:requirement_spec",
        status: "succeeded",
        kind: "tool_succeeded",
      }),
    }));

    try {
      const artifacts: ArtifactRecord[] = [];
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter,
        taskBrief,
        intentGrant,
        controlPlaneStore,
      });

      expect(config?.allowedToolNames).toEqual(expect.arrayContaining(["request_teacher_decision", "create_requirement_spec"]));
      await expect(config!.dispatch({ callId: "requirement", toolName: "create_requirement_spec", arguments: {} }))
        .resolves.toMatchObject({ status: "succeeded" });

      const refreshed = await config!.refreshTools!();
      expect(refreshed.allowedToolNames).toEqual(expect.arrayContaining([
        "create_lesson_plan",
        "create_ppt_outline",
        "create_video_course_anchor",
        "generate_intro_creative_themes",
      ]));
      expect(refreshed.allowedToolNames).not.toContain("create_requirement_spec");
      expect(refreshed.allowedToolNames).not.toContain("ppt_director_plan_or_repair");
      expect(refreshed.allowedToolNames).not.toContain("delivery_critic_review");
      const refreshedMessage = (await service.getMessages(project.id)).find((item) => item.id === message.id)!;
      expect(refreshedMessage.metadata.mainAgentToolExposureTrace).toEqual([
        expect.objectContaining({
          event: "tool_selected",
          selectedToolName: "create_requirement_spec",
          allowedToolNames: expect.arrayContaining(["request_teacher_decision", "create_requirement_spec"]),
          intentEpoch: project.intentEpoch ?? 0,
        }),
        expect.objectContaining({
          event: "tools_exposed",
          allowedToolNames: expect.arrayContaining([
            "create_lesson_plan",
            "create_ppt_outline",
            "create_video_course_anchor",
            "generate_intro_creative_themes",
          ]),
          intentEpoch: project.intentEpoch ?? 0,
        }),
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("keeps the business Tool set empty for a greeting without a TaskBrief", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-chat-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "你好" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("not called"); },
      });

      expect(config).toBeUndefined();
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it.each([
    ["PPT", ["ppt"], ["create_ppt_outline"]],
    ["局部视频脚本", ["video_script"], ["create_video_course_anchor", "generate_intro_creative_themes"]],
    ["完整材料包", ["lesson_plan", "ppt", "image", "video", "package"], [
      "create_lesson_plan", "create_ppt_outline", "create_video_course_anchor", "generate_intro_creative_themes",
    ]],
  ])("exposes every qualified front-stage Tool for %s without a forced order", async (_label, requestedOutputs, expectedTools) => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-qualified-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续当前明确交付任务。" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "可信任务规格", status: "needs_review",
      summary: "任务范围和排除项完整。", markdownContent: "# 任务规格",
      origin: "tool_result",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs, constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [requirement], taskBrief,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("not called"); },
      });
      expect(config?.allowedToolNames).toEqual(expect.arrayContaining(expectedTools));
      expect(config?.allowedToolNames).not.toContain("ppt_director_plan_or_repair");
      expect(config?.allowedToolNames).not.toContain("delivery_critic_review");
      if (requestedOutputs.length === 1 && requestedOutputs[0] === "video_script") {
        expect(config?.allowedToolNames).not.toContain("create_lesson_plan");
        expect(config?.allowedToolNames).not.toContain("create_ppt_outline");
        expect(config?.allowedToolNames).not.toContain("generate_video_storyboard");
      }
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not re-expose completed non-repeatable front-stage Tools", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-completed-tools-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续完成公开课材料包。" });
    const qualityState = { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" };
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "可信任务规格", status: "needs_review",
      summary: "任务范围完整。", markdownContent: "# 任务规格", origin: "tool_result", structuredContent: { artifactQualityState: qualityState },
    });
    const lessonPlan = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan", kind: "lesson_plan", title: "可信教案", status: "needs_review",
      summary: "教案结构完整。", markdownContent: "# 教案", origin: "tool_result", structuredContent: { artifactQualityState: qualityState },
    });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
      constraints: [], excludedOutputs: [], generationIntensity: "standard", sourceMessageId: message.id,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [requirement, lessonPlan], taskBrief,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("not called"); },
      });
      expect(config?.allowedToolNames).not.toContain("create_requirement_spec");
      expect(config?.allowedToolNames).not.toContain("create_lesson_plan");
      expect(config?.allowedToolNames).toEqual(expect.arrayContaining([
        "create_ppt_outline",
        "create_video_course_anchor",
        "generate_intro_creative_themes",
      ]));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists a business Tool artifact and observation with the task execution envelope", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R3-business-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "生成课件样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: "只完成当前 PPT 关键样张。",
      requestedOutputs: ["ppt"], constraints: ["只处理关键页"], excludedOutputs: ["video", "package"],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const, taskId: taskBrief.taskId, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      standardWorkAuthorized: true, intensity: "standard" as const, budgetPolicyVersion: "v1-standard", maxCostCredits: 10, maxExternalProviderCalls: null,
      requiredCheckpoints: [], expiresAt: null,
    };
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId, 5);
    const businessToolRouter = vi.fn(async (input) => ({
      status: "succeeded" as const,
      toolId: "assemble_ppt_key_samples",
      capabilityId: "ppt_key_samples",
      artifactDraft: {
        nodeKey: "image_prompts" as const, kind: "image_prompts" as const, title: "关键样张",
        summary: "已生成关键样张。", markdownContent: "# 关键样张",
        structuredContent: { taskId: taskBrief.taskId, inputHash: input.executionInputHash },
      },
      assistantSummary: "关键样张已生成。",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "ppt_key_samples", actionKey: "assemble_ppt_key_samples:ppt_key_samples", status: "succeeded", kind: "tool_succeeded" }),
    }));
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter,
        taskBrief,
        planRevision: 5,
        intentGrant,
        controlPlaneStore,
      });
      const result = await config!.dispatch({ callId: "business-success", toolName: "assemble_ppt_key_samples", arguments: { pageIds: ["page-1"] } });

      expect(result).toMatchObject({ status: "succeeded", observation: { artifactRefs: [expect.objectContaining({ artifactId: expect.any(String), kind: "image_prompts" })] } });
      expect(businessToolRouter).toHaveBeenCalledWith(expect.objectContaining({
        projectId: project.id, sourceMessageId: message.id, executionIntentEpoch: project.intentEpoch,
        executionEnvelope: {
          actorUserId: actor.userId,
          projectId: project.id,
          taskId: taskBrief.taskId,
          taskBriefDigest: taskBrief.digest,
          intentEpoch: project.intentEpoch,
          planRevision: 5,
          intensity: "standard",
          intentGrant,
          actionDigest: expect.any(String),
          idempotencyKey: expect.any(String),
        },
        projectContext: expect.objectContaining({
          teacherGoal: taskBrief.goal,
          requestedOutputs: taskBrief.requestedOutputs,
        }),
        toolName: "assemble_ppt_key_samples", toolInput: expect.objectContaining({
          pageIds: ["page-1"], generationIntensity: "standard", intentEpoch: project.intentEpoch,
          intentGrant: expect.objectContaining({ taskId: taskBrief.taskId, standardWorkAuthorized: true }),
        }), executionInputHash: expect.any(String),
      }));
      expect(readAgentObservationsFromMessages(await service.getMessages(project.id))).toEqual([
        expect.objectContaining({ status: "succeeded", actionKey: "assemble_ppt_key_samples", minimalNextAction: "continue" }),
      ]);
      expect(await service.getArtifacts(project.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "image_prompts", status: "needs_review", title: "关键样张" }),
      ]));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not spend external Provider budget on reversible package assembly", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R2-package-budget-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续制作完整课件。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 1 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async (input) => {
      const artifactDraft = {
        nodeKey: "image_prompts" as const, kind: "image_prompts" as const, title: "课件资产",
        summary: "已完成当前课件资产步骤。", markdownContent: "# 课件资产",
        structuredContent: { toolName: input.toolName },
      };
      const capabilityId = input.toolName === "assemble_ppt_key_samples" ? "ppt_key_samples" : "ppt_sample_assets";
      return {
        status: "succeeded" as const,
        toolId: input.toolName,
        capabilityId,
        artifactDraft,
        ...(input.toolName === "generate_ppt_sample_assets" ? {
          validationReport: passedArtifactValidationReport(
            input.toolName,
            artifactDraft,
            input.executionInputHash!,
            taskBrief.intentEpoch,
          ),
        } : {}),
        assistantSummary: "已完成当前课件资产步骤。",
        budgetEvent: buildAgentHarnessBudgetEvent({
          capabilityId,
          actionKey: input.toolName,
          status: "succeeded",
          kind: "tool_succeeded",
          providerSubmitted: input.toolName === "generate_ppt_sample_assets",
        }),
      };
    });
    const businessSkillRuntime = createPptSampleAssetsSkillRuntime();

    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); }, businessToolRouter,
        taskBrief, intentGrant, controlPlaneStore, businessSkillRuntime,
      });

      await expect(config!.dispatch({ callId: "package", toolName: "assemble_ppt_key_samples", arguments: {} }))
        .resolves.toMatchObject({ status: "succeeded" });
      await expect(config!.dispatch({ callId: "external-1", toolName: "generate_ppt_sample_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "succeeded" });
      const persistedMessage = (await service.getMessages(project.id)).find((item) => item.id === message.id)!;
      const persistedEvents = readAgentHarnessBudgetEventsFromMessages([persistedMessage]);
      expect(countSubmittedExternalProviderCalls(persistedEvents)).toBe(1);
      expect(persistedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "ppt_sample_assets", providerSubmitted: true }),
      ]));
      const persistedAggregate = await controlPlaneStore.getTaskAggregate(project.id, project.intentEpoch ?? 0);
      const rebuilt = createMainAgentToolLoopOptions({
        service, project, triggerMessage: persistedMessage, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); }, businessToolRouter,
        taskBrief, intentGrant, controlPlaneStore, businessSkillRuntime,
        planRevision: persistedAggregate!.plan.revision,
        externalProviderCallsUsed: countSubmittedExternalProviderCalls(persistedEvents),
      });
      await expect(rebuilt!.dispatch({ callId: "external-2", toolName: "generate_ppt_sample_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "blocked", observation: { reasonCodes: ["budget_upgrade"], nextAction: "ask_teacher" } });
      expect(businessToolRouter).toHaveBeenCalledTimes(2);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("uses requested and excluded outputs together when projecting qualified Tools", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-local-output-scope-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "只继续逐页PPT设计，不生成单独课堂图片。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "可信PPT大纲", status: "needs_review",
      summary: "逐页结构完整。", markdownContent: "# PPT大纲", origin: "tool_result",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt_design", "image"], constraints: [], excludedOutputs: ["image", "ppt", "video", "package"],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const boundOutline = {
      ...outline,
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      intentEpoch: taskBrief.intentEpoch,
    };
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [boundOutline], taskBrief,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        runtime: { run: async () => { throw new Error("not called"); } },
        executor: async () => { throw new Error("not called"); },
      });

      expect(config?.allowedToolNames).toContain("create_ppt_design_draft");
      expect(config?.allowedToolNames).not.toContain("generate_classroom_image");
      expect(config?.allowedToolNames).not.toContain("generate_ppt_sample_assets");
      expect(config?.allowedToolNames).not.toContain("generate_video_storyboard");
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("treats excluded image as a family-wide ban on image Provider Tools", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-image-family-exclusion-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续完成PPT，但不要调用任何图片生成。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: [], excludedOutputs: ["image"],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const boundArtifacts = artifacts.map((artifact) => ({
      ...artifact, taskId: taskBrief.taskId, taskBriefDigest: taskBrief.digest, intentEpoch: taskBrief.intentEpoch,
    }));
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: boundArtifacts, taskBrief,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("not called"); },
      });

      expect(config?.allowedToolNames).not.toContain("generate_classroom_image");
      expect(config?.allowedToolNames).not.toContain("generate_ppt_sample_assets");
      expect(config?.allowedToolNames).not.toContain("generate_ppt_full_assets");
      expect(config?.allowedToolNames).not.toContain("generate_video_assets");
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("blocks a six-unit PPT Provider batch before submission when only five calls remain", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-ppt-batch-budget-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "生成PPT关键样张资产。" });
    const design = await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft", kind: "ppt_design_draft", title: "已确认逐页设计", status: "needs_review",
      summary: "逐页设计已完成。", markdownContent: "# 逐页设计",
      structuredContent: { pptDesignPackage: validPptDesignPackage() },
    });
    await service.approveArtifact(project.id, design.id);
    const artifacts = await service.getArtifacts(project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 5 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async () => { throw new Error("Provider router must not run"); });
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); }, businessToolRouter,
        taskBrief, intentGrant, controlPlaneStore, businessSkillRuntime: createPptSampleAssetsSkillRuntime(),
      });

      await expect(config!.dispatch({ callId: "six-assets-five-budget", toolName: "generate_ppt_sample_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "blocked", observation: { reasonCodes: ["budget_upgrade"], nextAction: "ask_teacher" } });
      expect(businessToolRouter).not.toHaveBeenCalled();
      expect(await service.getGenerationJobs(project.id)).toEqual([]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("scopes a business Tool model request to its own instruction and required trusted artifacts", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9-storyboard-context-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请完成教案、PPT、视频和整包。" });
    const trusted = async (kind: "requirement_spec" | "lesson_plan" | "video_script_generate", title: string) => service.saveArtifact(project.id, {
      nodeKey: kind,
      kind,
      title,
      status: "needs_review",
      summary: `${title}摘要`,
      markdownContent: `# ${title}\n\n这是只属于 ${kind} 的完整内容。`,
      origin: "tool_result",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const artifacts = [
      await trusted("requirement_spec", "任务规格"),
      await trusted("lesson_plan", "教案"),
      await trusted("video_script_generate", "视频脚本"),
    ];
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["video"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 2 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => ({
      status: "failed" as const,
      toolId: "generate_video_storyboard",
      capabilityId: "storyboard_generate",
      errorCategory: "validation",
      artifactCreated: false as const,
      observation: createToolObservation({
        projectId: project.id,
        capabilityId: "storyboard_generate",
        expectedArtifactKind: "storyboard_generate",
        kind: "quality_gate_failed",
        teacherSafeSummary: "诊断完成。",
        internalReasonSanitized: "diagnostic_only",
        retryPolicy: { retryable: false, nextAction: "fix_inputs" },
      }),
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "storyboard_generate", actionKey: "generate_video_storyboard", status: "failed", kind: "tool_failed" }),
    }));
    const toolInstruction = "只根据冻结视频脚本生成57秒灯塔岛分镜。";

    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter, taskBrief, intentGrant, controlPlaneStore,
      });
      await config!.dispatch({ callId: "storyboard", toolName: "generate_video_storyboard", arguments: { userInstruction: toolInstruction } });

      const routed = businessToolRouter.mock.calls[0][0];
      expect(routed.userInstruction).toBe(toolInstruction);
      expect(routed.approvedArtifacts).toEqual([
        expect.objectContaining({ kind: "video_script_generate", artifactId: artifacts[2].id }),
      ]);
      expect(routed.toolInput).toEqual(expect.objectContaining({
        userInstruction: toolInstruction,
        taskBrief: expect.objectContaining({ taskId: taskBrief.taskId, goal: taskBrief.goal }),
      }));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("binds a native Provider Tool to one recoverable GenerationJob and the committed Artifact", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9-native-provider-job-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续生成课件关键样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 2 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async (input) => {
      await input.generationTaskLifecycle?.onTaskAccepted?.("provider-task-native-1");
      const artifactDraft = {
        nodeKey: "image_prompts" as const,
        kind: "image_prompts" as const,
        title: "真实课件样张资产",
        summary: "真实服务已返回课件样张资产。",
        markdownContent: "# 样张资产",
        structuredContent: { assetMode: "provider_generated" },
      };
      return {
        status: "succeeded" as const,
        toolId: "generate_ppt_sample_assets",
        capabilityId: "ppt_sample_assets",
        artifactDraft,
        validationReport: passedArtifactValidationReport(
          "generate_ppt_sample_assets",
          artifactDraft,
          input.executionInputHash!,
          taskBrief.intentEpoch,
        ),
        assistantSummary: "已生成课件样张资产。",
        budgetEvent: buildAgentHarnessBudgetEvent({
          capabilityId: "ppt_sample_assets",
          actionKey: "generate_ppt_sample_assets:ppt_sample_assets",
          status: "succeeded",
          kind: "tool_succeeded",
          providerSubmitted: true,
        }),
      };
    });
    const businessSkillRuntime = createPptSampleAssetsSkillRuntime();

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter,
        taskBrief,
        intentGrant,
        controlPlaneStore,
        businessSkillRuntime,
      });

      const result = await config!.dispatch({
        callId: "native-provider-call",
        toolName: "generate_ppt_sample_assets",
        arguments: { pageIds: ["page-1"] },
      });

      expect(businessToolRouter).toHaveBeenCalledWith(expect.objectContaining({
        generationTaskLifecycle: expect.objectContaining({
          providerTaskId: null,
          onTaskAccepted: expect.any(Function),
        }),
      }));
      const artifactId = result.observation.artifactRefs?.[0]?.artifactId;
      expect(await service.getGenerationJobs(project.id)).toEqual([
        expect.objectContaining({
          kind: "image",
          status: "succeeded",
          resultArtifactId: artifactId,
        }),
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("binds generate_video_shot to the requested shot in both GenerationJob and RunInputSnapshot", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `native-video-unit-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "只生成 shot_01 这一段视频。" });
    const segmentPlan = await createApprovedToolArtifact(service, project.id, "video_segment_plan", "单镜头执行计划");
    const storyboard = await createApprovedToolArtifact(service, project.id, "storyboard_generate", "已确认分镜");
    const assets = await createApprovedToolArtifact(service, project.id, "asset_image_generate", "已确认资产图");
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["video"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 1 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [assets, storyboard, segmentPlan],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: async () => failedProviderResult({
          projectId: project.id,
          sourceMessageId: message.id,
          toolId: "generate_video_segment",
          capabilityId: "video_segment_generate",
          expectedArtifactKind: "video_segment_generate",
        }),
        taskBrief,
        intentGrant,
        controlPlaneStore,
        businessSkillRuntime: createVideoShotSkillRuntime(),
      });

      await expect(config!.dispatch({
        callId: "video-shot-unit",
        toolName: "generate_video_shot",
        arguments: { shotIds: ["shot_01"] },
      })).resolves.toMatchObject({ status: "failed" });

      const jobs = await prisma.generationJob.findMany({
        where: { projectId: project.id },
        include: { runInputSnapshot: true },
      });
      expect(jobs).toHaveLength(1);
      const snapshot = jobs[0].runInputSnapshot!;
      const payload = JSON.parse(snapshot.payloadJson) as {
        input: { unitId?: string; arguments?: { shotIds?: string[] }; sourceArtifacts?: Array<{ artifactId: string }> };
      };
      expect(jobs[0]).toMatchObject({ kind: "video", unitId: "shot_01", status: "failed" });
      expect(JSON.parse(snapshot.sourceArtifactIdsJson)).toEqual([segmentPlan.id, storyboard.id, assets.id]);
      expect(payload.input).toMatchObject({
        unitId: "shot_01",
        arguments: { shotIds: ["shot_01"] },
        sourceArtifacts: [
          { artifactId: segmentPlan.id },
          { artifactId: storyboard.id },
          { artifactId: assets.id },
        ],
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("atomically closes the Tool Invocation when a native Provider generation unit is invalid", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `native-provider-invalid-unit-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "生成当前分镜视频。" });
    const segmentPlan = await createApprovedToolArtifact(service, project.id, "video_segment_plan", "单镜头执行计划");
    const storyboard = await createApprovedToolArtifact(service, project.id, "storyboard_generate", "已确认分镜");
    const assets = await createApprovedToolArtifact(service, project.id, "asset_image_generate", "已确认资产图");
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["video"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 1 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async () => failedProviderResult({
      projectId: project.id,
      sourceMessageId: message.id,
      toolId: "generate_video_segment",
      capabilityId: "video_segment_generate",
      expectedArtifactKind: "video_segment_generate",
    }));

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [segmentPlan, storyboard, assets],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter,
        taskBrief,
        intentGrant,
        controlPlaneStore,
        businessSkillRuntime: createVideoShotSkillRuntime(),
      });

      await expect(config!.dispatch({
        callId: "video-shot-invalid-unit",
        toolName: "generate_video_shot",
        arguments: { shotIds: [] },
      })).resolves.toMatchObject({
        status: "failed",
        observation: {
          reasonCodes: ["native_provider_generation_contract_invalid"],
          nextAction: "replan",
        },
      });

      const [invocations, observations, events, audits, jobs, aggregate] = await Promise.all([
        prisma.toolInvocationRecord.findMany({ where: { projectId: project.id } }),
        prisma.observationRecord.findMany({ where: { projectId: project.id } }),
        prisma.agentEventRecord.findMany({ where: { projectId: project.id } }),
        prisma.orchestrationAuditEvent.findMany({
          where: { resolvedProjectId: project.id, operationKind: "tool_invocation" },
          orderBy: { sequence: "asc" },
        }),
        service.getGenerationJobs(project.id),
        controlPlaneStore.getTaskAggregate(project.id, taskBrief.intentEpoch),
      ]);
      expect(businessToolRouter).not.toHaveBeenCalled();
      expect(jobs).toEqual([]);
      expect(invocations).toEqual([expect.objectContaining({
        toolName: "generate_video_segment",
        status: "failed",
        observationId: observations[0].observationId,
      })]);
      expect(observations).toEqual([expect.objectContaining({
        status: "failed",
        reasonCodesJson: JSON.stringify(["native_provider_generation_contract_invalid"]),
      })]);
      expect(events).toEqual([expect.objectContaining({ kind: "tool_observed" })]);
      expect(audits.map((audit) => ({ recordType: audit.recordType, invocationStatus: audit.invocationStatus }))).toEqual([
        { recordType: "attempted", invocationStatus: "running" },
        { recordType: "resolved", invocationStatus: "failed" },
      ]);
      expect(aggregate).toMatchObject({ plan: { revision: 1 } });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("keeps the declared primary Provider source first when trusted inputs arrive in reverse order", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `native-provider-primary-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续生成完整课件资产。" });
    const [design, approvedSamples] = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 1 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [approvedSamples, design],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: async () => failedProviderResult({
          projectId: project.id,
          sourceMessageId: message.id,
          toolId: "generate_ppt_full_assets",
          capabilityId: "ppt_full_assets",
          expectedArtifactKind: "image_prompts",
        }),
        taskBrief,
        intentGrant,
        controlPlaneStore,
        businessSkillRuntime: createPptImageSkillRuntime("generate_ppt_full_assets"),
      });

      await expect(config!.dispatch({
        callId: "provider-primary-order",
        toolName: "generate_ppt_full_assets",
        arguments: { pageIds: ["page-1", "page-2"] },
      })).resolves.toMatchObject({ status: "failed" });

      const job = await prisma.generationJob.findFirstOrThrow({
        where: { projectId: project.id },
        include: { runInputSnapshot: true },
      });
      const payload = JSON.parse(job.runInputSnapshot!.payloadJson) as {
        input: { sourceArtifacts?: Array<{ artifactId: string; kind: string }> };
      };
      expect(job.sourceArtifactId).toBe(design.id);
      expect(job.unitId).toBeNull();
      expect(JSON.parse(job.runInputSnapshot!.sourceArtifactIdsJson)).toEqual([design.id, approvedSamples.id]);
      expect(payload.input.sourceArtifacts).toEqual([
        { artifactId: design.id, kind: "ppt_design_draft", version: design.version },
        { artifactId: approvedSamples.id, kind: "image_prompts", version: approvedSamples.version },
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("binds a native Provider GenerationJob only to the highest trusted version of each source kind", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `native-provider-version-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "按最新逐页设计生成关键样张。" });
    const oldDesign = await createApprovedToolArtifact(service, project.id, "ppt_design_draft", "旧版逐页设计");
    const latestDesign = await createApprovedToolArtifact(service, project.id, "ppt_design_draft", "最新版逐页设计");
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 1 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [oldDesign, latestDesign],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: async () => failedProviderResult({
          projectId: project.id,
          sourceMessageId: message.id,
          toolId: "generate_ppt_sample_assets",
          capabilityId: "ppt_sample_assets",
          expectedArtifactKind: "image_prompts",
        }),
        taskBrief,
        intentGrant,
        controlPlaneStore,
        businessSkillRuntime: createPptSampleAssetsSkillRuntime(),
      });

      await expect(config!.dispatch({
        callId: "provider-highest-version",
        toolName: "generate_ppt_sample_assets",
        arguments: { pageIds: ["page-1"] },
      })).resolves.toMatchObject({ status: "failed" });

      const job = await prisma.generationJob.findFirstOrThrow({
        where: { projectId: project.id },
        include: { runInputSnapshot: true },
      });
      const payload = JSON.parse(job.runInputSnapshot!.payloadJson) as {
        input: { sourceArtifacts?: Array<{ artifactId: string; version: number }> };
      };
      expect(oldDesign.version).toBeLessThan(latestDesign.version);
      expect(job.sourceArtifactId).toBe(latestDesign.id);
      expect(JSON.parse(job.runInputSnapshot!.sourceArtifactIdsJson)).toEqual([latestDesign.id]);
      expect(payload.input.sourceArtifacts).toEqual([{
        artifactId: latestDesign.id,
        kind: "ppt_design_draft",
        version: latestDesign.version,
      }]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not execute an in-progress non-Provider Tool invocation twice", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `native-tool-in-progress-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "整理本轮需求。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const argumentsValue = {};
    const envelope = createExecutionEnvelope({
      actorUserId: actor.userId,
      taskBrief,
      planRevision: 0,
      intensity: project.generationIntensity ?? "standard",
      intentGrant,
      action: { toolName: "create_requirement_spec", arguments: argumentsValue },
    });
    const claim = await controlPlaneStore.startToolInvocation({
      invocationId: `invocation-${crypto.randomUUID()}`,
      envelope,
      toolName: "create_requirement_spec",
      request: argumentsValue,
    });
    expect(claim.kind).toBe("claimed");
    const businessToolRouter = vi.fn(async () => { throw new Error("in-progress Tool must not execute"); });
    const loadForSelectedTool = vi.fn(async () => { throw new Error("in-progress Tool must not load its Skill"); });
    const businessSkillRuntime = {
      loadForSelectedTool,
      validateSelectedToolResult: vi.fn(async () => { throw new Error("in-progress Tool must not validate Skill output"); }),
    } as BusinessToolSkillRuntime;

    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [], taskBrief, intentGrant, controlPlaneStore,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter, businessSkillRuntime,
      });
      await expect(config!.dispatch({
        callId: "duplicate-requirement-spec",
        toolName: "create_requirement_spec",
        arguments: argumentsValue,
      })).resolves.toMatchObject({
        status: "inconclusive",
        observation: { reasonCodes: ["tool_invocation_in_progress"], nextAction: "pause" },
      });
      expect(loadForSelectedTool).not.toHaveBeenCalled();
      expect(businessToolRouter).not.toHaveBeenCalled();
      await expect(controlPlaneStore.getToolInvocation(claim.invocation.invocationId))
        .resolves.toMatchObject({ status: "running" });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not mutate or redispatch a concurrent Provider invocation before providerTaskId persistence", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `native-provider-concurrent-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "生成课件关键样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 2 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessSkillRuntime = createPptSampleAssetsSkillRuntime();
    let releaseFirstRouter: () => void = () => undefined;
    let markFirstRouterEntered: () => void = () => undefined;
    const firstRouterEntered = new Promise<void>((resolve) => { markFirstRouterEntered = resolve; });
    const holdFirstRouter = new Promise<void>((resolve) => { releaseFirstRouter = resolve; });
    const firstRouter = vi.fn(async () => {
      markFirstRouterEntered();
      await holdFirstRouter;
      return failedProviderResult({
        projectId: project.id,
        sourceMessageId: message.id,
        toolId: "generate_ppt_sample_assets",
        capabilityId: "ppt_sample_assets",
        expectedArtifactKind: "image_prompts",
      });
    });
    let firstDispatch: Promise<MainAgentReActDispatchResult> | undefined;

    try {
      const first = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts, taskBrief, intentGrant, controlPlaneStore,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: firstRouter, businessSkillRuntime,
      });
      firstDispatch = first!.dispatch({
        callId: "provider-concurrent-first",
        toolName: "generate_ppt_sample_assets",
        arguments: { pageIds: ["page-1"] },
      });
      await firstRouterEntered;

      const duplicateRouter = vi.fn(async () => { throw new Error("concurrent Provider Tool must not execute"); });
      const duplicate = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts, taskBrief, intentGrant, controlPlaneStore,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: duplicateRouter, businessSkillRuntime,
      });
      await expect(duplicate!.dispatch({
        callId: "provider-concurrent-duplicate",
        toolName: "generate_ppt_sample_assets",
        arguments: { pageIds: ["page-1"] },
      })).resolves.toMatchObject({
        status: "inconclusive",
        observation: { reasonCodes: ["tool_invocation_in_progress"], nextAction: "pause" },
      });
      expect(duplicateRouter).not.toHaveBeenCalled();
      expect(firstRouter).toHaveBeenCalledTimes(1);
      expect(businessSkillRuntime.loadForSelectedTool).toHaveBeenCalledTimes(1);
      expect(await service.getGenerationJobs(project.id)).toEqual([
        expect.objectContaining({ status: "running", resultArtifactId: null }),
      ]);

      releaseFirstRouter();
      await expect(firstDispatch).resolves.toMatchObject({ status: "failed" });
    } finally {
      releaseFirstRouter();
      await firstDispatch?.catch(() => undefined);
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("resumes a native Provider Tool from the persisted providerTaskId without submitting twice", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9-native-provider-resume-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续生成课件关键样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief, { maxExternalProviderCalls: 2 });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    let submits = 0;
    const crashingRouter = vi.fn(async (routerInput) => {
      submits += 1;
      await routerInput.generationTaskLifecycle?.onTaskAccepted?.("provider-task-resume-1");
      throw new Error("simulated_process_interruption_after_provider_accept");
    });
    const businessSkillRuntime = createPptSampleAssetsSkillRuntime();

    try {
      const first = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: crashingRouter, taskBrief, intentGrant, controlPlaneStore, businessSkillRuntime,
      });
      await expect(first!.dispatch({
        callId: "provider-before-crash",
        toolName: "generate_ppt_sample_assets",
        arguments: { pageIds: ["page-1"] },
      })).rejects.toThrow("simulated_process_interruption_after_provider_accept");

      const resumedRouter = vi.fn(async (routerInput) => {
        const artifactDraft = {
          nodeKey: "image_prompts" as const,
          kind: "image_prompts" as const,
          title: "恢复后的真实课件样张资产",
          summary: `复用任务 ${routerInput.generationTaskLifecycle?.providerTaskId}`,
          markdownContent: "# 恢复样张资产",
          structuredContent: { recoveredProviderTaskId: routerInput.generationTaskLifecycle?.providerTaskId },
        };
        return {
          status: "succeeded" as const,
          toolId: "generate_ppt_sample_assets",
          capabilityId: "ppt_sample_assets",
          artifactDraft,
          validationReport: passedArtifactValidationReport(
            "generate_ppt_sample_assets",
            artifactDraft,
            routerInput.executionInputHash!,
            taskBrief.intentEpoch,
          ),
          assistantSummary: "已从原生成任务恢复。",
          budgetEvent: buildAgentHarnessBudgetEvent({
            capabilityId: "ppt_sample_assets",
            actionKey: "generate_ppt_sample_assets:ppt_sample_assets",
            status: "succeeded",
            kind: "tool_succeeded",
            providerSubmitted: false,
          }),
        };
      });
      const resumed = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter: resumedRouter, taskBrief, intentGrant, planRevision: 0, controlPlaneStore, businessSkillRuntime,
      });
      await expect(resumed!.dispatch({
        callId: "provider-after-restart",
        toolName: "generate_ppt_sample_assets",
        arguments: { pageIds: ["page-1"] },
      })).resolves.toMatchObject({ status: "succeeded" });

      expect(submits).toBe(1);
      expect(resumedRouter).toHaveBeenCalledWith(expect.objectContaining({
        generationTaskLifecycle: expect.objectContaining({ providerTaskId: "provider-task-resume-1" }),
      }));
      expect(await service.getGenerationJobs(project.id)).toEqual([
        expect.objectContaining({ status: "succeeded", resultArtifactId: expect.any(String) }),
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not let the dispatch adapter stop a repaired Tool call with materially changed inputs", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R17-cycle-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续修正课件样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const failedTool = getToolDefinition("assemble_ppt_key_samples");
    const failedContract = resolveRuntimeContract(failedTool);
    const businessToolRouter = vi.fn(async (routerInput: ToolRouterInput) => ({
      status: "failed" as const,
      toolId: "assemble_ppt_key_samples",
      capabilityId: "ppt_key_samples",
      observation: createToolObservation({
        projectId: project.id,
        sourceMessageId: message.id,
        capabilityId: "ppt_key_samples",
        expectedArtifactKind: "image_prompts",
        kind: "quality_gate_failed",
        reasonCode: "ppt_design_candidate_semantics_invalid",
        reasonDetails: ["topic_mismatch"],
        teacherSafeSummary: "课件样张没有通过校验。",
        internalReasonSanitized: "Tool output failed deterministic runtime contract validation.",
        retryPolicy: { retryable: false, nextAction: "fix_inputs" },
      }),
      artifactCreated: false as const,
      errorCategory: "quality_gate_failed",
      budgetEvent: buildAgentHarnessBudgetEvent({
        capabilityId: "ppt_key_samples",
        actionKey: "assemble_ppt_key_samples:ppt_key_samples",
        status: "failed",
        kind: "quality_gate_failed",
      }),
      validationReport: createValidationReport({
        reportId: "report-cycle",
        domain: "ppt" as const,
        stage: failedContract.capabilityId,
        target: { kind: "tool_execution" as const },
        contract: { id: failedContract.id, version: failedContract.version },
        inputHash: routerInput.executionInputHash,
        overallStatus: "failed" as const,
        gates: [{
          gateId: "ppt_sample_plan",
          validatorId: "runtime_contract",
          validatorVersion: "v1",
          status: "failed" as const,
          evidenceRefs: [],
          locators: [],
          responsibleStage: "ppt_sample_plan",
          reasonCode: "sample_high_risk_page_missing",
        }],
        createdAt: new Date().toISOString(),
      }),
    }));
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const,
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      standardWorkAuthorized: true,
      intensity: "standard" as const,
      budgetPolicyVersion: "v1-standard",
      maxCostCredits: null,
      maxExternalProviderCalls: 1,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const taskBrief = createTaskBrief({
      taskId: intentGrant.taskId, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    try {
      const firstConfig = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence, executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter, intentGrant, taskBrief, controlPlaneStore,
      });
      await expect(firstConfig!.dispatch({ callId: "failure-1", toolName: "assemble_ppt_key_samples", arguments: { revision: 1 } }))
        .resolves.toMatchObject({ status: "failed", observation: { reasonCodes: expect.arrayContaining(["sample_high_risk_page_missing", "ppt_design_candidate_semantics_invalid", "topic_mismatch"]) } });
      await expect(firstConfig!.dispatch({ callId: "failure-2", toolName: "assemble_ppt_key_samples", arguments: { revision: 2 } }))
        .resolves.toMatchObject({ status: "failed" });

      const refreshedMessage = (await service.getMessages(project.id)).find((item) => item.id === message.id)!;
      const rebuiltConfig = createMainAgentToolLoopOptions({
        service, project, triggerMessage: refreshedMessage, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence, executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter, intentGrant, taskBrief, planRevision: 2, controlPlaneStore,
      });
      await expect(rebuiltConfig!.dispatch({ callId: "failure-3", toolName: "assemble_ppt_key_samples", arguments: { revision: 3 } }))
        .resolves.toMatchObject({ status: "failed", observation: { reasonCodes: expect.arrayContaining(["sample_high_risk_page_missing"]) } });

      expect(businessToolRouter).toHaveBeenCalledTimes(3);
      const messages = await service.getMessages(project.id);
      expect(readAgentObservationsFromMessages(messages).at(-1)?.reasonCodes)
        .toContain("sample_high_risk_page_missing");
      expect(readLatestRunCheckpointFromMessages(messages)).toBeNull();
      const persistedReports = await prisma.validationReportRecord.findMany({
        where: { projectId: project.id, stage: "ppt_key_samples" },
      });
      expect(persistedReports).toHaveLength(3);
      for (const persisted of persistedReports) {
        const report = JSON.parse(persisted.payloadJson) as { reportId: string; reportDigest: string; target: { kind: string; targetId?: string } };
        expect(report).toMatchObject({
          reportId: persisted.id,
          reportDigest: persisted.reportDigest,
          target: { kind: "tool_invocation", targetId: expect.any(String) },
        });
      }
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists round-budget Observation, checkpoint, and stop trace without executing the pending Tool", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R17-round-budget-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请继续完成当前材料包规划。" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor: async () => { throw new Error("pending Tool must not execute"); },
        taskBrief: createTaskBrief({
          taskId: "task-budget",
          projectId: project.id,
          intentEpoch: project.intentEpoch ?? 0,
          goal: message.content,
          requestedOutputs: ["lesson_plan", "ppt", "video", "package"],
          constraints: [],
          excludedOutputs: [],
          generationIntensity: "standard",
          sourceMessageId: message.id,
        }),
        planRevision: 8,
      });

      await config!.onBudgetExhausted?.({
        reason: "tool_round_limit_reached",
        toolRoundsUsed: 8,
        maxToolRounds: 8,
        pendingToolName: "generate_video_storyboard",
        observationIds: ["observation-1", "observation-2"],
      });

      const messages = await service.getMessages(project.id);
      expect(readAgentObservationsFromMessages(messages).at(-1)).toMatchObject({
        source: "budget",
        status: "blocked",
        actionKey: "generate_video_storyboard",
        reasonCodes: ["retry_budget_exhausted", "tool_round_limit_reached"],
        minimalNextAction: "pause",
      });
      expect(readLatestRunCheckpointFromMessages(messages)).toMatchObject({
        projectId: project.id,
        planVersion: 8,
        status: "paused",
        reason: "budget_exhausted",
        actionKey: "generate_video_storyboard",
        observationRefs: expect.arrayContaining(["observation-1", "observation-2"]),
      });
      expect(readLatestRunCheckpointFromMessages(messages)?.observationRefs).toHaveLength(3);
      expect(messages.find((item) => item.id === message.id)?.metadata.mainAgentToolExposureTrace).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: "run_paused",
          selectedToolName: "generate_video_storyboard",
          rejectionReason: "tool_round_limit_reached",
        }),
      ]));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not execute or persist an Agent Tool after IntentEpoch changes", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-stale-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT大纲", status: "needs_review",
      summary: "可信逐页大纲", markdownContent: "# PPT大纲",
      origin: "tool_result",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt_design"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const boundOutline = {
      ...outline,
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      intentEpoch: taskBrief.intentEpoch,
    };
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [boundOutline],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
        taskBrief,
      });
      await service.advanceProjectIntentEpoch(project.id, project.intentEpoch ?? 0);
      const result = await config!.dispatch({
        callId: "call-2",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });
      expect(result).toMatchObject({ status: "inconclusive", observation: { reasonCodes: ["intent_changed"], nextAction: "replan" } });
      expect(executor).not.toHaveBeenCalled();
      expect(readAgentToolReportsFromMessages(await service.getMessages(project.id))).toEqual([]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("blocks a business Tool when its grant belongs to a different task epoch", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R2-scope-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "生成课件样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt_key_samples"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const boundArtifacts = artifacts.map((artifact) => ({
      ...artifact, taskId: taskBrief.taskId, taskBriefDigest: taskBrief.digest, intentEpoch: taskBrief.intentEpoch,
    }));
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: boundArtifacts, taskBrief,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); }, businessToolRouter,
        intentGrant: {
          schemaVersion: "intent-grant.v1", taskId: "task-1", projectId: project.id, intentEpoch: (project.intentEpoch ?? 0) + 1,
          standardWorkAuthorized: true, intensity: "standard", budgetPolicyVersion: "v1-standard", maxCostCredits: 10, maxExternalProviderCalls: null,
          requiredCheckpoints: [], expiresAt: null,
        },
      });
      await expect(config!.dispatch({ callId: "scope-mismatch", toolName: "assemble_ppt_key_samples", arguments: {} }))
        .resolves.toMatchObject({ status: "inconclusive", observation: { reasonCodes: ["task_aggregate_stale"], nextAction: "replan" } });
      expect(businessToolRouter).not.toHaveBeenCalled();
      expect((await service.getMessages(project.id)).find((entry) => entry.id === message.id)?.metadata.pendingDeliveryPlan).toBeUndefined();
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists a course-anchor Critic review without approving the concept", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-7-anchor-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "审查当前视频创意。" });
    const concept = await service.saveArtifact(project.id, {
      nodeKey: "creative_theme_generate", kind: "creative_theme_generate", title: "独立创意候选",
      status: "needs_review", summary: "等待课程锚点审查。", markdownContent: "# 独立创意候选",
      structuredContent: { conceptSelection: { selectedConceptId: "concept-a" } },
    });
    const digest = hashArtifactDraft({
      nodeKey: concept.nodeKey, kind: concept.kind, title: concept.title, summary: concept.summary,
      markdownContent: concept.markdownContent, structuredContent: concept.structuredContent,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const, toolId: "delivery_critic.review" as const, invocationId: envelope.invocationId,
      structuredOutput: {
        recommendation: "pass", summary: "六个硬门全部通过。", findings: [],
        targetLocators: [{ kind: "artifact", artifactKind: concept.kind, artifactId: concept.id }],
        responsibleStage: "video_concept_selection", minimalFix: "无需返修。", inconclusiveReasons: [],
        hardGateResults: videoCourseAnchorHardGateIds.map((gateId) => ({ gateId, status: "passed", evidenceRefs: [`evidence:${gateId}`], rationale: "证据满足。", findingIds: [] })),
      },
      assistantSummary: "课程锚点审查通过。", artifactCreated: false as const,
    }));
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["video"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const controlPlaneStore = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);

    try {
      const artifacts = [concept];
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence, executor,
        taskBrief, intentGrant, controlPlaneStore,
      });
      const result = await config!.dispatch({
        callId: "call-anchor", toolName: "delivery_critic_review",
        arguments: {
          domain: "video", stage: "course_anchor",
          targetLocators: [{ kind: "artifact", artifactKind: concept.kind, artifactId: concept.id }],
          reviewFocus: null, courseAnchorRef: { artifactId: concept.id, version: concept.version, digest },
          rubricRef: { id: "video-course-anchor", version: "v1", digest: "b".repeat(64) },
          generatorInvocationId: "generator-a",
        },
      });

      expect(result).toMatchObject({ status: "succeeded", observation: { artifactRefs: [expect.objectContaining({ kind: "creative_theme_generate" })] } });
      const reviewed = artifacts.at(-1)!;
      expect(reviewed).toMatchObject({
        status: "needs_review",
        isApproved: false,
        structuredContent: {
          videoCourseAnchorReview: { overallStatus: "passed" },
          artifactQualityState: { validationStatus: "not_required", reviewStatus: "passed", downstreamEligibility: "eligible" },
        },
      });
      expect(buildCapabilityAvailability({ capabilityDefinitions: getCapabilityDefinitions(), artifacts })
        .find((entry) => entry.capabilityId === "video_script_generate")).toMatchObject({ status: "available" });
      await expect(service.approveArtifact(project.id, reviewed.id)).resolves.toMatchObject({ status: "approved" });
      expect(readAgentToolReportsFromMessages(await service.getMessages(project.id))).toHaveLength(1);
      expect(readAgentObservationsFromMessages(await service.getMessages(project.id))).toHaveLength(1);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not persist a Critic review Artifact when its atomic control-plane commit fails", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-critic-atomic-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "审查当前视频创意。" });
    const concept = await service.saveArtifact(project.id, {
      nodeKey: "creative_theme_generate", kind: "creative_theme_generate", title: "独立创意候选",
      status: "needs_review", summary: "等待课程锚点审查。", markdownContent: "# 独立创意候选",
      structuredContent: { conceptSelection: { selectedConceptId: "concept-a" } },
    });
    const digest = hashArtifactDraft({
      nodeKey: concept.nodeKey, kind: concept.kind, title: concept.title, summary: concept.summary,
      markdownContent: concept.markdownContent, structuredContent: concept.structuredContent,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const, toolId: "delivery_critic.review" as const, invocationId: envelope.invocationId,
      structuredOutput: {
        recommendation: "pass", summary: "六个硬门全部通过。", findings: [],
        targetLocators: [{ kind: "artifact", artifactKind: concept.kind, artifactId: concept.id }],
        responsibleStage: "video_concept_selection", minimalFix: "无需返修。", inconclusiveReasons: [],
        hardGateResults: videoCourseAnchorHardGateIds.map((gateId) => ({ gateId, status: "passed", evidenceRefs: [`evidence:${gateId}`], rationale: "证据满足。", findingIds: [] })),
      },
      assistantSummary: "课程锚点审查通过。", artifactCreated: false as const,
    }));
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["video"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = standardIntentGrant(taskBrief);
    const store = await persistTaskAggregate(taskBrief, intentGrant, actor.userId);
    const injectedFailure = new Error("injected_critic_atomic_commit_failure");
    const controlPlaneStore = {
      ...store,
      commitToolResult: vi.fn(async () => { throw injectedFailure; }),
      commitToolObservation: vi.fn(async () => { throw injectedFailure; }),
    };
    const beforeCount = (await service.getArtifacts(project.id)).length;

    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [concept],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence, executor,
        taskBrief, intentGrant, controlPlaneStore,
      });
      await expect(config!.dispatch({
        callId: "call-anchor-atomic", toolName: "delivery_critic_review",
        arguments: {
          domain: "video", stage: "course_anchor",
          targetLocators: [{ kind: "artifact", artifactKind: concept.kind, artifactId: concept.id }],
          reviewFocus: null, courseAnchorRef: { artifactId: concept.id, version: concept.version, digest },
          rubricRef: { id: "video-course-anchor", version: "v1", digest: "b".repeat(64) },
          generatorInvocationId: "generator-a",
        },
      })).rejects.toThrow("injected_critic_atomic_commit_failure");
      expect(await service.getArtifacts(project.id)).toHaveLength(beforeCount);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});

function standardIntentGrant(
  taskBrief: TaskBrief,
  overrides: Partial<IntentGrant> = {},
): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "v1-standard-task-scope.v1",
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    requiredCheckpoints: [],
    expiresAt: null,
    ...overrides,
  };
}

async function persistTaskAggregate(taskBrief: TaskBrief, intentGrant: IntentGrant, actorUserId: string, revision = 0) {
  const store = createControlPlaneStore();
  await store.upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${taskBrief.taskId}`, revision, status: "active" },
    status: "active",
    checkpoint: null,
  });
  await prisma.conversationTurnJob.create({
    data: {
      projectId: taskBrief.projectId,
      teacherMessageId: taskBrief.sourceMessageId,
      status: "running",
      actorUserId,
      actorAuthMode: "local",
    },
  });
  return store;
}

function createPptSampleAssetsSkillRuntime(): BusinessToolSkillRuntime {
  return createPptImageSkillRuntime("generate_ppt_sample_assets");
}

function createPptImageSkillRuntime(
  toolName: "generate_ppt_sample_assets" | "generate_ppt_full_assets",
): BusinessToolSkillRuntime {
  const consumes = toolName === "generate_ppt_full_assets"
    ? ["ppt_design_draft", "image_prompts"]
    : ["ppt_design_draft"];
  return {
    loadForSelectedTool: vi.fn(async (input) => {
      if (input.businessToolName !== toolName) {
        throw new Error(`Unexpected formal Skill Tool in test Runtime: ${input.businessToolName}`);
      }
      return {
        skillName: "shanhai-imagegen",
        skillVersion: "1.1",
        displayName: "山海图片生成",
        responsibility: "执行当前Tool已定义的图片请求",
        semanticSlice: {
          schemaVersion: "business-tool-skill-slice.v1" as const,
          bindingMode: "formal_contract" as const,
          artifactContractAuthority: "skill" as const,
          toolName,
          responsibility: "执行当前Tool已定义的图片请求",
          contracts: {
            tool: { consumes, produces: ["image_prompts"] },
            skill: {
              consumes: [],
              produces: [{
                artifactType: "image-generation-result",
                contractVersion: "shanhai-imagegen/v2",
              }],
            },
          },
          guidance: [{
            sourcePath: "references/result-contract.md",
            content: "绑定真实图片结果与质量证据。",
          }],
        },
        provenance: {
          schemaVersion: "business-tool-skill-provenance.v1" as const,
          entrypointSha256: `sha256:${"a".repeat(64)}`,
          references: [{
            sourcePath: "references/result-contract.md",
            sha256: `sha256:${"b".repeat(64)}`,
          }],
          bindingPolicyDigest: `sha256:${"c".repeat(64)}`,
        },
      };
    }),
    validateSelectedToolResult: vi.fn(async (input) => {
      if (input.businessToolName !== toolName) {
        throw new Error(`Unexpected formal Skill validation in test Runtime: ${input.businessToolName}`);
      }
      return {
        status: "passed" as const,
        bindingMode: "formal_contract" as const,
        contract: {
          skillName: "shanhai-imagegen",
          skillVersion: "1.1",
          artifactType: "image-generation-result",
          contractVersion: "shanhai-imagegen/v2",
          adapterId: "image-result-batch.v2",
          schemaDigest: `sha256:${"d".repeat(64)}`,
          payloadDigest: `sha256:${"e".repeat(64)}`,
        },
      };
    }),
  };
}

function createVideoShotSkillRuntime(): BusinessToolSkillRuntime {
  return {
    async loadForSelectedTool(input) {
      if (input.businessToolName !== "generate_video_shot") {
        throw new Error(`Unexpected formal Skill Tool in test Runtime: ${input.businessToolName}`);
      }
      return {
        skillName: "shanhai-video-generation",
        skillVersion: "1.1",
        displayName: "山海视频生成",
        responsibility: "核验当前Tool生成的单镜头视频结果",
        semanticSlice: {
          schemaVersion: "business-tool-skill-slice.v1" as const,
          bindingMode: "formal_contract" as const,
          artifactContractAuthority: "skill" as const,
          toolName: "generate_video_shot",
          responsibility: "核验当前Tool生成的单镜头视频结果",
          contracts: {
            tool: {
              consumes: ["video_segment_plan", "storyboard_generate", "asset_image_generate"],
              produces: ["video_segment_generate"],
            },
            skill: {
              consumes: [{ artifactType: "video-package", contractVersion: "shanhai-video/v1" }],
              produces: [{ artifactType: "video-generation-result", contractVersion: "shanhai-video-generation/v2" }],
            },
          },
          guidance: [{
            sourcePath: "references/result-contract.md",
            content: "绑定单镜头请求、真实文件与质量证据。",
          }],
        },
        provenance: {
          schemaVersion: "business-tool-skill-provenance.v1" as const,
          entrypointSha256: `sha256:${"a".repeat(64)}`,
          references: [{
            sourcePath: "references/result-contract.md",
            sha256: `sha256:${"b".repeat(64)}`,
          }],
          bindingPolicyDigest: `sha256:${"c".repeat(64)}`,
        },
      };
    },
    async validateSelectedToolResult(input) {
      if (input.businessToolName !== "generate_video_shot") {
        throw new Error(`Unexpected formal Skill validation in test Runtime: ${input.businessToolName}`);
      }
      return {
        status: "passed" as const,
        bindingMode: "formal_contract" as const,
        contract: {
          skillName: "shanhai-video-generation",
          skillVersion: "1.1",
          artifactType: "video-generation-result",
          contractVersion: "shanhai-video-generation/v2",
          adapterId: "video-result-single-shot.v2",
          schemaDigest: `sha256:${"d".repeat(64)}`,
          payloadDigest: `sha256:${"e".repeat(64)}`,
        },
      };
    },
  };
}

async function createApprovedToolArtifact(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
  kind: ArtifactRecord["kind"],
  title: string,
) {
  const artifact = await service.saveArtifact(projectId, {
    nodeKey: kind,
    kind,
    title,
    status: "needs_review",
    summary: `${title}已完成。`,
    markdownContent: `# ${title}`,
  });
  await service.approveArtifact(projectId, artifact.id);
  return service.getArtifact(projectId, artifact.id);
}

function failedProviderResult(input: {
  projectId: string;
  sourceMessageId: string;
  toolId: string;
  capabilityId: string;
  expectedArtifactKind: ArtifactRecord["kind"];
}): ToolExecutionResult {
  return {
    status: "failed",
    toolId: input.toolId,
    capabilityId: input.capabilityId,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId: input.capabilityId,
      expectedArtifactKind: input.expectedArtifactKind,
      kind: "provider_unavailable",
      teacherSafeSummary: "离线合同测试未提交外部生成请求。",
      internalReasonSanitized: "offline_contract_probe",
      retryPolicy: { retryable: false, nextAction: "retry_later" },
    }),
    artifactCreated: false,
    errorCategory: "provider_unavailable",
    budgetEvent: buildAgentHarnessBudgetEvent({
      capabilityId: input.capabilityId,
      actionKey: input.toolId,
      status: "failed",
      kind: "tool_failed",
      providerSubmitted: false,
    }),
  };
}

async function createApprovedPptToolPrerequisites(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
) {
  const design = await service.saveArtifact(projectId, {
    nodeKey: "ppt_design_draft",
    kind: "ppt_design_draft",
    title: "已确认逐页设计",
    status: "needs_review",
    summary: "逐页设计已完成。",
    markdownContent: "# 逐页设计",
  });
  const assets = await service.saveArtifact(projectId, {
    nodeKey: "image_prompts",
    kind: "image_prompts",
    title: "已确认样张资产",
    status: "needs_review",
    summary: "关键样张资产已完成。",
    markdownContent: "# 关键样张资产",
  });
  await service.approveArtifact(projectId, design.id);
  await service.approveArtifact(projectId, assets.id);
  return [
    await service.getArtifact(projectId, design.id),
    await service.getArtifact(projectId, assets.id),
  ];
}

function passedArtifactValidationReport(
  toolId: string,
  artifactDraft: Parameters<typeof hashArtifactDraft>[0],
  inputHash: string,
  intentEpoch: number,
) {
  const tool = getToolDefinition(toolId);
  const contract = resolveRuntimeContract(tool);
  const structuralReport = validateToolExecutionResult({
    tool,
    projectId: "provider-contract-test",
    result: {
      status: "succeeded",
      artifactDraft,
      artifactTruth: {
        created: true,
        persisted: true,
        persistenceScope: "provider_local_file",
        providerPersisted: true,
        workbenchPersisted: false,
        placeholder: false,
        producedArtifactKind: artifactDraft.kind,
      },
      qualityGate: { passed: true, gates: ["provider_output_valid"] },
    },
    inputHash,
    intentEpoch,
  });
  const requiredGateIds = new Set([
    "execution_result",
    "output_kind",
    "output_node",
    "artifact_truth",
    "provider_quality_gate",
  ]);
  const gates = structuralReport.gates.filter((gate) => requiredGateIds.has(gate.gateId));
  if (gates.length !== requiredGateIds.size || gates.some((gate) => gate.status !== "passed")) {
    throw new Error("Provider contract fixture could not produce the required success gates.");
  }
  return createValidationReport({
    reportId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    domain: validationDomainForCapability(contract.capabilityId),
    stage: contract.capabilityId,
    target: {
      kind: "artifact_draft",
      targetId: toolId,
      targetDigest: hashArtifactDraft(artifactDraft),
    },
    contract: { id: contract.id, version: contract.version },
    inputHash,
    intentEpoch,
    overallStatus: "passed",
    gates,
  });
}

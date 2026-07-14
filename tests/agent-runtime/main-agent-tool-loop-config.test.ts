import { describe, expect, it, vi } from "vitest";

import { createMainAgentToolLoopOptions } from "@/server/conversation/main-agent-tool-loop-config";
import { readAgentObservationsFromMessages, readLatestRunCheckpointFromMessages } from "@/server/conversation/react-control";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";
import { createWorkbenchActor } from "@/server/auth/actor";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";
import { buildCapabilityAvailability } from "@/server/capabilities/capability-availability";
import { getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { validPptDirectorOutput } from "../support/ppt-director-output-fixture";
import { createTaskBrief } from "@/server/conversation/task-contract";

describe("V1-3 Main Agent Agent Tool loop config", () => {
  it("persists a signed Agent Tool report and observation under the active project lease", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-loop-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT大纲", status: "needs_review",
      summary: "可信逐页大纲", markdownContent: "# PPT大纲",
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
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [outline],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
      });
      expect(config?.allowedToolNames).toContain("ppt_director_plan_or_repair");
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
    directorOutput.evidence_bindings[0].source_artifact_id = outline.id;
    directorOutput.evidence_bindings[0].source_type = "teacher_material";
    directorOutput.evidence_bindings[0].digest = outlineDigest;
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
      taskId: "task-ppt-director", projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: ["十页"], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });

    try {
      const config = createMainAgentToolLoopOptions({
        service, runtime, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence, executor,
        taskBrief, intentGrant: {
          schemaVersion: "intent-grant.v1", taskId: "task-ppt-director", projectId: project.id,
          intentEpoch: project.intentEpoch ?? 0, standardWorkAuthorized: true, intensity: "standard",
          budgetPolicyVersion: "v1-standard", maxCostCredits: null, maxExternalProviderCalls: null,
          requiredCheckpoints: [], expiresAt: null,
        },
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
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [await service.getArtifact(project.id, design.id)],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); },
      });
      expect(config?.allowedToolNames).toContain("generate_ppt_sample_assets");
      expect(config?.allowedToolNames).not.toContain("raw_provider_submit");

      const result = await config!.dispatch({ callId: "business-without-grant", toolName: "generate_ppt_sample_assets", arguments: {} });
      expect(result).toMatchObject({ status: "blocked", observation: { reasonCodes: ["missing_grant"], nextAction: "ask_teacher" } });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it.each([
    ["一句话 PPT", "请做五年级数学百分数公开课 PPT，约 10 页。", ["ppt"]],
    ["局部视频脚本", "只做五年级数学百分数独立创意导入视频脚本。", ["video_script"]],
    ["完整材料包", "请做五年级数学百分数公开课完整材料包。", ["lesson_plan", "ppt", "image", "video", "package"]],
  ])("exposes create_requirement_spec first for an explicit %s task without exposing Director or Critic", async (_label, content, requestedOutputs) => {
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
      excludedOutputs: [],
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

      expect(config?.allowedToolNames).toEqual(["create_requirement_spec"]);
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
      });

      expect(config?.allowedToolNames).toEqual(["create_requirement_spec"]);
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
          allowedToolNames: ["create_requirement_spec"],
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
      summary: "任务范围完整。", markdownContent: "# 任务规格", structuredContent: { artifactQualityState: qualityState },
    });
    const lessonPlan = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan", kind: "lesson_plan", title: "可信教案", status: "needs_review",
      summary: "教案结构完整。", markdownContent: "# 教案", structuredContent: { artifactQualityState: qualityState },
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
      taskId: "task-1", projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: "只完成当前 PPT 关键样张。",
      requestedOutputs: ["ppt"], constraints: ["只处理关键页"], excludedOutputs: ["video", "package"],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const, taskId: taskBrief.taskId, projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      standardWorkAuthorized: true, intensity: "standard" as const, budgetPolicyVersion: "v1-standard", maxCostCredits: 10, maxExternalProviderCalls: null,
      requiredCheckpoints: [], expiresAt: null,
    };
    const businessToolRouter = vi.fn(async (input) => ({
      status: "succeeded" as const,
      toolId: "assemble_ppt_key_samples",
      capabilityId: "ppt_key_samples",
      artifactDraft: {
        nodeKey: "image_prompts" as const, kind: "image_prompts" as const, title: "关键样张",
        summary: "已生成关键样张。", markdownContent: "# 关键样张",
        structuredContent: { taskId: "task-1", inputHash: input.executionInputHash },
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
          intentGrant: expect.objectContaining({ taskId: "task-1", standardWorkAuthorized: true }),
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
      taskId: "task-1", projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
      goal: message.content, requestedOutputs: ["ppt"], constraints: [], excludedOutputs: [],
      generationIntensity: "standard", sourceMessageId: message.id,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async (input) => ({
      status: "succeeded" as const,
      toolId: input.toolName,
      capabilityId: input.toolName === "assemble_ppt_key_samples" ? "ppt_key_samples" : "ppt_sample_assets",
      artifactDraft: {
        nodeKey: "image_prompts" as const, kind: "image_prompts" as const, title: "课件资产",
        summary: "已完成当前课件资产步骤。", markdownContent: "# 课件资产",
        structuredContent: { toolName: input.toolName },
      },
      assistantSummary: "已完成当前课件资产步骤。",
      budgetEvent: buildAgentHarnessBudgetEvent({
        capabilityId: input.toolName === "assemble_ppt_key_samples" ? "ppt_key_samples" : "ppt_sample_assets",
        actionKey: input.toolName,
        status: "succeeded",
        kind: "tool_succeeded",
      }),
    }));

    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); }, businessToolRouter,
        taskBrief, intentGrant: {
          schemaVersion: "intent-grant.v1", taskId: "task-1", projectId: project.id, intentEpoch: project.intentEpoch ?? 0,
          standardWorkAuthorized: true, intensity: "standard", budgetPolicyVersion: "v1-standard", maxCostCredits: null,
          maxExternalProviderCalls: 1, requiredCheckpoints: [], expiresAt: null,
        },
      });

      await expect(config!.dispatch({ callId: "package", toolName: "assemble_ppt_key_samples", arguments: {} }))
        .resolves.toMatchObject({ status: "succeeded" });
      await expect(config!.dispatch({ callId: "external-1", toolName: "generate_ppt_sample_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "succeeded" });
      await expect(config!.dispatch({ callId: "external-2", toolName: "generate_ppt_sample_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "blocked", observation: { reasonCodes: ["budget_upgrade"], nextAction: "ask_teacher" } });
      expect(businessToolRouter).toHaveBeenCalledTimes(2);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists the same-action failure budget across outer Replan loop reconstruction", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-9R17-cycle-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "继续修正课件样张。" });
    const artifacts = await createApprovedPptToolPrerequisites(service, project.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn(async () => ({
      status: "failed" as const,
      toolId: "assemble_ppt_key_samples",
      capabilityId: "ppt_key_samples",
      observation: createToolObservation({
        projectId: project.id,
        sourceMessageId: message.id,
        capabilityId: "ppt_key_samples",
        expectedArtifactKind: "image_prompts",
        kind: "quality_gate_failed",
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
      validationReport: {
        reportId: "report-cycle",
        reportDigest: "a".repeat(64),
        authority: "deterministic" as const,
        domain: "ppt" as const,
        stage: "ppt_key_samples",
        target: { kind: "tool_execution" as const },
        contract: { id: "tool:assemble_ppt_key_samples", version: "v1" },
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
      },
    }));
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const,
      taskId: "task-cycle",
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
    try {
      const firstConfig = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence, executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter, intentGrant, taskBrief,
      });
      await expect(firstConfig!.dispatch({ callId: "failure-1", toolName: "assemble_ppt_key_samples", arguments: { revision: 1 } }))
        .resolves.toMatchObject({ status: "failed", observation: { reasonCodes: expect.arrayContaining(["sample_high_risk_page_missing"]) } });
      await expect(firstConfig!.dispatch({ callId: "failure-2", toolName: "assemble_ppt_key_samples", arguments: { revision: 2 } }))
        .resolves.toMatchObject({ status: "failed" });

      const refreshedMessage = (await service.getMessages(project.id)).find((item) => item.id === message.id)!;
      const rebuiltConfig = createMainAgentToolLoopOptions({
        service, project, triggerMessage: refreshedMessage, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence, executor: async () => { throw new Error("agent executor must not be called"); },
        businessToolRouter, intentGrant, taskBrief,
      });
      await expect(rebuiltConfig!.dispatch({ callId: "failure-3", toolName: "assemble_ppt_key_samples", arguments: { revision: 3 } }))
        .resolves.toMatchObject({ status: "blocked", observation: { reasonCodes: expect.arrayContaining(["repeated_tool_failure", "retry_budget_exhausted"]), nextAction: "pause" } });

      expect(businessToolRouter).toHaveBeenCalledTimes(2);
      const messages = await service.getMessages(project.id);
      expect(readAgentObservationsFromMessages(messages).at(-1)?.reasonCodes)
        .toContain("sample_high_risk_page_missing");
      expect(readLatestRunCheckpointFromMessages(messages)).toMatchObject({
        projectId: project.id,
        reason: "repeated_failure",
        actionKey: "assemble_ppt_key_samples",
        status: "paused",
      });
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
          requestedOutputs: ["lesson_plan", "ppt", "intro_video", "final_package"],
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
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [outline],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
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
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        executor: async () => { throw new Error("agent executor must not be called"); }, businessToolRouter,
        intentGrant: {
          schemaVersion: "intent-grant.v1", taskId: "task-1", projectId: project.id, intentEpoch: (project.intentEpoch ?? 0) + 1,
          standardWorkAuthorized: true, intensity: "standard", budgetPolicyVersion: "v1-standard", maxCostCredits: 10, maxExternalProviderCalls: null,
          requiredCheckpoints: [], expiresAt: null,
        },
      });
      await expect(config!.dispatch({ callId: "scope-mismatch", toolName: "assemble_ppt_key_samples", arguments: {} }))
        .resolves.toMatchObject({ status: "blocked", observation: { reasonCodes: ["grant_scope_mismatch"], nextAction: "ask_teacher" } });
      expect(businessToolRouter).not.toHaveBeenCalled();
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

    try {
      const artifacts = [concept];
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence, executor,
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
});

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

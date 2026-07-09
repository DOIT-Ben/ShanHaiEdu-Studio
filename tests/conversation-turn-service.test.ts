import { describe, expect, it } from "vitest";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { buildAgentHarnessBudgetEvent, readAgentHarnessBudgetEventsFromMessages } from "@/server/conversation/agent-harness-budget";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import type { CapabilityId } from "@/server/capabilities/types";
import { readActiveToolObservationsFromMessages } from "@/server/capabilities/tool-observation";
import { createWorkbenchService } from "@/server/workbench/service";

const fullDeliveryCapabilityIds = [
  "requirement_spec",
  "lesson_plan",
  "ppt_outline",
  "ppt_design",
  "coze_ppt",
  "image_asset",
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "asset_image_generate",
  "video_segment_plan",
  "video_segment_generate",
  "concat_only_assemble",
  "final_package",
];

const firstStepStatuses = ["succeeded", "awaiting_confirmation", ...Array(fullDeliveryCapabilityIds.length - 2).fill("pending")];

describe("M54-B3 ConversationTurnService route contract", () => {
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

  it("blocks tool execution when capability availability says upstream inputs are not approved", async () => {
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

    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond() {
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

    expect(body.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
      artifactRefs: [],
    });
    expect(body.assistantMessage?.content).toBe("请先确认前置成果后再继续。");
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
  });

  it("uses agent harness budget events to stop repeated failed actions before creating artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M63 budget 项目", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
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

    expect(body.agentTurn).toMatchObject({ state: "failed_blocked", shouldRunToolNow: false, artifactRefs: [] });
    expect(body.assistantMessage?.content).toMatch(/多次|没有完成|核对/);
    expect(body.assistantMessage?.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|capabilityId|runtimeKind|token|C:\\/i);
    expect(body.artifact).toBeUndefined();
    expect(await service.getArtifacts(project.id)).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: "requirement_spec",
        actionKey: "requirement_spec:requirement_spec",
        status: "blocked",
        kind: "retry_exhausted",
      }),
    ]));
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
      expect.objectContaining({ capabilityId: "requirement_spec", kind: "tool_failed", artifactCreated: false }),
    ]));
    expect(readAgentHarnessBudgetEventsFromMessages(messages)).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "requirement_spec", status: "retryable_failed", kind: "tool_failed" }),
    ]));
  });

  it("records PlanGuard blocks as policy observations for the next turn", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M63 plan guard observation 项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const body = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });
    const observations = readActiveToolObservationsFromMessages(await service.getMessages(projectId));

    expect(body.agentTurn).toMatchObject({ state: "collecting_inputs", shouldRunToolNow: false, artifactRefs: [] });
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "requirement_spec", kind: "blocked_by_policy", artifactCreated: false }),
    ]));
    expect(readAgentHarnessBudgetEventsFromMessages(await service.getMessages(projectId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ capabilityId: "requirement_spec", status: "blocked", kind: "blocked_by_policy" }),
    ]));
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

      expect(body.agentTurn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false, artifactRefs: [] });
      expect(body.artifact).toBeUndefined();
      expect(await service.getArtifacts(project.id)).toHaveLength(1);
      expect(readActiveToolObservationsFromMessages(messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "coze_ppt", kind: "quality_gate_failed", artifactCreated: false }),
      ]));
      expect(readAgentHarnessBudgetEventsFromMessages(messages)).toEqual(expect.arrayContaining([
        expect.objectContaining({ capabilityId: "coze_ppt", status: "retryable_failed", kind: "quality_gate_failed" }),
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

      expect(body.agentTurn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false, artifactRefs: [] });
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
      assistantMessage: { role: "assistant", content: expect.stringContaining("我在") },
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

  it("plans a PPT workflow first, then confirmation creates a requirement artifact through the turn service", async () => {
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
        capabilityId: "requirement_spec",
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
      shouldRunToolNow: true,
    });
    expect(confirmBody.artifact).toMatchObject({
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      status: "needs_review",
      structuredContent: {
        capabilityId: "requirement_spec",
        providerStatus: "deterministic_draft",
      },
    });
    expect(confirmBody.agentTurn!.artifactRefs).toEqual([confirmBody.artifact!.id]);
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
      shouldRunToolNow: true,
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec", status: "needs_review" });

    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);
    expect(pendingDeliveryPlanOf(assistantPlanMessage).status).toBe("confirmed");
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
      `human:${projectId}:requirement_spec:${planningBody.assistantMessage?.id}`,
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

  it("does not execute a pending plan when the current teacher message has no confirmed actionId", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 当前确认缺失项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const confirmBody = await turnService.createTurn(projectId, { role: "teacher", content: "确认开始" });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toBeUndefined();
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
      shouldRunToolNow: true,
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec", status: "needs_review" });

    const messages = await service.getMessages(projectId);
    const assistantPlanMessage = messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);
    expect(pendingDeliveryPlanOf(assistantPlanMessage)).toMatchObject({ status: "confirmed", actionId });
  });

  it("executeQueuedTurn blocks a pending plan when the teacher message metadata has no confirmedActionId", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "MVP1 队列确认缺失项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const queuedTeacherMessage = await service.addMessage(projectId, { role: "teacher", content: "确认开始" });

    const confirmBody = await turnService.executeQueuedTurn(projectId, { teacherMessageId: queuedTeacherMessage.id });

    expect(confirmBody.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(confirmBody.artifact).toBeUndefined();
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

  it("keeps the delivery plan pending after confirming the first step", async () => {
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
      deliveryPlan: {
        currentStepId: "lesson_plan",
      },
    });
    expect(confirmBody.agentTurn!.deliveryPlan!.steps.map((step: { status: string }) => step.status)).toEqual(firstStepStatuses);
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });
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
      deliveryPlan: {
        currentStepId: "lesson_plan",
      },
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });

    const messagesBody = { messages: await service.getMessages(projectId) };
    const assistantPlanMessage = messagesBody.messages.find((message: { id: string }) => message.id === planningBody.assistantMessage?.id);

    expect(pendingDeliveryPlanOf(assistantPlanMessage).status).toBe("confirmed");

    const latestAssistantMessage = messagesBody.messages.at(-1);
    expect(latestAssistantMessage!.metadata).toMatchObject({
      pendingDeliveryPlan: {
        status: "pending",
        toolPlan: { capabilityId: "lesson_plan" },
        deliveryPlan: { currentStepId: "lesson_plan" },
      },
    });
  });

  it("continues through the full delivery plan by calling each registered capability", async () => {
    const { service, turnService, projectId } = await createServiceProject({
      title: "M55-B 全链路项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await turnService.createTurn(projectId, { role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" });

    const internalSteps = [
      { content: "确认开始", capabilityId: "requirement_spec", nodeKey: "requirement_spec", nextCapabilityId: "lesson_plan" },
      { content: "继续下一步", capabilityId: "lesson_plan", nodeKey: "lesson_plan", nextCapabilityId: "ppt_outline" },
      { content: "继续下一步", capabilityId: "ppt_outline", nodeKey: "ppt_draft", nextCapabilityId: "ppt_design" },
      { content: "继续下一步", capabilityId: "ppt_design", nodeKey: "ppt_design_draft", nextCapabilityId: "coze_ppt" },
    ];

    for (const step of internalSteps) {
      const body = await turnService.createTurn(projectId, {
        role: "teacher",
        content: step.content,
        confirmedActionId: await getLatestPendingActionId(service, projectId),
      });

      expect(body.agentTurn).toMatchObject({
        state: "succeeded",
        shouldRunToolNow: true,
      });
      expect(body.artifact).toMatchObject({
        nodeKey: step.nodeKey,
        status: "needs_review",
        structuredContent: {
          capabilityId: step.capabilityId,
          providerStatus: "deterministic_draft",
        },
      });
      expect(body.assistantMessage!.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|API/i);
      expect(body.agentTurn!.deliveryPlan!.currentStepId).toBe(step.nextCapabilityId);
      expect(body.agentTurn!.quickReplies).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: "继续下一步", prompt: "继续下一步" })]),
      );
      expect(body.assistantMessage!.metadata).toMatchObject({
        pendingDeliveryPlan: {
          status: "pending",
          toolPlan: { capabilityId: step.nextCapabilityId },
          deliveryPlan: { currentStepId: step.nextCapabilityId },
        },
      });

      await service.approveArtifact(projectId, body.artifact!.id);
    }

    const externalBody = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "继续下一步",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(externalBody.agentTurn).toMatchObject({
      state: "failed_blocked",
      shouldRunToolNow: false,
    });
    expect(externalBody.artifact).toBeUndefined();
    expect(externalBody.assistantMessage!.content).toMatch(/暂时不可用/);
    expect(externalBody.assistantMessage!.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|API|placeholder/i);

    const artifactsAfterExternalAttempt = await service.getArtifacts(projectId);
    const latestPptDesign = artifactsAfterExternalAttempt.find((artifact) => artifact.nodeKey === "ppt_design_draft");
    expect(latestPptDesign).toMatchObject({ status: "approved", isApproved: true });

    const messagesBody = { messages: await service.getMessages(projectId) };
    const artifactRefs = messagesBody.messages.flatMap((message: { artifactRefs: string[] }) => message.artifactRefs);

    expect(artifactRefs).toHaveLength(4);
  });
});

async function createServiceProject(input: Record<string, unknown> = {}) {
  const service = createWorkbenchService();
  const project = await service.createProject({ title: "测试项目", ...input });
  const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime() });

  return { service, turnService, projectId: project.id };
}

async function getLatestPendingActionId(service: ReturnType<typeof createWorkbenchService>, projectId: string) {
  const messages = await service.getMessages(projectId);
  const pendingMessage = [...messages].reverse().find((message) => pendingDeliveryPlanOf(message).status === "pending");
  return String(pendingDeliveryPlanOf(pendingMessage).actionId ?? "");
}

async function seedPendingPlan(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
  capabilityId: CapabilityId,
  expectedArtifactKind: string,
) {
  const assistantMessage = await service.addMessage(projectId, {
    role: "assistant",
    content: "请确认是否执行这一步。",
    metadata: {
      pendingDeliveryPlan: {
        status: "pending",
        teacherRequest: "测试请求",
        toolPlan: buildAgentToolTurn(capabilityId, expectedArtifactKind).toolPlan,
        runtimeKind: "deterministic",
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
  return (message?.metadata.pendingDeliveryPlan ?? {}) as { status?: string; actionId?: string; teacherRequest?: string };
}

function buildAgentToolTurn(capabilityId: CapabilityId, expectedArtifactKind: string) {
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
      inputDraft: {},
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

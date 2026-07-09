import { describe, expect, it } from "vitest";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
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
    }

    const externalBody = await turnService.createTurn(projectId, {
      role: "teacher",
      content: "继续下一步",
      confirmedActionId: await getLatestPendingActionId(service, projectId),
    });

    expect(externalBody.agentTurn).toMatchObject({
      state: "failed_retryable",
      shouldRunToolNow: true,
    });
    expect(externalBody.artifact).toBeUndefined();
    expect(externalBody.assistantMessage!.content).toMatch(/需要先生成 PPT 设计稿/);
    expect(externalBody.assistantMessage!.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|API|placeholder/i);

    const artifactsAfterExternalAttempt = await service.getArtifacts(projectId);
    const latestPptDesign = artifactsAfterExternalAttempt.find((artifact) => artifact.nodeKey === "ppt_design_draft");
    expect(latestPptDesign).toMatchObject({ status: "needs_review", isApproved: false });

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

function pendingDeliveryPlanOf(message?: { metadata: Record<string, unknown> }) {
  return (message?.metadata.pendingDeliveryPlan ?? {}) as { status?: string; actionId?: string; teacherRequest?: string };
}

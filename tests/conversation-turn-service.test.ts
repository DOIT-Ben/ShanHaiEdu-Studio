import { describe, expect, it } from "vitest";
import { GET as getMessageRoute, POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";

describe("M54-B3 ConversationTurnService route contract", () => {
  it("returns a main-agent turn for casual chat without creating artifacts", async () => {
    const projectId = await createProject();

    const response = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "你好" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      message: { role: "teacher", content: "你好" },
      assistantMessage: { role: "assistant", content: expect.stringContaining("我在") },
      agentTurn: {
        state: "chatting",
        shouldRunToolNow: false,
      },
    });
    expect(body.agentTurn.toolPlan).toBeUndefined();
    expect(body.artifact).toBeUndefined();
  });

  it("does not run a tool when the teacher confirms without a pending plan", async () => {
    const projectId = await createProject();

    const response = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "确认开始" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(body.agentTurn.toolPlan).toBeUndefined();
    expect(body.artifact).toBeUndefined();
  });

  it("does not treat casual chat as a pending generation plan", async () => {
    const projectId = await createProject();

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "你好" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const response = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "确认开始" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const body = await response.json();

    expect(body.agentTurn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
    });
    expect(body.artifact).toBeUndefined();
  });

  it("plans a PPT workflow first, then confirmation creates a requirement artifact through the turn service", async () => {
    const projectId = await createProject({
      title: "M54-B3 接线项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "帮我做五年级数学百分数 PPT" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const planningBody = await planningResponse.json();

    expect(planningBody.agentTurn).toMatchObject({
      state: "awaiting_confirmation",
      toolPlan: {
        capabilityId: "requirement_spec",
        requiresConfirmation: true,
      },
      shouldRunToolNow: false,
    });
    expect(planningBody.artifact).toBeUndefined();
    expect(planningBody.assistantMessage.content).not.toMatch(/schema|provider|node_id|debug|local path/i);

    const confirmResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "确认开始" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const confirmBody = await confirmResponse.json();

    expect(confirmResponse.status).toBe(201);
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
    expect(confirmBody.agentTurn.artifactRefs).toEqual([confirmBody.artifact.id]);
  });

  it("lets the main agent confirm a pending plan from a short start reply", async () => {
    const projectId = await createProject({
      title: "M55-C 短确认项目",
      grade: "四年级",
      subject: "语文",
      lessonTopic: "观潮",
    });

    const planningResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "四年级语文《观潮》第一课时，帮我先整理备课需求" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const planningBody = await planningResponse.json();

    expect(planningBody.agentTurn).toMatchObject({
      state: "awaiting_confirmation",
      toolPlan: { capabilityId: "requirement_spec", requiresConfirmation: true },
    });

    const confirmResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "开始。" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const confirmBody = await confirmResponse.json();

    expect(confirmResponse.status).toBe(201);
    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      shouldRunToolNow: true,
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec", status: "needs_review" });

    const messagesResponse = await getMessageRoute(new Request("http://localhost", { method: "GET" }), { params: Promise.resolve({ projectId }) });
    const messagesBody = await messagesResponse.json();
    const assistantPlanMessage = messagesBody.messages.find((message: { id: string }) => message.id === planningBody.assistantMessage.id);
    expect(assistantPlanMessage.metadata.pendingDeliveryPlan.status).toBe("confirmed");
  });

  it("returns a delivery plan for complete material package requests before confirmation", async () => {
    const projectId = await createProject({
      title: "M55-A 完整材料包项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const response = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.agentTurn).toMatchObject({
      state: "awaiting_confirmation",
      shouldRunToolNow: false,
      deliveryPlan: {
        title: "公开课完整交付计划",
        currentStepId: "requirement_spec",
      },
    });
    expect(body.agentTurn.deliveryPlan.steps.map((step: { capabilityId: string }) => step.capabilityId)).toEqual([
      "requirement_spec",
      "lesson_plan",
      "ppt_outline",
      "ppt_design",
      "coze_ppt",
      "image_asset",
      "intro_video",
      "final_package",
    ]);
    expect(body.artifact).toBeUndefined();
    expect(JSON.stringify(body.agentTurn.deliveryPlan)).not.toMatch(/schema|provider|node_id|storage|debug|local path/i);
  });

  it("keeps the delivery plan pending after confirming the first step", async () => {
    const projectId = await createProject({
      title: "M55-A 确认项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const confirmResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "确认开始，按这个计划推进。" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const confirmBody = await confirmResponse.json();

    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      deliveryPlan: {
        currentStepId: "lesson_plan",
      },
    });
    expect(confirmBody.agentTurn.deliveryPlan.steps.map((step: { status: string }) => step.status)).toEqual([
      "succeeded",
      "awaiting_confirmation",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });
  });

  it("persists the pending delivery plan on the assistant planning message", async () => {
    const projectId = await createProject({
      title: "M55-A 计划持久化项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const planningBody = await planningResponse.json();

    expect(planningBody.assistantMessage.metadata).toMatchObject({
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

    const messagesResponse = await getMessageRoute(
      new Request("http://localhost", {
        method: "GET",
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const messagesBody = await messagesResponse.json();
    const assistantPlanMessage = messagesBody.messages.find((message: { id: string }) => message.id === planningBody.assistantMessage.id);

    expect(assistantPlanMessage.metadata).toMatchObject({
      pendingDeliveryPlan: {
        status: "pending",
        teacherRequest: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      },
    });
  });

  it("confirms the persisted pending plan even when casual chat is inserted before confirmation", async () => {
    const projectId = await createProject({
      title: "M55-A 绑定确认项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    const planningResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const planningBody = await planningResponse.json();

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "先等一下，我问个无关问题：今天适合怎样开场？" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const confirmResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "确认开始" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const confirmBody = await confirmResponse.json();

    expect(confirmBody.agentTurn).toMatchObject({
      state: "succeeded",
      deliveryPlan: {
        currentStepId: "lesson_plan",
      },
    });
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });

    const messagesResponse = await getMessageRoute(
      new Request("http://localhost", {
        method: "GET",
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const messagesBody = await messagesResponse.json();
    const assistantPlanMessage = messagesBody.messages.find((message: { id: string }) => message.id === planningBody.assistantMessage.id);

    expect(assistantPlanMessage.metadata.pendingDeliveryPlan.status).toBe("confirmed");

    const latestAssistantMessage = messagesBody.messages.at(-1);
    expect(latestAssistantMessage.metadata).toMatchObject({
      pendingDeliveryPlan: {
        status: "pending",
        toolPlan: { capabilityId: "lesson_plan" },
        deliveryPlan: { currentStepId: "lesson_plan" },
      },
    });
  });

  it("continues through the full delivery plan by calling each registered capability", async () => {
    const projectId = await createProject({
      title: "M55-B 全链路项目",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );

    const internalSteps = [
      { content: "确认开始", capabilityId: "requirement_spec", nodeKey: "requirement_spec", nextCapabilityId: "lesson_plan" },
      { content: "继续下一步", capabilityId: "lesson_plan", nodeKey: "lesson_plan", nextCapabilityId: "ppt_outline" },
      { content: "继续下一步", capabilityId: "ppt_outline", nodeKey: "ppt_draft", nextCapabilityId: "ppt_design" },
      { content: "继续下一步", capabilityId: "ppt_design", nodeKey: "ppt_design_draft", nextCapabilityId: "coze_ppt" },
    ];

    for (const step of internalSteps) {
      const response = await postMessageRoute(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ role: "teacher", content: step.content }),
        }),
        { params: Promise.resolve({ projectId }) },
      );
      const body = await response.json();

      expect(response.status).toBe(201);
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
      expect(body.assistantMessage.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|API/i);
      expect(body.agentTurn.deliveryPlan.currentStepId).toBe(step.nextCapabilityId);
      expect(body.agentTurn.quickReplies).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: "继续下一步", prompt: "继续下一步" })]),
      );
      expect(body.assistantMessage.metadata).toMatchObject({
        pendingDeliveryPlan: {
          status: "pending",
          toolPlan: { capabilityId: step.nextCapabilityId },
          deliveryPlan: { currentStepId: step.nextCapabilityId },
        },
      });
    }

    const externalResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "继续下一步" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const externalBody = await externalResponse.json();

    expect(externalResponse.status).toBe(201);
    expect(externalBody.agentTurn).toMatchObject({
      state: "failed_retryable",
      shouldRunToolNow: true,
    });
    expect(externalBody.artifact).toBeUndefined();
    expect(externalBody.assistantMessage.content).toMatch(/没有保存占位成果|需要先生成/);
    expect(externalBody.assistantMessage.content).not.toMatch(/schema|provider|node_id|storage|debug|local path|API|placeholder/i);

    const messagesResponse = await getMessageRoute(
      new Request("http://localhost", {
        method: "GET",
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const messagesBody = await messagesResponse.json();
    const artifactRefs = messagesBody.messages.flatMap((message: { artifactRefs: string[] }) => message.artifactRefs);

    expect(artifactRefs).toHaveLength(4);
  });
});

async function createProject(input: Record<string, unknown> = {}) {
  const response = await postProjectRoute(
    new Request("http://localhost/api/workbench/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  const body = await response.json();
  return body.project.id as string;
}

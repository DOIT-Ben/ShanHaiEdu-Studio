import { describe, expect, it } from "vitest";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
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
        currentStepId: "requirement_spec",
      },
    });
    expect(confirmBody.agentTurn.deliveryPlan.steps.map((step: { status: string }) => step.status)).toEqual([
      "succeeded",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(confirmBody.artifact).toMatchObject({ nodeKey: "requirement_spec" });
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

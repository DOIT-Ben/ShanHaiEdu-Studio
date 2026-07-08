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

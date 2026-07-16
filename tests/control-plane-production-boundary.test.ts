import { describe, expect, it, vi } from "vitest";

import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import { createTaskBrief } from "@/server/conversation/task-contract";
import { createWorkbenchService } from "@/server/workbench/service";

describe("production control-plane boundaries", () => {
  it("persists a pending-task pause before the Main Agent and never dispatches the paused turn", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "控制先提交",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const originalBrief = createTaskBrief({
      taskId: `task-original-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: "制作百分数公开课PPT",
      requestedOutputs: ["ppt"],
      constraints: ["约10页"],
      excludedOutputs: ["video"],
      generationIntensity: "standard",
      sourceMessageId: "source-original",
    });
    await service.addMessage(project.id, {
      role: "teacher",
      content: originalBrief.goal,
      metadata: { taskBrief: originalBrief },
    });
    await service.addMessage(project.id, {
      role: "assistant",
      content: "已形成待执行计划。",
      metadata: {
        pendingDeliveryPlan: {
          status: "pending",
          teacherRequest: originalBrief.goal,
          toolPlan: {
            planId: "plan-original",
            capabilityId: "ppt_outline",
            expectedArtifactKind: "ppt_draft",
            inputDraft: {},
            requiresConfirmation: false,
            internalReason: "test pending plan",
          },
          runtimeKind: "openai",
          actionId: "human:test-pending-plan",
          taskBrief: originalBrief,
        },
      },
    });
    const respond = vi.fn(async () => idleTurn());
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: { respond },
      enableTaskGrantAutonomy: true,
    });

    await turnService.createTurn(project.id, { role: "teacher", content: "暂停，稍后再继续" });

    expect(respond).not.toHaveBeenCalled();
    expect((await service.getProject(project.id)).intentEpoch).toBe(0);
    const latestTeacher = (await service.getMessages(project.id)).filter((message) => message.role === "teacher").at(-1);
    expect(latestTeacher?.metadata).toMatchObject({
      conversationControlImpact: { decisionKind: "pause", nextIntentEpoch: 0 },
    });
    const pendingMessage = (await service.getMessages(project.id)).find((message) => message.content === "已形成待执行计划。");
    expect(pendingMessage?.metadata).toMatchObject({ pendingDeliveryPlan: { status: "paused" } });
  });

  it("forms a verified structured TaskBrief for an explicit deliverable without legacy product keywords", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "结构化任务提案",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    let captured: MainConversationAgentInput | undefined;
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent: {
        async respond(input) {
          captured = input;
          return idleTurn();
        },
      },
      enableTaskGrantAutonomy: true,
    });

    await turnService.createTurn(project.id, {
      role: "teacher",
      content: "把已有资料整理成一套明天可以直接使用的完整备课成果，保留原有情境。",
    });

    expect(captured?.taskBrief).toMatchObject({
      goal: expect.stringContaining("明天可以直接使用"),
      requestedOutputs: ["requirement_spec"],
      constraints: expect.arrayContaining(["五年级", "数学", "百分数"]),
    });
    expect(captured?.intentGrant).toMatchObject({ standardWorkAuthorized: true });
  });
});

function idleTurn() {
  return {
    assistantMessage: { body: "已记录。" },
    state: "chatting" as const,
    quickReplies: [],
    recommendedOptions: [],
    shouldRunToolNow: false,
    runtimeKind: "openai" as const,
  };
}

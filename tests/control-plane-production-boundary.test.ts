import { describe, expect, it, vi } from "vitest";

import { FixtureAgentRuntime } from "./helpers/fixture-agent-runtime";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

describe("production control-plane boundaries", () => {
  it("does not expose the retired staged generation promotion path", () => {
    const repository = createPrismaWorkbenchRepository();
    const service = createWorkbenchService(repository);

    for (const retiredMethod of [
      "getStagedGenerationResult",
      "stageGenerationResult",
      "promoteStagedGenerationResult",
      "commitGenerationResult",
      "resumeStagedGenerationResult",
      "regenerateArtifact",
    ]) {
      expect(repository).not.toHaveProperty(retiredMethod);
      expect(service).not.toHaveProperty(retiredMethod);
    }
  });

  it("keeps natural conversation outside the business Tool loop", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "自然讨论不调用 Tool",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const respond = vi.fn();
    const intakeTask = vi.fn(async () => ({
      kind: "conversation" as const,
      turn: idleTurn("视频方向还没有确定，我们可以先比较两种方案。"),
    }));
    const turnService = createConversationTurnService({
      service,
      runtime: new FixtureAgentRuntime(),
      agent: { intakeTask, respond },
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "是否改成视频我还没有决定，先聊聊区别。",
    });

    expect(intakeTask).toHaveBeenCalledOnce();
    expect(respond).not.toHaveBeenCalled();
    expect((await service.getProject(project.id)).intentEpoch).toBe(0);
    expect(result.agentTurn).toMatchObject({ state: "chatting", runtimeKind: "openai" });
    expect(await service.getArtifacts(project.id)).toEqual([]);
    const latestTeacher = (await service.getMessages(project.id)).filter((message) => message.role === "teacher").at(-1)!;
    expect(latestTeacher.metadata.taskBrief).toBeUndefined();
  });

  it("forms a structured TaskBrief and gives only the Main Agent a native Tool loop", async () => {
    const actor = createWorkbenchActor({
      userId: `control-boundary-${crypto.randomUUID()}`,
      displayName: "Control boundary teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "结构化任务提案",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const holderId = `control-boundary-worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    let captured: MainConversationAgentInput | undefined;
    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new FixtureAgentRuntime(),
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        agent: {
          async intakeTask(input) {
            return {
              kind: "task",
              proposal: {
                goal: input.userMessage,
                requestedOutputs: ["requirement_spec"],
                constraints: ["五年级", "数学", "百分数"],
                excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
              },
            };
          },
          async respond(input) {
            captured = input;
            return idleTurn("需求范围已经保存。", "succeeded");
          },
        },
      });

      await turnService.createTurn(project.id, {
        role: "teacher",
        content: "只做需求规格，不要教案、PPT、图片、视频或整包。",
      });

      expect(captured?.taskBrief).toMatchObject({
        goal: expect.stringContaining("只做需求规格"),
        requestedOutputs: ["requirement_spec"],
        excludedOutputs: ["image", "lesson_plan", "package", "ppt", "video"],
      });
      expect(captured?.intentGrant).toMatchObject({ standardWorkAuthorized: true });
      expect(captured?.agentToolLoop?.allowedToolNames).toEqual(expect.arrayContaining([
        "create_requirement_spec",
        "request_teacher_decision",
      ]));
      expect(await service.getArtifacts(project.id)).toEqual([]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});

function idleTurn(body: string, state: "chatting" | "succeeded" = "chatting") {
  return {
    assistantMessage: { body },
    state,
    quickReplies: [],
    recommendedOptions: [],
    runtimeKind: "openai" as const,
  };
}

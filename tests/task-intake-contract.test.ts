import { describe, expect, it, vi } from "vitest";

import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import { createTaskBriefFromProposal } from "@/server/conversation/task-intake";
import { createWorkbenchService } from "@/server/workbench/service";

describe("task intake contract", () => {
  it("creates a complete TaskBrief for explicit deliverables without relying on legacy keywords", () => {
    const brief = createTaskBriefFromProposal({
      proposal: {
        goal: "把已有百分数材料整理成一套明天可以直接使用的完整备课成果",
        requestedOutputs: ["requirement_spec", "lesson_plan", "ppt_outline"],
        constraints: ["五年级数学", "约10页", "保留投篮命中率情境"],
        excludedOutputs: ["video", "package"],
      },
      projectId: "project-1",
      taskId: "task-1",
      intentEpoch: 3,
      sourceMessageId: "message-1",
      generationIntensity: "standard",
    });

    expect(brief.requestedOutputs).toEqual(["lesson_plan", "ppt_outline", "requirement_spec"]);
    expect(brief.constraints).toContain("约10页");
    expect(brief.excludedOutputs).toEqual(["package", "video"]);
  });

  it("uses the Main Agent structured intake proposal as the production TaskBrief scope authority", async () => {
    const actor = createWorkbenchActor({
      userId: `task-intake-${crypto.randomUUID()}`,
      displayName: "Task intake teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "结构化任务入口",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const holderId = `task-intake-worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const intakeTask = vi.fn(async () => ({
      kind: "task" as const,
      proposal: {
        goal: "明天试讲交付",
        requestedOutputs: ["ppt"],
        constraints: ["约10页", "保留投篮命中率情境"],
        excludedOutputs: ["video"],
      },
    }));
    const respond = vi.fn(async (input: { taskBrief?: { requestedOutputs: string[] } }) => {
      expect(input.taskBrief?.requestedOutputs).toEqual(["ppt"]);
      return {
        assistantMessage: { body: "任务范围已经按结构化提案保存。" },
        state: "chatting" as const,
        quickReplies: [],
        recommendedOptions: [],
        shouldRunToolNow: false,
        runtimeKind: "openai" as const,
      };
    });

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent: { intakeTask, respond } as never,
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
      });

      await turnService.createTurn(project.id, {
        role: "teacher",
        content: "请把明天试讲要用的一整套东西准备齐，五年级数学百分数，约10页，保留投篮命中率情境，别给我视频。",
      });

      const teacherMessage = (await service.getMessages(project.id)).find((message) => message.role === "teacher")!;
      expect(intakeTask).toHaveBeenCalledOnce();
      expect(teacherMessage.metadata.taskBrief).toMatchObject({
        goal: expect.stringContaining("明天试讲"),
        requestedOutputs: ["ppt"],
        constraints: expect.arrayContaining(["约10页", "保留投篮命中率情境"]),
        excludedOutputs: ["video"],
      });
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("commits a no-pending-plan redirect before structured intake and never dispatches a business Tool", async () => {
    const actor = createWorkbenchActor({
      userId: `task-redirect-${crypto.randomUUID()}`,
      displayName: "Task redirect teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "无待定计划改道",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const holderId = `task-redirect-worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const intakeSnapshots: Array<{ intentEpoch: number; controlPersisted: boolean }> = [];
    const intakeTask = vi.fn(async () => {
      const currentProject = await service.getProject(project.id);
      const latestTeacher = (await service.getMessages(project.id)).filter((message) => message.role === "teacher").at(-1)!;
      intakeSnapshots.push({
        intentEpoch: currentProject.intentEpoch ?? 0,
        controlPersisted: (latestTeacher.metadata.conversationControlImpact as { persistedBeforeAgent?: unknown } | undefined)
          ?.persistedBeforeAgent === true,
      });
      return intakeSnapshots.length === 1
        ? {
            kind: "task" as const,
            proposal: {
              goal: "先做PPT",
              requestedOutputs: ["ppt"],
              constraints: ["五年级数学百分数"],
              excludedOutputs: ["video_script"],
            },
          }
        : {
            kind: "task" as const,
            proposal: {
              goal: "改为只做视频脚本",
              requestedOutputs: ["video_script"],
              constraints: ["独立创意短片", "唯一最小课程锚点"],
              excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
            },
          };
    });
    const respond = vi.fn(async () => ({
      assistantMessage: { body: "任务范围已保存。" },
      state: "chatting" as const,
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
      runtimeKind: "openai" as const,
    }));
    const toolRouter = vi.fn(async () => {
      throw new Error("business Tool must not run during redirect intake");
    });

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent: { intakeTask, respond } as never,
        toolRouter: toolRouter as never,
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
      });

      await turnService.createTurn(project.id, { role: "teacher", content: "先帮我准备一份百分数PPT。" });
      const redirect = await turnService.createTurn(project.id, { role: "teacher", content: "改道，只做视频脚本。" });
      const latestTeacher = (await service.getMessages(project.id)).filter((message) => message.role === "teacher").at(-1)!;

      expect(intakeSnapshots).toEqual([
        { intentEpoch: 0, controlPersisted: false },
        { intentEpoch: 1, controlPersisted: true },
      ]);
      expect(latestTeacher.metadata).toMatchObject({
        conversationControlImpact: {
          decisionKind: "redirect",
          previousIntentEpoch: 0,
          nextIntentEpoch: 1,
          persistedBeforeAgent: true,
        },
        taskBrief: {
          intentEpoch: 1,
          requestedOutputs: ["video_script"],
          excludedOutputs: ["image", "lesson_plan", "package", "ppt", "video"],
        },
      });
      expect(redirect.agentTurn?.shouldRunToolNow).toBe(false);
      expect(toolRouter).not.toHaveBeenCalled();
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});

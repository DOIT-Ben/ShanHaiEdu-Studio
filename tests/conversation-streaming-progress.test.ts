import { describe, expect, it } from "vitest";

import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { capabilityTeacherLabel, createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgent } from "@/server/conversation/main-conversation-agent";
import { createWorkbenchService } from "@/server/workbench/service";

describe("conversation streaming progress", () => {
  it("names Main Agent transport Tools with concrete teacher-facing business steps", () => {
    expect(capabilityTeacherLabel("create_requirement_spec")).toBe("整理备课需求");
    expect(capabilityTeacherLabel("create_lesson_plan")).toBe("生成公开课教案");
    expect(capabilityTeacherLabel("create_ppt_outline")).toBe("生成 PPT 大纲");
  });

  it("persists safe deltas and cache telemetry before committing one final assistant message", async () => {
    const actor = createWorkbenchActor({
      userId: `streaming-progress-${crypto.randomUUID()}`,
      displayName: "Streaming Progress Test",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor, {
      actorUserId: actor.userId,
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `streaming-progress-${crypto.randomUUID()}` });
    const agent: MainConversationAgent = {
      async intakeTask(input) {
        await input.onProgress?.({ type: "response_started" });
        await input.onProgress?.({ type: "text_delta", delta: "你好，" });
        await input.onProgress?.({ type: "text_delta", delta: "今天想准备哪节课？" });
        await input.onProgress?.({
          type: "response_completed",
          usage: { inputTokens: 1200, outputTokens: 16, totalTokens: 1216, cachedTokens: 1024, cacheWriteTokens: 128 },
          telemetry: {
            streamed: true,
            startedAt: "2026-07-16T00:00:00.000Z",
            firstEventAt: "2026-07-16T00:00:00.120Z",
            completedAt: "2026-07-16T00:00:00.900Z",
            timeToFirstEventMs: 120,
            durationMs: 900,
            chunkCount: 5,
            textBytes: 39,
          },
        });
        return {
          kind: "conversation",
          turn: {
            assistantMessage: { body: "你好，今天想准备哪节课？" },
            state: "chatting",
            quickReplies: [],
            recommendedOptions: [],
            shouldRunToolNow: false,
            runtimeKind: "openai",
          },
        };
      },
      async respond() {
        throw new Error("precomputed intake turn should be used");
      },
    };
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent,
      controlPlaneStore: createControlPlaneStore(),
    });

    await turnService.createTurn(project.id, { role: "teacher", content: "你好" });

    const [events, messages] = await Promise.all([
      createControlPlaneStore().listEvents(project.id),
      service.getMessages(project.id),
    ]);
    expect(events.filter((event) => event.kind === "text_delta").map((event) => event.payload.text).join(""))
      .toBe("你好，今天想准备哪节课？");
    expect(events.filter((event) => event.kind === "text_delta")).toHaveLength(1);
    expect(events.find((event) => event.kind === "activity_updated" && event.visibility === "internal"))
      .toMatchObject({
        payload: {
          usage: { cachedTokens: 1024, cacheWriteTokens: 128 },
          telemetry: { streamed: true, timeToFirstEventMs: 120, chunkCount: 5 },
        },
      });
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(JSON.stringify(events.filter((event) => event.visibility === "teacher"))).not.toContain("cachedTokens");
  });

  it("projects a committed TaskBrief as a concrete teacher-visible scope step", async () => {
    const actor = createWorkbenchActor({
      userId: `streaming-task-scope-${crypto.randomUUID()}`,
      displayName: "Streaming Task Scope Test",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor, {
      actorUserId: actor.userId,
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `streaming-task-scope-${crypto.randomUUID()}` });
    const agent: MainConversationAgent = {
      async intakeTask() {
        return {
          kind: "task",
          proposal: {
            goal: "为五年级数学百分数形成 PPT 结构候选，不生成 PPTX",
            requestedOutputs: ["ppt_outline"],
            constraints: ["五年级", "数学"],
            excludedOutputs: ["ppt"],
          },
        };
      },
      async respond() {
        return {
          assistantMessage: { body: "已按当前范围继续。" },
          state: "succeeded",
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai",
        };
      },
    };
    const controlPlaneStore = createControlPlaneStore();
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent,
      controlPlaneStore,
      enableTaskGrantAutonomy: true,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "为五年级数学百分数形成 PPT 结构候选，不生成 PPTX",
    });

    const events = await controlPlaneStore.listEvents(project.id);
    expect(events.find((event) => event.kind === "activity_updated" && event.visibility === "teacher"))
      .toMatchObject({
        payload: {
          label: "本轮目标已明确",
          status: "completed",
          purpose: "为五年级数学百分数形成 PPT 结构候选，不生成 PPTX",
          inputSummary: ["交付范围：PPT 结构候选", "明确不包含：可编辑 PPTX"],
          expectedOutput: "可继续审阅的PPT 结构候选",
        },
      });
    expect(result.assistantMessage?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "activity",
        activityKind: "task",
        label: "本轮目标已明确",
        status: "completed",
      }),
    ]));
  });

  it("persists settled Tool activities in the final assistant MessageParts when the continuation fails", async () => {
    const actor = createWorkbenchActor({
      userId: `streaming-terminal-${crypto.randomUUID()}`,
      displayName: "Streaming Terminal Test",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor, {
      actorUserId: actor.userId,
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `streaming-terminal-${crypto.randomUUID()}` });
    const agent: MainConversationAgent = {
      async intakeTask() {
        return {
          kind: "task",
          proposal: {
            goal: "制作七年级语文《春》课件",
            requestedOutputs: ["ppt"],
            constraints: ["七年级", "语文"],
            excludedOutputs: ["video"],
          },
        };
      },
      async respond(input) {
        await input.onProgress?.({ type: "step_started", toolName: "create_ppt_outline" });
        await input.onProgress?.({
          type: "step_observed",
          toolName: "create_ppt_outline",
          status: "succeeded",
          observationId: "observation-outline",
          reasonCodes: ["business_tool_succeeded"],
          summary: "PPT 大纲已生成，正在判断下一步",
        });
        return {
          assistantMessage: { body: "智能生成服务暂时不可用，当前进度已经保存。" },
          state: "failed_retryable",
          failure: {
            phase: "agent_tool_loop",
            reasonCode: "main_agent_provider_unavailable",
            category: "provider_unavailable",
            retryability: "after_provider_health_change",
            summary: "当前智能服务通道暂时不可用。",
          },
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai",
        };
      },
    };
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent,
      controlPlaneStore: createControlPlaneStore(),
      enableTaskGrantAutonomy: true,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "继续制作七年级语文《春》课件",
    });

    expect(result.assistantMessage?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "activity",
        activityId: expect.stringContaining(":tool:"),
        label: "PPT 大纲已生成，正在判断下一步",
        status: "succeeded",
        evidenceRefs: ["observation-outline"],
      }),
      expect.objectContaining({ type: "text", text: expect.stringContaining("当前进度已经保存") }),
      expect.objectContaining({ type: "tool-status", reasonCode: "main_agent_provider_unavailable" }),
    ]));
  });
});

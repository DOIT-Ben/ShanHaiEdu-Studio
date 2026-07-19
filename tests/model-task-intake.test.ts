import { describe, expect, it, vi } from "vitest";

import { OpenAIMainConversationAgent } from "@/server/conversation/model-main-conversation-agent";

describe("Main Agent task intake", () => {
  it("submits a task proposal through a dedicated function call while leaving conversation text natural", async () => {
    const create = vi.fn<
      (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
    >(async () => ({
      output_text: "",
      output: [{
        id: "task-brief-item",
        type: "function_call",
        call_id: "task-brief-call",
        name: "submit_task_brief",
        arguments: JSON.stringify({
          goal: "明天试讲交付",
          requestedOutputs: ["ppt"],
          constraints: ["五年级数学百分数", "约10页"],
          excludedOutputs: ["video"],
        }),
      }],
    }));
    const agent = new OpenAIMainConversationAgent({
      client: { responses: { create } } as never,
      model: "offline-task-intake-model",
      reasoningEffort: "medium",
    });
    const intakeTask = (agent as unknown as {
      intakeTask?: (input: unknown) => Promise<unknown>;
    }).intakeTask;

    expect(intakeTask).toBeTypeOf("function");
    const decision = await intakeTask!.call(agent, {
      userMessage: "请把明天试讲要用的一整套东西准备齐，五年级数学百分数，约10页，别给我视频。",
      responseStyle: "pragmatic",
      generationIntensity: "standard",
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      recentMessages: [],
    });

    expect(decision).toEqual({
      kind: "task",
      proposal: {
        goal: "请把明天试讲要用的一整套东西准备齐，五年级数学百分数，约10页，别给我视频。",
        requestedOutputs: ["ppt"],
        constraints: ["五年级数学百分数", "约10页"],
        excludedOutputs: ["video"],
      },
    });
    const payload = create.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("text");
    expect(payload).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [expect.objectContaining({ type: "function", name: "submit_task_brief", strict: true })],
    });
  });

  it("returns plain conversational text without a control function call", async () => {
    const create = vi.fn<
      (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
    >(async () => ({ output_text: "你好，我是小酷。今天想准备哪节课？", output: [] }));
    const agent = new OpenAIMainConversationAgent({
      client: { responses: { create } } as never,
      model: "offline-task-intake-model",
    });

    const decision = await agent.intakeTask!({
      userMessage: "你好",
      responseStyle: "pragmatic",
      generationIntensity: "standard",
      projectContext: {},
      recentMessages: [],
    });

    expect(decision).toMatchObject({
      kind: "conversation",
      turn: { assistantMessage: { body: "你好，我是小酷。今天想准备哪节课？" }, state: "chatting" },
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("text");
  });

  it("does not short-circuit a junior-high delivery request before task intake", async () => {
    const create = vi.fn<
      (payload: Record<string, unknown>) => Promise<Record<string, unknown>>
    >(async () => ({
      output_text: "",
      output: [{
        id: "task-brief-junior-high",
        type: "function_call",
        call_id: "task-brief-junior-high-call",
        name: "submit_task_brief",
        arguments: JSON.stringify({
          goal: "制作七年级语文《春》的课件",
          requestedOutputs: ["ppt"],
          constraints: ["七年级语文", "课题《春》"],
          excludedOutputs: [],
        }),
      }],
    }));
    const agent = new OpenAIMainConversationAgent({
      client: { responses: { create } } as never,
      model: "offline-task-intake-model",
    });

    const decision = await agent.intakeTask!({
      userMessage: "制作七年级语文《春》的课件",
      responseStyle: "pragmatic",
      generationIntensity: "standard",
      projectContext: {},
      recentMessages: [],
    });

    expect(create).toHaveBeenCalledOnce();
    expect(decision).toMatchObject({
      kind: "task",
      proposal: {
        goal: "制作七年级语文《春》的课件",
        requestedOutputs: ["ppt"],
        constraints: ["七年级语文", "课题《春》"],
      },
    });
  });
});

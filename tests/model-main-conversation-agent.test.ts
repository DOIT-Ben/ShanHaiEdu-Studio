import { describe, expect, it } from "vitest";
import { createMainConversationAgentFromEnv, OpenAIMainConversationAgent, resolveMainAgentTimeoutMs } from "@/server/conversation/model-main-conversation-agent";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";

describe("M55-C model-first main conversation agent", () => {
  it("passes arbitrary short teacher input to the model instead of blocking it with deterministic gates", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        body: "收到：三年级数学。我先和你确认一下课题，你想做哪个知识点？如果你愿意，我也可以推荐几个适合公开课的主题。",
      },
      state: "collecting_inputs",
      quickReplies: [
        { label: "推荐课题", prompt: "你推荐一个三年级数学公开课课题。", recommended: true },
        { label: "周长", prompt: "三年级数学周长，帮我做公开课完整材料包。" },
      ],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "三年级 数学", availableArtifactKinds: [] });

    expect(client.lastPayload?.input).toContain("三年级 数学");
    expect(turn).toMatchObject({
      state: "collecting_inputs",
      runtimeKind: "openai",
      shouldRunToolNow: false,
      assistantMessage: {
        body: expect.stringContaining("三年级数学"),
      },
    });
    expect(turn.toolPlan).toBeUndefined();
  });

  it("passes recent conversation and pending plan context to the model", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "收到，我会结合上一轮计划判断。" },
      state: "needs_input",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    await agent.respond({
      userMessage: "开始。",
      availableArtifactKinds: [],
      conversationContext: {
        latestAssistantContent: "开始整理《观潮》第一课时备课需求",
        recentMessages: [
          { role: "assistant", content: "开始整理《观潮》第一课时备课需求" },
          { role: "teacher", content: "开始。" },
        ],
        pendingDeliveryPlan: {
          teacherRequest: "四年级语文《观潮》第一课时",
          toolPlan: {
            planId: "requirement_spec:test",
            capabilityId: "requirement_spec",
            reasonForUser: "我可以先整理备课需求。",
            internalReason: "test",
            inputDraft: { teacherGoal: "四年级语文《观潮》第一课时" },
            missingInputs: [],
            upstreamPlan: [],
            nextSuggestedCapabilities: ["lesson_plan"],
            requiresConfirmation: true,
            expectedArtifactKind: "requirement_spec",
          },
        },
      },
    });

    expect(client.lastPayload?.input).toContain("pendingDeliveryPlan");
    expect(client.lastPayload?.input).toContain("开始整理《观潮》第一课时备课需求");
  });

  it("preserves all model quick replies without truncating them", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "我给你几个推进选项。" },
      state: "collecting_inputs",
      quickReplies: [
        { label: "一", prompt: "一" },
        { label: "二", prompt: "二" },
        { label: "三", prompt: "三" },
        { label: "四", prompt: "四" },
        { label: "五", prompt: "五" },
      ],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "给我几个选择", availableArtifactKinds: [] });

    expect(turn.quickReplies.map((reply) => reply.label)).toEqual(["一", "二", "三", "四", "五"]);
  });

  it("accepts a model-selected full delivery plan without pre-model keyword gates", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        title: "我理解你的任务",
        body: "我会先整理需求，再按计划推进教案、PPT、图片、导入视频和最终交付包。",
      },
      state: "awaiting_confirmation",
      quickReplies: [{ label: "确认开始", prompt: "确认开始，按这个计划推进。", recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "requirement_spec",
        reasonForUser: "我可以先为你整理备课需求。",
        missingInputs: [],
        nextSuggestedCapabilities: ["lesson_plan"],
        requiresConfirmation: true,
      },
      deliveryPlan: {
        mode: "full",
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "我要做一个三年级数学公开课，你自己判断怎么推进", availableArtifactKinds: [] });

    expect(turn.state).toBe("awaiting_confirmation");
    expect(turn.toolPlan).toMatchObject({ capabilityId: "requirement_spec", requiresConfirmation: true });
    expect(turn.deliveryPlan?.steps.map((step) => step.capabilityId)).toEqual([
      "requirement_spec",
      "lesson_plan",
      "ppt_outline",
      "ppt_design",
      "coze_ppt",
      "image_asset",
      "intro_video",
      "final_package",
    ]);
  });

  it("keeps the model-selected capability in full delivery plans instead of forcing a fixed first step", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        body: "我会按完整材料包推进。",
      },
      state: "awaiting_confirmation",
      quickReplies: [{ label: "确认开始", prompt: "确认开始，按这个计划推进。", recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "lesson_plan",
        reasonForUser: "我会按完整材料包推进。",
        missingInputs: [],
        nextSuggestedCapabilities: ["ppt_outline"],
        requiresConfirmation: true,
      },
      deliveryPlan: {
        mode: "full",
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "帮我做完整材料包", availableArtifactKinds: [] });

    expect(turn.toolPlan?.capabilityId).toBe("lesson_plan");
    expect(turn.deliveryPlan?.currentStepId).toBe("lesson_plan");
    expect(turn.deliveryPlan?.steps[0]).toMatchObject({ capabilityId: "requirement_spec", status: "pending" });
    expect(turn.deliveryPlan?.steps[1]).toMatchObject({ capabilityId: "lesson_plan", status: "awaiting_confirmation" });
  });

  it("does not silently fall back to deterministic routing when model config is missing outside tests", async () => {
    const agent = createMainConversationAgentFromEnv({ NODE_ENV: "development" });

    const turn = await agent.respond({ userMessage: "三年级 数学", availableArtifactKinds: [] });

    expect(turn).toMatchObject({
      state: "failed_retryable",
      runtimeKind: "openai",
      shouldRunToolNow: false,
    });
    expect(turn.assistantMessage.body).toContain("智能生成服务暂时不可用");
    expect(turn.assistantMessage.body).not.toMatch(/硬编码|主模型|模型通道|schema|provider|debug|local path/i);
  });

  it("continues an existing pending delivery plan even when model config is missing", async () => {
    const agent = createMainConversationAgentFromEnv({ NODE_ENV: "development" });

    const turn = await agent.respond({
      userMessage: "继续下一步",
      availableArtifactKinds: ["requirement_spec", "lesson_plan", "ppt_draft", "ppt_design_draft"],
      conversationContext: {
        recentMessages: [],
        pendingDeliveryPlan: {
          teacherRequest: "五年级数学《百分数的认识》",
          toolPlan: {
            planId: "coze_ppt:test",
            capabilityId: "coze_ppt",
            reasonForUser: "我会生成真实 PPTX 文件。",
            internalReason: "test",
            inputDraft: { teacherGoal: "五年级数学《百分数的认识》" },
            missingInputs: [],
            upstreamPlan: [],
            nextSuggestedCapabilities: ["image_asset"],
            requiresConfirmation: true,
            expectedArtifactKind: "pptx_artifact",
          },
        },
      },
    });

    expect(turn).toMatchObject({
      state: "running_tool",
      runtimeKind: "openai",
      shouldRunToolNow: true,
      toolPlan: { capabilityId: "coze_ppt" },
    });
  });

  it("uses a longer configurable timeout for model-first planning", () => {
    expect(resolveMainAgentTimeoutMs({})).toBe(60_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "1000" })).toBe(60_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "not-a-number" })).toBe(60_000);
  });
});

function fakeResponsesClient(output: unknown): OpenAIResponsesClient & { lastPayload?: { input?: string } } {
  const client = {
    lastPayload: undefined as { input?: string } | undefined,
    responses: {
      async create(payload: { input?: string }) {
        client.lastPayload = payload;
        return { output_text: JSON.stringify(output) };
      },
    },
  };
  return client as OpenAIResponsesClient & { lastPayload?: { input?: string } };
}

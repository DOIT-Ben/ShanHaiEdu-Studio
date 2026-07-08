import { describe, expect, it } from "vitest";
import { createDeterministicMainConversationAgent } from "@/server/conversation/main-conversation-agent";

const agent = createDeterministicMainConversationAgent();

describe("M54-B MainConversationAgent", () => {
  it("answers casual chat naturally without a tool plan", async () => {
    const turn = await agent.respond({ userMessage: "你好", availableArtifactKinds: [] });

    expect(turn.state).toBe("chatting");
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.shouldRunToolNow).toBe(false);
    expect(turn.assistantMessage.body).toContain("我在");
  });

  it("explores lesson ideas without generating artifacts", async () => {
    const turn = await agent.respond({
      userMessage: "我想聊聊五年级百分数公开课怎么设计",
      availableArtifactKinds: [],
    });

    expect(turn.state).toBe("exploring");
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.shouldRunToolNow).toBe(false);
    expect(turn.quickReplies.length).toBeGreaterThanOrEqual(2);
  });

  it("creates a PPT-related tool plan for explicit PPT requests", async () => {
    const turn = await agent.respond({
      userMessage: "帮我做五年级数学百分数 PPT",
      availableArtifactKinds: [],
    });

    expect(["planning_tools", "awaiting_confirmation"]).toContain(turn.state);
    expect(turn.toolPlan).toMatchObject({
      capabilityId: "requirement_spec",
      requiresConfirmation: true,
    });
    expect(turn.shouldRunToolNow).toBe(false);
    expect(turn.quickReplies.map((reply) => reply.prompt)).toContain("确认开始，先整理需求规格。");
  });

  it("asks for missing inputs before planning vague requests", async () => {
    const turn = await agent.respond({ userMessage: "帮我做一个课件", availableArtifactKinds: [] });

    expect(turn.state).toBe("collecting_inputs");
    expect(turn.toolPlan?.missingInputs).toEqual(["grade", "subject", "topic"]);
    expect(turn.recommendedOptions.length).toBeGreaterThanOrEqual(2);
    expect(turn.shouldRunToolNow).toBe(false);
  });
});

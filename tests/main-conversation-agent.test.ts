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

  it("creates a teacher-readable delivery plan for complete material package requests", async () => {
    const turn = await agent.respond({
      userMessage: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      availableArtifactKinds: [],
    });

    expect(turn.state).toBe("awaiting_confirmation");
    expect(turn.toolPlan).toMatchObject({ capabilityId: "requirement_spec" });
    expect(turn.deliveryPlan?.steps.map((step) => step.title)).toEqual([
      "整理备课需求",
      "生成公开课教案",
      "生成 PPT 大纲",
      "生成 PPT 设计稿",
      "生成 PPTX 文件",
      "生成课堂图片素材",
      "生成导入视频素材",
      "打包最终交付",
    ]);
    expect(turn.quickReplies.map((reply) => reply.prompt)).toContain("确认开始，按这个计划推进。");
    expect(JSON.stringify(turn.deliveryPlan)).not.toMatch(/schema|provider|node_id|storage|debug|local path/i);
  });

  it("asks for missing inputs before planning vague requests", async () => {
    const turn = await agent.respond({ userMessage: "帮我做一个课件", availableArtifactKinds: [] });

    expect(turn.state).toBe("collecting_inputs");
    expect(turn.toolPlan?.missingInputs).toEqual(["grade", "subject", "topic"]);
    expect(turn.recommendedOptions.length).toBeGreaterThanOrEqual(2);
    expect(turn.shouldRunToolNow).toBe(false);
  });
});

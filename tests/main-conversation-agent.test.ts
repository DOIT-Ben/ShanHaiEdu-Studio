import { describe, expect, it } from "vitest";
import { createDeterministicMainConversationAgent } from "@/server/conversation/main-conversation-agent";

const agent = createDeterministicMainConversationAgent();

describe("M54-B MainConversationAgent", () => {
  it("answers casual chat naturally without a tool plan", async () => {
    const turn = await agent.respond({ userMessage: "你好", availableArtifactKinds: [] });

    expect(turn.state).toBe("chatting");
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.shouldRunToolNow).toBe(false);
    expect(turn.assistantMessage.body).toContain("小酷");
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
      "生成 PPT 关键样张资产批次",
      "组装 PPT 关键样张",
      "生成 PPT 全量正式资产",
      "组装完整可编辑 PPT",
      "生成课堂图片素材",
      "生成视频最小课程锚点",
      "生成导入创意主题",
      "生成导入视频脚本",
      "生成视频分镜",
      "生成视频资产说明",
      "生成视频资产图",
      "规划分镜视频片段",
      "生成分镜视频片段",
      "生成视频旁白与字幕",
      "只拼接最终导入视频",
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

  it("does not ask for confirmation when the planned capability is currently unavailable", async () => {
    const turn = await agent.respond({
      userMessage: "根据现有设计稿生成 PPTX 文件",
      availableArtifactKinds: ["ppt_design_draft"],
      conversationContext: {
        recentMessages: [],
        capabilityAvailability: [
          {
            capabilityId: "coze_ppt",
            status: "provider_unavailable",
            requiresConfirmation: true,
            missingApprovedInputs: [],
            reasonForModel: "status=provider_unavailable",
            reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
          },
        ],
      },
    });

    expect(turn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "coze_ppt",
        requiresConfirmation: false,
        reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
      },
    });
    expect(turn.assistantMessage.body).toContain("暂时不可用");
    expect(JSON.stringify({ body: turn.assistantMessage.body, quickReplies: turn.quickReplies, reasonForUser: turn.toolPlan?.reasonForUser })).not.toMatch(
      /providerUnavailable|runtimeKind|debug|schema|storage|local path|token/i,
    );
  });

  it("explains missing approved upstream artifacts before asking for ordinary course inputs", async () => {
    const turn = await agent.respond({
      userMessage: "帮我生成教案",
      availableArtifactKinds: [],
      conversationContext: {
        recentMessages: [],
        capabilityAvailability: [
          {
            capabilityId: "lesson_plan",
            status: "needs_approved_inputs",
            requiresConfirmation: true,
            missingApprovedInputs: ["requirement_spec"],
            reasonForModel: "status=needs_approved_inputs",
            reasonForUser: "请先确认前置成果后再继续。",
          },
        ],
      },
    });

    expect(turn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "lesson_plan",
        requiresConfirmation: false,
        reasonForUser: "请先确认前置成果后再继续。",
      },
    });
    expect(turn.assistantMessage.body).toBe("请先确认前置成果后再继续。");
  });
});

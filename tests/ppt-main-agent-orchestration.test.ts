import { describe, expect, it } from "vitest";
import { OpenAIMainConversationAgent } from "@/server/conversation/model-main-conversation-agent";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";

describe("V1-6 PPT Main Agent orchestration", () => {
  it("instructs the Main Agent to keep Critic, HumanGate, full production, and page repair separate", async () => {
    const client = fakeClient({
      assistantMessage: { body: "第 6 页需要局部返修。" },
      state: "awaiting_confirmation",
      quickReplies: [],
      recommendedOptions: [],
      toolPlan: {
        capabilityId: "ppt_page_repair",
        reasonForUser: "我可以只返修第 6 页。",
        inputDraft: { pageIds: ["page_06"] },
        missingInputs: [],
        nextSuggestedCapabilities: [],
        requiresConfirmation: true,
        expectedArtifactKind: "pptx_artifact",
      },
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "按审查意见修复课件。", availableArtifactKinds: ["pptx_artifact"] });

    expect(client.lastInstructions).toContain("样张审查通过且教师批准");
    expect(client.lastInstructions).toContain("不能自行调用全量资产");
    expect(client.lastInstructions).toContain("只提出ppt_page_repair");
    expect(turn.toolPlan?.inputDraft).toMatchObject({ pageIds: ["page_06"] });
  });
});

function fakeClient(output: unknown): OpenAIResponsesClient & { lastInstructions?: string } {
  const client = {
    lastInstructions: undefined as string | undefined,
    responses: {
      async create(payload: { instructions?: string }) {
        client.lastInstructions = payload.instructions;
        return { output_text: JSON.stringify(output) };
      },
    },
  };
  return client as OpenAIResponsesClient & { lastInstructions?: string };
}

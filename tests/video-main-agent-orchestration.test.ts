import { describe, expect, it } from "vitest";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { OpenAIMainConversationAgent } from "@/server/conversation/model-main-conversation-agent";

describe("V1-7 video Main Agent orchestration", () => {
  it("keeps course-anchor approval and final-video local repair inside the product", async () => {
    const client = fakeClient({
      assistantMessage: { body: "第二镜头需要局部返修。" }, state: "awaiting_confirmation",
      quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "video_segment_generate", reasonForUser: "我可以只返修第二镜头。",
        inputDraft: { shotIds: ["shot_02"] }, missingInputs: [], nextSuggestedCapabilities: [],
        requiresConfirmation: true, expectedArtifactKind: "video_segment_generate",
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });
    const turn = await agent.respond({ userMessage: "按成片审查意见返修。", availableArtifactKinds: ["concat_only_assemble"] });

    expect(client.instructions).toContain("六个硬门任一失败");
    expect(client.instructions).toContain("等待教师明确批准当前创意版本");
    expect(client.instructions).toContain("只返修受影响单元");
    expect(turn.toolPlan?.inputDraft).toMatchObject({ shotIds: ["shot_02"] });
  });
});

function fakeClient(output: unknown): OpenAIResponsesClient & { instructions?: string } {
  const client = { instructions: undefined as string | undefined, responses: { async create(payload: { instructions?: string }) { client.instructions = payload.instructions; return { output_text: JSON.stringify(output) }; } } };
  return client as OpenAIResponsesClient & { instructions?: string };
}

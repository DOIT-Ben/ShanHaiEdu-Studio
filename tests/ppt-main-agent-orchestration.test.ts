import { describe, expect, it, vi } from "vitest";

import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { OpenAIMainConversationAgent } from "@/server/conversation/model-main-conversation-agent";
import { createTaskBrief } from "@/server/conversation/task-contract";
import { getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";

describe("V1-6 PPT Main Agent orchestration", () => {
  it("selects PPT page repair through native function calling while business rules stay at the Tool boundary", async () => {
    const client = queuedClient([
      {
        output_text: "",
        output: [{
          id: "ppt-repair-item",
          type: "function_call",
          call_id: "ppt-repair-call",
          name: "repair_ppt_full_deck_pages",
          arguments: JSON.stringify({ pageIds: ["page_06"] }),
        }],
      },
      { output_text: "第 6 页已按审查意见完成局部返修。", output: [] },
    ]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-ppt-repair",
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "按审查意见只修复课件第 6 页。",
      taskBrief: createTaskBrief({
        taskId: "task-ppt-repair",
        projectId: "project-ppt-repair",
        intentEpoch: 0,
        goal: "按审查意见只修复课件第 6 页。",
        requestedOutputs: ["ppt"],
        constraints: ["只返修 page_06"],
        excludedOutputs: ["video"],
        generationIntensity: "standard",
        sourceMessageId: "message-ppt-repair",
      }),
      availableArtifactKinds: ["pptx_artifact"],
      agentToolLoop: {
        tools: [{ type: "function", name: "repair_ppt_full_deck_pages" }],
        allowedToolNames: ["repair_ppt_full_deck_pages"],
        dispatch,
      },
    });

    expect(client.payloads[0].instructions).toContain("只从本轮实际提供的 function Tool 中选择一个最合适的调用");
    expect(client.payloads[0].instructions).toContain("原生 function-call 循环独占 Tool 选择");
    expect(client.payloads[0].instructions).not.toContain("样张审查通过且教师批准");
    expect(client.payloads[0].instructions).not.toContain("不能自行调用全量资产");
    expect(dispatch).toHaveBeenCalledWith({
      callId: "ppt-repair-call",
      toolName: "repair_ppt_full_deck_pages",
      arguments: { pageIds: ["page_06"] },
    });
    expect(client.payloads[0]).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [expect.objectContaining({ name: "repair_ppt_full_deck_pages" })],
    });
    expect(getToolDefinitionByCapabilityId("ppt_page_repair")).toMatchObject({
      description: expect.stringContaining("只返修教师明确指定的页面"),
      requiredArtifactKinds: ["pptx_artifact", "ppt_design_draft", "image_prompts"],
      producedArtifactKind: "pptx_artifact",
    });
    expect(turn).toMatchObject({
      assistantMessage: { body: expect.stringContaining("第 6 页") },
      state: "succeeded",
      runtimeKind: "openai",
    });
  });
});

function queuedClient(responses: Array<Record<string, unknown>>): OpenAIResponsesClient & {
  payloads: Array<Record<string, unknown>>;
} {
  const queue = [...responses];
  const payloads: Array<Record<string, unknown>> = [];
  return {
    payloads,
    responses: {
      async create(payload: Record<string, unknown>) {
        payloads.push(payload);
        const response = queue.shift();
        if (!response) throw new Error("No fake response queued");
        return response;
      },
    },
  } as OpenAIResponsesClient & { payloads: Array<Record<string, unknown>> };
}

import { describe, expect, it, vi } from "vitest";

import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { OpenAIMainConversationAgent } from "@/server/conversation/model-main-conversation-agent";
import { createTaskBrief } from "@/server/conversation/task-contract";
import { getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";

describe("V1-7 video Main Agent orchestration", () => {
  it("selects one video-shot repair through native function calling while generation rules stay at the Tool boundary", async () => {
    const client = queuedClient([
      {
        output_text: "",
        output: [{
          id: "video-repair-item",
          type: "function_call",
          call_id: "video-repair-call",
          name: "generate_video_shot",
          arguments: JSON.stringify({ shotIds: ["shot_02"] }),
        }],
      },
      { output_text: "第二镜头已完成局部返修，其他镜头保持不变。", output: [] },
    ]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-video-repair",
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "按成片审查意见只返修第二镜头。",
      taskBrief: createTaskBrief({
        taskId: "task-video-repair",
        projectId: "project-video-repair",
        intentEpoch: 0,
        goal: "按成片审查意见只返修第二镜头。",
        requestedOutputs: ["video"],
        constraints: ["只返修 shot_02"],
        excludedOutputs: ["ppt"],
        generationIntensity: "standard",
        sourceMessageId: "message-video-repair",
      }),
      availableArtifactKinds: ["concat_only_assemble"],
      agentToolLoop: {
        tools: [{ type: "function", name: "generate_video_shot" }],
        allowedToolNames: ["generate_video_shot"],
        dispatch,
      },
    });

    expect(client.payloads[0].instructions).toContain("只从本轮实际提供的 function Tool 中选择一个最合适的调用");
    expect(client.payloads[0].instructions).toContain("原生 function-call 循环独占 Tool 选择");
    expect(client.payloads[0].instructions).not.toContain("六个硬门任一失败");
    expect(client.payloads[0].instructions).not.toContain("等待教师明确批准当前创意版本");
    expect(dispatch).toHaveBeenCalledWith({
      callId: "video-repair-call",
      toolName: "generate_video_shot",
      arguments: { shotIds: ["shot_02"] },
    });
    expect(client.payloads[0]).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [expect.objectContaining({ name: "generate_video_shot" })],
    });
    expect(getToolDefinitionByCapabilityId("video_segment_generate")).toMatchObject({
      requiredArtifactKinds: ["video_segment_plan", "storyboard_generate", "asset_image_generate"],
      producedArtifactKind: "video_segment_generate",
      sideEffectLevel: "external_call",
    });
    expect(turn).toMatchObject({
      assistantMessage: { body: expect.stringContaining("第二镜头") },
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

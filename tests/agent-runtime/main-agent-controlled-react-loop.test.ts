import { describe, expect, it, vi } from "vitest";

import { runMainAgentControlledReActLoop } from "@/server/conversation/main-agent-controlled-react-loop";
import type { GptProtocolResponse } from "@/server/gpt-protocol/types";

describe("V1-3 Main Agent controlled ReAct loop", () => {
  it("feeds a read-only Agent Tool result back to the model in the same turn", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-1", "ppt_director_plan_or_repair", { goal: "规划", stage: "page_design", targetPageIds: [], focus: null }),
      completedResponse("{\"assistantMessage\":{\"body\":\"请先确认样张方案。\"}}"),
    ]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      modelOutput: { decision: "plan", nextToolIntents: ["assemble_ppt_key_samples"] },
      observationId: "observation-1",
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch,
    });

    expect(result).toMatchObject({ status: "completed", toolRoundsUsed: 1, observationIds: ["observation-1"] });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(adapter.requests[1].inputItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
    ]));
  });

  it("blocks an identical Agent Tool call instead of looping", async () => {
    const call = toolCallResponse("call-1", "ppt_director_plan_or_repair", { goal: "规划", stage: "page_design", targetPageIds: [], focus: null });
    const adapter = sequenceAdapter([call, { ...call, output: [{ ...call.output[0], call_id: "call-2" }] } as never]);
    const dispatch = vi.fn(async () => ({ status: "failed" as const, modelOutput: { reason: "retry" } }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch,
    });

    expect(result).toMatchObject({ status: "blocked", reason: "repeated_tool_call", toolRoundsUsed: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("blocks unknown and parallel tool calls", async () => {
    const unknown = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([toolCallResponse("call-x", "raw_provider_submit", {})]),
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: [],
      dispatch: vi.fn(),
    });
    expect(unknown).toMatchObject({ status: "blocked", reason: "tool_call_invalid" });

    const parallelResponse = toolCallResponse("call-1", "ppt_director_plan_or_repair", {});
    parallelResponse.output.push({ ...parallelResponse.output[0], call_id: "call-2", id: "item-2" });
    parallelResponse.outputItems.push({ ...parallelResponse.outputItems[0], call_id: "call-2", id: "item-2" });
    parallelResponse.functionCalls.push({
      ...parallelResponse.functionCalls[0],
      id: "item-2",
      callId: "call-2",
    });
    const parallel = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([parallelResponse]),
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch: vi.fn(),
    });
    expect(parallel).toMatchObject({ status: "blocked", reason: "multiple_tool_calls_blocked" });
  });

  it("preserves the sanitized adapter diagnostic when a ReAct request fails", async () => {
    const diagnosticMessage = "Request rejected: invalid response schema at [redacted-url]";
    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([{
        assistantText: "", rawText: "", functionCalls: [], outputItems: [], outputItemsSummary: [],
        diagnostics: { status: "failed", provider: "openai_responses", model: "test", errorMessage: diagnosticMessage },
      }]),
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch: vi.fn(),
    });
    expect(result).toMatchObject({ status: "failed", reason: "adapter_failed", diagnosticMessage });
  });
});

function sequenceAdapter(responses: Array<Record<string, any>>) {
  const requests: Array<Record<string, any>> = [];
  let index = 0;
  return {
    requests,
    async createResponse(request: Record<string, any>) {
      requests.push(request);
      return responses[Math.min(index++, responses.length - 1)] as GptProtocolResponse;
    },
  };
}

function toolCallResponse(callId: string, name: string, args: Record<string, unknown>) {
  const item = {
    id: `item-${callId}`,
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
  return {
    assistantText: "",
    rawText: "",
    functionCalls: [{
      id: item.id,
      callId,
      name,
      argumentsText: item.arguments,
      argumentsJsonParseStatus: "parsed" as const,
      argumentsJson: args,
    }],
    output: [item],
    outputItems: [item],
    outputItemsSummary: [],
    diagnostics: { status: "succeeded" as const, provider: "openai_responses" as const, model: "test" },
  };
}

function completedResponse(text: string) {
  return {
    assistantText: text,
    rawText: text,
    functionCalls: [],
    outputItems: [],
    outputItemsSummary: [],
    diagnostics: { status: "succeeded" as const, provider: "openai_responses" as const, model: "test" },
  };
}

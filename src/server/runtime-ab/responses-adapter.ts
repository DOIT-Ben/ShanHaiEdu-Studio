import {
  RUNTIME_AB_EVALUATION_PROFILE,
  assertRuntimeAbEvaluationProfile,
  isRuntimeAbToolName,
  type RuntimeAbAdapter,
  type RuntimeAbResponsesClient,
  type RuntimeAbToolCall,
  type RuntimeAbTurnDecision,
} from "./types";

export function createResponsesRuntimeAbAdapter(input: {
  client: RuntimeAbResponsesClient;
}): RuntimeAbAdapter {
  const profile = RUNTIME_AB_EVALUATION_PROFILE;
  return {
    runtimeKind: "responses",
    profile,
    async decide(turnInput) {
      assertRuntimeAbEvaluationProfile(profile);
      const response = await input.client.responses.create({
        taskBrief: structuredClone(turnInput.taskBrief),
        intentGrant: structuredClone(turnInput.intentGrant),
        observations: structuredClone(turnInput.observations),
        tools: structuredClone(turnInput.tools),
        tool_choice: "auto",
        parallel_tool_calls: false,
        retries: 0,
      });
      const functionCalls = response.output.filter((item) => item.type === "function_call");
      if (functionCalls.length === 0) {
        return { kind: "complete", summary: response.output_text.trim() || "The isolated Responses turn completed." };
      }
      if (functionCalls.length !== 1) {
        return paused("The isolated Responses turn emitted multiple tool calls.", "multiple_tool_calls_blocked");
      }
      const item = functionCalls[0];
      if (!isRuntimeAbToolName(item.name, turnInput.tools)) {
        return paused("The isolated Responses turn selected an unavailable tool.", "tool_outside_candidate_set");
      }
      const argumentsValue = parseArguments(item.arguments);
      if (!argumentsValue) {
        return paused("The isolated Responses turn returned invalid tool arguments.", "invalid_tool_arguments");
      }
      return {
        kind: "tool",
        call: {
          callId: item.call_id,
          toolName: item.name,
          arguments: argumentsValue,
        } satisfies RuntimeAbToolCall,
      };
    },
  };
}

function parseArguments(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function paused(summary: string, reasonCode: string): RuntimeAbTurnDecision {
  return { kind: "paused", summary, reasonCode };
}

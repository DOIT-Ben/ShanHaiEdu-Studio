import type { Model, ModelRequest } from "@openai/agents";

import {
  RUNTIME_AB_EVALUATION_PROFILE,
  assertRuntimeAbEvaluationProfile,
  isRuntimeAbToolName,
  type RuntimeAbAdapter,
  type RuntimeAbModelTurnInput,
  type RuntimeAbToolCall,
  type RuntimeAbTurnDecision,
} from "./types";

export function createAgentsSdkRuntimeAbAdapter(input: { model: Model }): RuntimeAbAdapter {
  const profile = RUNTIME_AB_EVALUATION_PROFILE;
  return {
    runtimeKind: "agents_sdk",
    profile,
    async decide(turnInput) {
      assertRuntimeAbEvaluationProfile(profile);
      const response = await input.model.getResponse(buildModelRequest(turnInput));
      const functionCalls = response.output.filter((item) => item.type === "function_call");
      if (functionCalls.length === 0) {
        return {
          kind: "complete",
          summary: extractOutputText(response.output) || "The isolated Agents SDK model turn completed.",
        };
      }
      if (functionCalls.length !== 1) {
        return paused("The isolated Agents SDK model turn emitted multiple tool calls.", "multiple_tool_calls_blocked");
      }
      const item = functionCalls[0];
      if (!isRuntimeAbToolName(item.name, turnInput.tools)) {
        return paused("The isolated Agents SDK model turn selected an unavailable tool.", "tool_outside_candidate_set");
      }
      const argumentsValue = parseArguments(item.arguments);
      if (!argumentsValue) {
        return paused("The isolated Agents SDK model turn returned invalid tool arguments.", "invalid_tool_arguments");
      }
      return {
        kind: "tool",
        call: {
          callId: item.callId,
          toolName: item.name,
          arguments: argumentsValue,
        } satisfies RuntimeAbToolCall,
      };
    },
  };
}

function buildModelRequest(input: RuntimeAbModelTurnInput): ModelRequest {
  return {
    systemInstructions: [
      "Select at most one of the supplied text business tools in this model turn.",
      "Read all concrete observations before choosing whether to repair, change tool, or finish.",
      "Do not call media tools and do not assume a fixed tool order.",
    ].join(" "),
    input: JSON.stringify({
      taskBrief: input.taskBrief,
      intentGrant: input.intentGrant,
      observations: input.observations,
      constraints: {
        candidateTools: input.tools.map((tool) => tool.name),
        noMedia: true,
        fixedOrderRequired: false,
      },
    }),
    modelSettings: {
      parallelToolCalls: false,
      toolChoice: "auto",
      retry: { maxRetries: 0, policy: () => false },
    },
    tools: structuredClone(input.tools),
    toolsExplicitlyProvided: true,
    outputType: "text",
    handoffs: [],
    tracing: false,
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

function extractOutputText(output: readonly unknown[]) {
  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: string }).type !== "message") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) texts.push(text.trim());
    }
  }
  return texts.join("\n");
}

function paused(summary: string, reasonCode: string): RuntimeAbTurnDecision {
  return { kind: "paused", summary, reasonCode };
}

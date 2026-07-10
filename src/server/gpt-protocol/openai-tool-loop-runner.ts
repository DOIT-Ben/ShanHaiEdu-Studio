import { createToolCallIntent, type ToolCallIntent } from "./tool-call-intent";
import { serializeToolExecutionResultForFunctionCallOutput } from "./tool-output-serializer";
import type { GptFunctionCall, GptProtocolRequest, GptProtocolResponse } from "./types";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

export type OpenAIToolLoopAdapter = {
  createResponse(request: GptProtocolRequest): Promise<GptProtocolResponse>;
};

export type OpenAIToolLoopRunnerReason =
  | "none"
  | "adapter_failed"
  | "multiple_tool_calls_blocked"
  | "tool_call_not_ready"
  | "tool_round_limit_reached"
  | "tool_execution_failed";

export type OpenAIToolLoopRunnerResult = {
  status: "completed" | "failed" | "blocked";
  assistantText: string;
  diagnostics: {
    status: "succeeded" | "failed" | "blocked";
    reason: OpenAIToolLoopRunnerReason;
    toolRoundsUsed: number;
  };
};

export type RunOpenAIToolCallLoopOptions<TContext> = {
  adapter: OpenAIToolLoopAdapter;
  request: GptProtocolRequest;
  tools: unknown;
  allowedToolNames: readonly string[];
  context: TContext;
  buildToolRouterInput: (intent: ToolCallIntent, context: TContext) => ToolRouterInput;
  toolRouter: (input: ToolRouterInput) => Promise<ToolExecutionResult>;
  maxToolRounds?: number;
};

const safeFailureText = "这一步暂时无法继续，请调整要求后重试。";

export async function runOpenAIToolCallLoop<TContext>(
  options: RunOpenAIToolCallLoopOptions<TContext>,
): Promise<OpenAIToolLoopRunnerResult> {
  const maxToolRounds = Math.max(0, options.maxToolRounds ?? 1);
  let toolRoundsUsed = 0;
  let currentResponse = await options.adapter.createResponse(createModelRequest(options.request, options.tools));

  while (true) {
    if (currentResponse.diagnostics.status === "failed") {
      return safeResult("failed", "adapter_failed", toolRoundsUsed);
    }

    const functionCalls = currentResponse.functionCalls;

    if (functionCalls.length === 0) {
      return {
        status: "completed",
        assistantText: currentResponse.assistantText,
        diagnostics: {
          status: "succeeded",
          reason: "none",
          toolRoundsUsed,
        },
      };
    }

    if (toolRoundsUsed >= maxToolRounds) {
      return safeResult("failed", "tool_round_limit_reached", toolRoundsUsed);
    }

    if (functionCalls.length > 1) {
      return safeResult("blocked", "multiple_tool_calls_blocked", toolRoundsUsed);
    }

    const functionCall = functionCalls[0];
    const intent = createToolCallIntent(functionCall, { allowedToolNames: options.allowedToolNames });
    if (intent.status !== "ready") {
      return safeResult("failed", "tool_call_not_ready", toolRoundsUsed);
    }

    let toolExecutionResult: ToolExecutionResult;
    try {
      toolExecutionResult = await options.toolRouter(options.buildToolRouterInput(intent, options.context));
    } catch {
      return safeResult("failed", "tool_execution_failed", toolRoundsUsed);
    }

    if (toolExecutionResult.status !== "succeeded") {
      return safeResult("failed", "tool_execution_failed", toolRoundsUsed);
    }

    const output = serializeToolExecutionResultForFunctionCallOutput(toolExecutionResult);
    const inputItems = [createOriginalUserInputItem(options.request), ...getContinuationOutputItems(currentResponse), createFunctionCallOutputItem(functionCall, output)];
    toolRoundsUsed += 1;
    currentResponse = await options.adapter.createResponse(createModelRequest(options.request, options.tools, inputItems));
  }
}

function createModelRequest(request: GptProtocolRequest, tools: unknown, inputItems?: unknown[]): GptProtocolRequest {
  return {
    ...request,
    ...(inputItems ? { inputItems } : {}),
    tools,
    toolChoice: "auto",
    parallelToolCalls: false,
  };
}

function getContinuationOutputItems(response: GptProtocolResponse): unknown[] {
  if (Array.isArray(response.outputItems) && response.outputItems.length > 0) {
    return response.outputItems;
  }

  return response.functionCalls.map((call) => ({
    ...(call.id ? { id: call.id } : {}),
    type: "function_call",
    call_id: call.callId,
    name: call.name,
    arguments: call.argumentsText,
  }));
}

function createOriginalUserInputItem(request: GptProtocolRequest): Record<string, string> {
  return {
    role: "user",
    content: request.input,
  };
}

function createFunctionCallOutputItem(functionCall: GptFunctionCall, output: string): Record<string, string> {
  return {
    type: "function_call_output",
    call_id: functionCall.callId,
    output,
  };
}

function safeResult(
  status: "failed" | "blocked",
  reason: Exclude<OpenAIToolLoopRunnerReason, "none">,
  toolRoundsUsed: number,
): OpenAIToolLoopRunnerResult {
  return {
    status,
    assistantText: safeFailureText,
    diagnostics: {
      status,
      reason,
      toolRoundsUsed,
    },
  };
}

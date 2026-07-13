import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { GptFunctionCall, GptProtocolRequest, GptProtocolResponse } from "@/server/gpt-protocol/types";

export type MainAgentReActAdapter = {
  createResponse(request: GptProtocolRequest): Promise<GptProtocolResponse>;
};

export type MainAgentReActDispatchResult = {
  status: "succeeded" | "failed" | "blocked" | "inconclusive";
  modelOutput: Record<string, unknown>;
  observationId?: string;
};

export type MainAgentReActLoopOptions = {
  adapter: MainAgentReActAdapter;
  request: GptProtocolRequest;
  tools: unknown[];
  allowedToolNames: readonly string[];
  dispatch: (call: { callId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<MainAgentReActDispatchResult>;
  maxToolRounds?: number;
};

export type MainAgentReActLoopResult = {
  status: "completed" | "failed" | "blocked";
  assistantText: string;
  toolRoundsUsed: number;
  observationIds: string[];
  reason: "none" | "adapter_failed" | "multiple_tool_calls_blocked" | "tool_call_invalid" | "tool_round_limit_reached" | "repeated_tool_call";
  diagnosticMessage?: string;
};

const safeFailureText = "当前编排已暂停，请调整要求后继续。";

export async function runMainAgentControlledReActLoop(
  options: MainAgentReActLoopOptions,
): Promise<MainAgentReActLoopResult> {
  const maxToolRounds = Math.max(0, options.maxToolRounds ?? 3);
  const signatures = new Set<string>();
  const observationIds: string[] = [];
  let toolRoundsUsed = 0;
  let currentResponse = await options.adapter.createResponse(modelRequest(options.request, options.tools));

  while (true) {
    if (currentResponse.diagnostics.status === "failed") {
      return failed("adapter_failed", toolRoundsUsed, observationIds, currentResponse.diagnostics.errorMessage);
    }
    if (currentResponse.functionCalls.length === 0) {
      return {
        status: "completed",
        assistantText: currentResponse.assistantText,
        toolRoundsUsed,
        observationIds,
        reason: "none",
      };
    }
    if (toolRoundsUsed >= maxToolRounds) return failed("tool_round_limit_reached", toolRoundsUsed, observationIds);
    if (currentResponse.functionCalls.length !== 1) return blocked("multiple_tool_calls_blocked", toolRoundsUsed, observationIds);

    const call = currentResponse.functionCalls[0];
    const parsed = parseAllowedCall(call, options.allowedToolNames);
    if (!parsed) return blocked("tool_call_invalid", toolRoundsUsed, observationIds);
    const signature = hashRunInput({ toolName: parsed.toolName, arguments: parsed.arguments });
    if (signatures.has(signature)) return blocked("repeated_tool_call", toolRoundsUsed, observationIds);
    signatures.add(signature);

    const dispatchResult = await options.dispatch(parsed);
    if (dispatchResult.observationId) observationIds.push(dispatchResult.observationId);
    const items = [
      originalInputItem(options.request),
      ...continuationItems(currentResponse),
      functionOutputItem(call, JSON.stringify({
        status: dispatchResult.status,
        result: dispatchResult.modelOutput,
      })),
    ];
    toolRoundsUsed += 1;
    currentResponse = await options.adapter.createResponse(modelRequest(options.request, options.tools, items));
  }
}

function parseAllowedCall(call: GptFunctionCall, allowed: readonly string[]) {
  if (!allowed.includes(call.name) || call.argumentsJsonParseStatus !== "parsed" || !isRecord(call.argumentsJson)) return null;
  return { callId: call.callId, toolName: call.name, arguments: structuredClone(call.argumentsJson) };
}

function modelRequest(request: GptProtocolRequest, tools: unknown[], inputItems?: unknown[]): GptProtocolRequest {
  return {
    ...request,
    ...(inputItems ? { inputItems } : {}),
    tools,
    toolChoice: "auto",
    parallelToolCalls: false,
  };
}

function originalInputItem(request: GptProtocolRequest) {
  return { role: "user", content: request.input };
}

function continuationItems(response: GptProtocolResponse): unknown[] {
  if (response.outputItems.length > 0) return response.outputItems;
  return response.functionCalls.map((call) => ({
    ...(call.id ? { id: call.id } : {}),
    type: "function_call",
    call_id: call.callId,
    name: call.name,
    arguments: call.argumentsText,
  }));
}

function functionOutputItem(call: GptFunctionCall, output: string) {
  return { type: "function_call_output", call_id: call.callId, output };
}

function failed(reason: MainAgentReActLoopResult["reason"], rounds: number, observationIds: string[], diagnosticMessage?: string): MainAgentReActLoopResult {
  return { status: "failed", assistantText: safeFailureText, toolRoundsUsed: rounds, observationIds, reason, ...(diagnosticMessage ? { diagnosticMessage } : {}) };
}

function blocked(reason: MainAgentReActLoopResult["reason"], rounds: number, observationIds: string[]): MainAgentReActLoopResult {
  return { status: "blocked", assistantText: safeFailureText, toolRoundsUsed: rounds, observationIds, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

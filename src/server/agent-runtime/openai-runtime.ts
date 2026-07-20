import type {
  AgentRuntime,
  AgentRuntimeInput,
  AgentRuntimeResult,
} from "./types";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { runOpenAIToolCallLoop } from "@/server/gpt-protocol/openai-tool-loop-runner";
import type { ToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";
import {
  classifyProviderDiagnostic,
  classifyRuntimeFailure,
  RuntimeFailureError,
} from "./openai-runtime-error";
import { buildOpenAIResponseRequest, type OpenAIResponsePayload } from "./openai-runtime-request";
import { parseStructuredOutput } from "./openai-runtime-output";
import { buildFailedResult, buildSucceededResult } from "./openai-runtime-result";

// Compatibility source contract retained at the Runtime boundary: the request still carries
// 逐页紧凑设计候选、不得使用页码范围或通用占位描述, and the video path keeps 最小课程锚点、独立创意、视频脚本、分镜、资产、每镜头时长、课堂边界约束、只拼接.
export { buildOpenAIResponseRequest } from "./openai-runtime-request";

export type OpenAIResponsesClient = {
  responses: {
    create(payload: Record<string, unknown>): Promise<unknown>;
  };
};

export type OpenAIRuntimeNativeToolLoopOptions = {
  tools: unknown;
  allowedToolNames: readonly string[];
  toolRouter: (input: ToolRouterInput) => Promise<ToolExecutionResult>;
  buildToolRouterInput: (intent: ToolCallIntent, runtimeInput: AgentRuntimeInput) => ToolRouterInput;
  maxToolRounds?: number;
};

export type OpenAIRuntimeNativeToolLoopResolver = (
  input: AgentRuntimeInput,
) => OpenAIRuntimeNativeToolLoopOptions | undefined;

export type OpenAIRuntimeOptions = {
  client: OpenAIResponsesClient;
  model: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  nativeToolLoop?: OpenAIRuntimeNativeToolLoopOptions | OpenAIRuntimeNativeToolLoopResolver;
};

export class OpenAIRuntime implements AgentRuntime {
  private readonly client: OpenAIResponsesClient;
  private readonly model: string;
  private readonly reasoningEffort: "low" | "medium" | "high" | "xhigh";
  private readonly nativeToolLoop?: OpenAIRuntimeNativeToolLoopOptions | OpenAIRuntimeNativeToolLoopResolver;

  constructor(options: OpenAIRuntimeOptions) {
    this.client = options.client;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? "high";
    this.nativeToolLoop = options.nativeToolLoop;
  }

  async run(input: AgentRuntimeInput): Promise<AgentRuntimeResult> {
    try {
      const strategy = input.taskInput && Object.hasOwn(input.taskInput, "generationIntensity")
        ? resolveGenerationIntensityStrategy(input.taskInput.generationIntensity)
        : null;
      const adapter = createOpenAIResponsesGptAdapter({ client: this.client, model: strategy?.model ?? this.model });
      const request = buildOpenAIResponseRequest(input, strategy?.reasoningEffort ?? this.reasoningEffort);
      const assistantText = await this.createAssistantText(adapter, request, input);
      const parsed = parseStructuredOutput(assistantText, input.task);

      return buildSucceededResult(input, parsed);
    } catch (error) {
      return buildFailedResult(input, classifyRuntimeFailure(error));
    }
  }

  private async createAssistantText(
    adapter: ReturnType<typeof createOpenAIResponsesGptAdapter>,
    request: OpenAIResponsePayload,
    input: AgentRuntimeInput,
  ): Promise<string> {
    const nativeToolLoop = resolveNativeToolLoop(this.nativeToolLoop, input);
    if (!isNativeToolLoopEnabled(nativeToolLoop)) {
      const response = await adapter.createResponse(request);
      if (response.diagnostics.status === "failed") {
        throw new RuntimeFailureError(classifyProviderDiagnostic(response.diagnostics.errorMessage), true);
      }
      return response.assistantText;
    }

    const loopResult = await runOpenAIToolCallLoop({
      adapter,
      request,
      tools: nativeToolLoop.tools,
      allowedToolNames: nativeToolLoop.allowedToolNames,
      context: input,
      buildToolRouterInput: nativeToolLoop.buildToolRouterInput,
      toolRouter: nativeToolLoop.toolRouter,
      maxToolRounds: nativeToolLoop.maxToolRounds,
    });

    if (loopResult.status !== "completed") {
      const category = loopResult.diagnostics.reason === "tool_call_not_ready" ? "validation" : "provider";
      throw new RuntimeFailureError(category, category === "provider");
    }

    return loopResult.assistantText;
  }
}

function resolveNativeToolLoop(
  nativeToolLoop: OpenAIRuntimeOptions["nativeToolLoop"],
  input: AgentRuntimeInput,
): OpenAIRuntimeNativeToolLoopOptions | undefined {
  if (typeof nativeToolLoop === "function") {
    return nativeToolLoop(input);
  }

  return nativeToolLoop;
}

function isNativeToolLoopEnabled(options: OpenAIRuntimeNativeToolLoopOptions | undefined): options is OpenAIRuntimeNativeToolLoopOptions {
  return (
    options !== undefined &&
    options.tools !== undefined &&
    Array.isArray(options.allowedToolNames) &&
    options.allowedToolNames.length > 0 &&
    typeof options.toolRouter === "function" &&
    typeof options.buildToolRouterInput === "function"
  );
}

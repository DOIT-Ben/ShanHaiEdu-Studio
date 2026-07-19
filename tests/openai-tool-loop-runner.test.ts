import { describe, expect, it, vi } from "vitest";
import { runOpenAIToolCallLoop } from "@/server/gpt-protocol/openai-tool-loop-runner";
import type { GptProtocolRequest, GptProtocolResponse } from "@/server/gpt-protocol/types";
import type { ToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

const forbiddenSensitiveOutputPattern = /token|provider|schema|debug|local path|\bAPI\b|baseURL|api[_-]?key|secret|credential|Bearer\s+\S+|https?:\/\/|file:\/\/|[A-Z]:\\|\/Users\/|sk-secret|abc123|secret-token/i;

const serverContext = {
  projectId: "server-project",
  artifactRefs: [{ kind: "ppt_design_draft", artifactId: "server-artifact" }],
  sourceMessageId: "server-message",
};

describe("OpenAI tool-call loop runner", () => {
  const request: GptProtocolRequest = {
    instructions: "只输出教师可读内容。",
    input: "生成一份水循环课件。",
  };
  const tools = [{ type: "function", name: "createSlides" }];
  it("returns final assistant text without calling toolRouter when the response has no function_call", async () => {
    const adapter = fakeAdapter([response({ assistantText: "老师可读最终回复。", rawText: "老师可读最终回复。" })]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());

    const result = await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("老师可读最终回复。");
    expect(JSON.stringify(result.diagnostics)).not.toMatch(forbiddenSensitiveOutputPattern);
    expect(JSON.stringify(result)).not.toMatch(/provider|schema|token|https?:\/\/|[A-Z]:\\/i);
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toMatchObject({
      tools,
      toolChoice: "auto",
      parallelToolCalls: false,
    });
    expect(toolRouter).not.toHaveBeenCalled();
  });

  it("executes one allowlisted function_call and continues with original output items plus function_call_output", async () => {
    const functionCallItem = {
      id: "fc_1",
      type: "function_call",
      status: "completed",
      call_id: "call_create_slides_1",
      name: "createSlides",
      arguments: JSON.stringify({ userInstruction: "生成水循环课件。" }),
    };
    const adapter = fakeAdapter([
      response({
        functionCalls: [parsedCall(functionCallItem)],
        outputItems: [{ id: "rs_1", type: "reasoning", summary: [] }, functionCallItem],
      }),
      response({ assistantText: "课件已经生成，请检查。", rawText: "课件已经生成，请检查。" }),
    ]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());

    const result = await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    expect(result.status).toBe("completed");
    expect(result.assistantText).toBe("课件已经生成，请检查。");
    expect(toolRouter).toHaveBeenCalledTimes(1);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1].inputItems).toEqual([
      { role: "user", content: request.input },
      { id: "rs_1", type: "reasoning", summary: [] },
      functionCallItem,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_create_slides_1",
        output: expect.stringContaining("课件已生成"),
      }),
    ]);
  });

  it("keeps the original user input in the continuation request", async () => {
    const functionCallItem = {
      id: "fc_keep_context",
      type: "function_call",
      status: "completed",
      call_id: "call_keep_context",
      name: "createSlides",
      arguments: JSON.stringify({ userInstruction: "生成水循环课件。" }),
    };
    const adapter = fakeAdapter([
      response({
        functionCalls: [parsedCall(functionCallItem)],
        outputItems: [{ id: "rs_keep", type: "reasoning", summary: [] }, functionCallItem],
      }),
      response({ assistantText: "课件已经生成，请检查。", rawText: "课件已经生成，请检查。" }),
    ]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());

    await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    expect(adapter.calls[1].inputItems?.[0]).toEqual({ role: "user", content: request.input });
  });

  it("keeps explicit context continuation by default when a compatible REST provider returns a response id", async () => {
    const functionCallItem = {
      id: "fc_explicit",
      type: "function_call",
      status: "completed",
      call_id: "call_explicit",
      name: "createSlides",
      arguments: JSON.stringify({ userInstruction: "生成水循环课件。" }),
    };
    const adapter = fakeAdapter([
      response({ responseId: "resp_rest_only", functionCalls: [parsedCall(functionCallItem)], outputItems: [functionCallItem] }),
      response({ assistantText: "课件已经生成。", rawText: "课件已经生成。" }),
    ]);

    await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter: async () => succeededToolResult(),
    });

    expect(adapter.calls[1].previousResponseId).toBeUndefined();
    expect(adapter.calls[1].inputItems?.[0]).toEqual({ role: "user", content: request.input });
    expect(JSON.stringify(adapter.calls[1].inputItems)).toContain("call_explicit");
  });

  it("uses previous_response continuation only when the provider capability is explicitly enabled", async () => {
    const functionCallItem = {
      id: "fc_previous",
      type: "function_call",
      status: "completed",
      call_id: "call_previous",
      name: "createSlides",
      arguments: JSON.stringify({ userInstruction: "生成水循环课件。" }),
    };
    const adapter = fakeAdapter([
      response({ responseId: "resp_previous", functionCalls: [parsedCall(functionCallItem)], outputItems: [functionCallItem] }),
      response({ assistantText: "课件已经生成。", rawText: "课件已经生成。" }),
    ]);

    await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter: async () => succeededToolResult(),
      usePreviousResponseId: true,
    });

    expect(adapter.calls[1]).toMatchObject({
      previousResponseId: "resp_previous",
      inputItems: [expect.objectContaining({ type: "function_call_output", call_id: "call_previous" })],
    });
    expect(JSON.stringify(adapter.calls[1].inputItems)).not.toContain(request.input);
  });

  it.each(["failed", "retryable_failed", "needs_input"] as const)("stops safely when ToolRouter reports %s instead of letting the model upgrade it to success", async (toolStatus) => {
    const adapter = fakeAdapter([
      response({
        functionCalls: [
          { callId: "call_failed_tool", name: "createSlides", argumentsText: "{}", argumentsJsonParseStatus: "parsed", argumentsJson: {} },
        ],
        outputItems: [{ type: "function_call", call_id: "call_failed_tool", name: "createSlides", arguments: "{}" }],
      }),
      response({ assistantText: "我已生成课件。", rawText: "我已生成课件。" }),
    ]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => nonSucceededToolResult(toolStatus));

    const result = await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    expect(result.status).toBe("failed");
    expect(result.diagnostics.reason).toBe("tool_execution_failed");
    expect(adapter.calls).toHaveLength(1);
  });

  it("uses server-authoritative mapper values instead of forged model projectId, artifactRefs, and sourceMessageId", async () => {
    const adapter = fakeAdapter([
      response({
        functionCalls: [
          {
            callId: "call_forged",
            name: "createSlides",
            argumentsText: JSON.stringify({
              userInstruction: "生成课件。",
              projectId: "forged-project",
              artifactRefs: [{ kind: "ppt_design_draft", artifactId: "forged-artifact" }],
              sourceMessageId: "forged-message",
            }),
            argumentsJsonParseStatus: "parsed",
            argumentsJson: {
              userInstruction: "生成课件。",
              projectId: "forged-project",
              artifactRefs: [{ kind: "ppt_design_draft", artifactId: "forged-artifact" }],
              sourceMessageId: "forged-message",
            },
          },
        ],
        outputItems: [{ type: "function_call", call_id: "call_forged", name: "createSlides", arguments: "{}" }],
      }),
      response({ assistantText: "已继续。", rawText: "已继续。" }),
    ]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());

    await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    expect(toolRouter).toHaveBeenCalledWith({
      toolName: "createSlides",
      projectId: "server-project",
      userInstruction: "生成课件。",
      artifactRefs: [{ kind: "ppt_design_draft", artifactId: "server-artifact" }],
      sourceMessageId: "server-message",
    });
    expect(JSON.stringify(toolRouter.mock.calls[0][0])).not.toContain("forged-project");
    expect(JSON.stringify(toolRouter.mock.calls[0][0])).not.toContain("forged-artifact");
    expect(JSON.stringify(toolRouter.mock.calls[0][0])).not.toContain("forged-message");
  });

  it("blocks multiple functionCalls without invoking toolRouter", async () => {
    const adapter = fakeAdapter([
      response({
        functionCalls: [
          { callId: "call_1", name: "createSlides", argumentsText: "{}", argumentsJsonParseStatus: "parsed", argumentsJson: {} },
          { callId: "call_2", name: "createSlides", argumentsText: "{}", argumentsJsonParseStatus: "parsed", argumentsJson: {} },
        ],
      }),
    ]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());

    const result = await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    expect(result.status).toBe("blocked");
    expect(result.diagnostics.reason).toBe("multiple_tool_calls_blocked");
    expect(toolRouter).not.toHaveBeenCalled();
  });

  it("fails safely for invalid arguments and unsupported tools without invoking toolRouter", async () => {
    for (const functionCalls of [
      [{ callId: "call_invalid", name: "createSlides", argumentsText: "{not-json", argumentsJsonParseStatus: "invalid_json" as const }],
      [{ callId: "call_unsupported", name: "deleteProject", argumentsText: "{}", argumentsJsonParseStatus: "parsed" as const, argumentsJson: {} }],
    ]) {
      const adapter = fakeAdapter([response({ functionCalls })]);
      const toolRouter = vi.fn<
        (input: ToolRouterInput) => Promise<ToolExecutionResult>
      >(async () => succeededToolResult());

      const result = await runOpenAIToolCallLoop({
        adapter,
        request,
        tools,
        allowedToolNames: ["createSlides"],
        context: serverContext,
        buildToolRouterInput: buildInputFromServerContext,
        toolRouter,
      });

      expect(result.status).toBe("failed");
      expect(result.assistantText).toContain("暂时无法继续");
      expect(toolRouter).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("deleteProject");
      expect(JSON.stringify(result)).not.toMatch(forbiddenSensitiveOutputPattern);
    }
  });

  it("fails safely when maxToolRounds is zero or continuation exceeds maxToolRounds", async () => {
    const firstToolCall = { callId: "call_1", name: "createSlides", argumentsText: "{}", argumentsJsonParseStatus: "parsed" as const, argumentsJson: {} };
    const secondToolCall = { callId: "call_2", name: "createSlides", argumentsText: "{}", argumentsJsonParseStatus: "parsed" as const, argumentsJson: {} };

    const zeroRoundAdapter = fakeAdapter([response({ functionCalls: [firstToolCall] })]);
    const zeroRoundRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());
    const zeroRoundResult = await runOpenAIToolCallLoop({
      adapter: zeroRoundAdapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter: zeroRoundRouter,
      maxToolRounds: 0,
    });

    expect(zeroRoundResult.status).toBe("failed");
    expect(zeroRoundResult.diagnostics.reason).toBe("tool_round_limit_reached");
    expect(zeroRoundRouter).not.toHaveBeenCalled();

    const overLimitAdapter = fakeAdapter([
      response({ functionCalls: [firstToolCall], outputItems: [{ type: "function_call", call_id: "call_1", name: "createSlides", arguments: "{}" }] }),
      response({ functionCalls: [secondToolCall], outputItems: [{ type: "function_call", call_id: "call_2", name: "createSlides", arguments: "{}" }] }),
    ]);
    const overLimitRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () => succeededToolResult());
    const overLimitResult = await runOpenAIToolCallLoop({
      adapter: overLimitAdapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter: overLimitRouter,
      maxToolRounds: 1,
    });

    expect(overLimitResult.status).toBe("failed");
    expect(overLimitResult.diagnostics.reason).toBe("tool_round_limit_reached");
    expect(overLimitRouter).toHaveBeenCalledTimes(1);
  });

  it("serializes function_call_output without leaking sensitive tool execution details", async () => {
    const adapter = fakeAdapter([
      response({
        functionCalls: [
          { callId: "call_sensitive", name: "createSlides", argumentsText: "{}", argumentsJsonParseStatus: "parsed", argumentsJson: {} },
        ],
        outputItems: [{ type: "function_call", call_id: "call_sensitive", name: "createSlides", arguments: "{}" }],
      }),
      response({ assistantText: "已继续。", rawText: "已继续。" }),
    ]);
    const toolRouter = vi.fn<
      (input: ToolRouterInput) => Promise<ToolExecutionResult>
    >(async () =>
      succeededToolResult({ assistantSummary: "课件已生成 provider schema debug API token=abc123 C:\\Users\\HB\\secret.pptx https://secret.example/v1" }),
    );

    await runOpenAIToolCallLoop({
      adapter,
      request,
      tools,
      allowedToolNames: ["createSlides"],
      context: serverContext,
      buildToolRouterInput: buildInputFromServerContext,
      toolRouter,
    });

    const functionCallOutput = (adapter.calls[1].inputItems as Array<Record<string, unknown>>).at(-1);
    expect(functionCallOutput).toMatchObject({ type: "function_call_output", call_id: "call_sensitive" });
    expect(String(functionCallOutput?.output)).not.toMatch(forbiddenSensitiveOutputPattern);
  });
});

function buildInputFromServerContext(intent: ToolCallIntent, context: typeof serverContext): ToolRouterInput {
  return {
    toolName: intent.toolName,
    projectId: context.projectId,
    userInstruction: intent.teacherIntent?.userInstruction,
    artifactRefs: context.artifactRefs,
    sourceMessageId: context.sourceMessageId,
  };
}

function fakeAdapter(responses: GptProtocolResponse[]) {
  const adapter = {
    calls: [] as GptProtocolRequest[],
    async createResponse(request: GptProtocolRequest): Promise<GptProtocolResponse> {
      adapter.calls.push(request);
      const next = responses.shift();
      if (!next) {
        throw new Error("No fake adapter response queued");
      }
      return next;
    },
  };
  return adapter;
}

function response(overrides: Partial<GptProtocolResponse> = {}): GptProtocolResponse {
  return {
    assistantText: "",
    rawText: "",
    functionCalls: [],
    outputItemsSummary: [],
    outputItems: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 },
    telemetry: {
      streamed: false,
      startedAt: "2026-07-16T00:00:00.000Z",
      completedAt: "2026-07-16T00:00:00.000Z",
      durationMs: 0,
      chunkCount: 0,
      textBytes: 0,
    },
    diagnostics: { status: "succeeded", provider: "openai_responses", model: "test-model" },
    ...overrides,
  };
}

function parsedCall(item: Record<string, unknown>) {
  return {
    id: String(item.id),
    callId: String(item.call_id),
    name: String(item.name),
    argumentsText: String(item.arguments),
    argumentsJsonParseStatus: "parsed" as const,
    argumentsJson: JSON.parse(String(item.arguments)) as Record<string, unknown>,
  };
}

function succeededToolResult(overrides: Partial<Extract<ToolExecutionResult, { status: "succeeded" }>> = {}): ToolExecutionResult {
  return {
    status: "succeeded",
    toolId: "createSlides",
    capabilityId: "coze_ppt",
    artifactDraft: {
      nodeKey: "slide_deck",
      kind: "pptx",
      title: "水循环课件",
      summary: "已生成。",
      markdownContent: "# 水循环课件",
    },
    assistantSummary: "课件已生成，可以检查。",
    budgetEvent: {
      capabilityId: "coze_ppt",
      actionKey: "createSlides:pptx",
      status: "succeeded",
      kind: "tool_succeeded",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
    ...overrides,
  };
}

function nonSucceededToolResult(status: "failed" | "retryable_failed" | "needs_input"): ToolExecutionResult {
  if (status === "needs_input") {
    return {
      status: "needs_input",
      toolId: "createSlides",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      assistantPrompt: "请先确认课件设计稿。",
      observation: observation(status),
      artifactCreated: false,
      budgetEvent: budgetEvent("blocked", "blocked_by_policy"),
    };
  }

  return {
    status,
    toolId: "createSlides",
    capabilityId: "coze_ppt",
    observation: observation(status),
    artifactCreated: false,
    errorCategory: "provider",
    budgetEvent: budgetEvent(status === "failed" ? "failed" : "retryable_failed", "tool_failed"),
  };
}

function observation(status: "failed" | "retryable_failed" | "needs_input"): Extract<ToolExecutionResult, { status: "failed" | "retryable_failed" }>["observation"] {
  return {
      observationId: "obs_failed_tool",
      projectId: "server-project",
      capabilityId: "coze_ppt",
      expectedArtifactKind: "pptx",
      kind: status === "needs_input" ? "blocked_by_policy" : "tool_failed",
      status: "active",
      teacherSafeSummary: "这一步暂时没有完成，可以稍后重试。",
      internalReasonSanitized: "tool_failed",
      retryPolicy: { retryable: true, nextAction: "retry_later" },
      artifactCreated: false,
      dedupeKey: "server-project:coze_ppt:tool_failed:pptx",
      createdAt: "2026-07-10T00:00:00.000Z",
  };
}

function budgetEvent(status: "blocked" | "failed" | "retryable_failed", kind: "blocked_by_policy" | "tool_failed") {
  return {
    capabilityId: "coze_ppt",
    actionKey: "createSlides:pptx",
    status,
    kind,
    createdAt: "2026-07-10T00:00:00.000Z",
  };
}

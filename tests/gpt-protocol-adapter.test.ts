import { describe, expect, it } from "vitest";
import { createOpenAIResponsesGptAdapter } from "@/server/gpt-protocol/openai-responses-adapter";
import { classifyGptProviderCapability } from "@/server/gpt-protocol/model-capability-probe";

describe("GptProtocolAdapter", () => {
  it("returns assistant text from OpenAI Responses output_text", async () => {
    const client = fakeResponsesClient({ output_text: "老师您好，这是生成结果。" });
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({
      instructions: "只输出教师可读内容。",
      input: "生成一段导入语。",
      text: { format: { type: "text" } },
      reasoning: { effort: "high" },
    });

    expect(client.lastPayload).toEqual({
      model: "test-model",
      instructions: "只输出教师可读内容。",
      input: "生成一段导入语。",
      stream: true,
      text: { format: { type: "text" } },
      reasoning: { effort: "high" },
    });
    expect(response.assistantText).toBe("老师您好，这是生成结果。");
    expect(response.rawText).toBe("老师您好，这是生成结果。");
    expect(response.diagnostics.status).toBe("succeeded");
  });

  it("maps tool request fields to OpenAI Responses payload names and prefers inputItems", async () => {
    const client = fakeResponsesClient({ output_text: "已收到工具配置。" });
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });
    const tools = [
      {
        type: "function",
        name: "createSlides",
        description: "生成课堂 PPT。",
        parameters: {
          type: "object",
          properties: { topic: { type: "string" } },
          required: ["topic"],
          additionalProperties: false,
        },
        strict: true,
      },
    ];
    const inputItems = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "生成水循环课件。" }] },
    ];

    await adapter.createResponse({
      instructions: "只输出教师可读内容。",
      input: "不应被 adapter 作为 Responses input。",
      inputItems,
      tools,
      toolChoice: "auto",
      parallelToolCalls: false,
      text: { format: { type: "text" } },
    });

    expect(client.lastPayload).toEqual({
      model: "test-model",
      instructions: "只输出教师可读内容。",
      input: inputItems,
      stream: true,
      text: { format: { type: "text" } },
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
  });

  it("streams text before the final response and records cache telemetry", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = fakeStreamingResponsesClient([
      { type: "response.created", response: { id: "resp_1" } },
      { type: "response.output_text.delta", delta: "老师" },
      { type: "response.output_text.delta", delta: "您好" },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          output_text: "老师您好",
          output: [],
          usage: {
            input_tokens: 1200,
            output_tokens: 8,
            total_tokens: 1208,
            input_tokens_details: { cached_tokens: 1024, cache_write_tokens: 128 },
          },
        },
      },
    ]);
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({
      instructions: "stable",
      input: "dynamic",
      promptCacheKey: "shanhai-main-agent:v1",
      previousResponseId: "resp_previous",
      onStreamEvent: (event) => { events.push(event); },
    });

    expect(client.lastPayload).toMatchObject({
      stream: true,
      prompt_cache_key: "shanhai-main-agent:v1",
      previous_response_id: "resp_previous",
    });
    expect(events.map((event) => event.type)).toEqual([
      "response_started",
      "text_delta",
      "text_delta",
      "response_completed",
    ]);
    expect(events[1]).toMatchObject({ type: "text_delta", delta: "老师" });
    expect(response).toMatchObject({
      assistantText: "老师您好",
      responseId: "resp_1",
      usage: { cachedTokens: 1024, cacheWriteTokens: 128 },
      telemetry: { streamed: true, chunkCount: 4, textBytes: 12, timeToFirstTextMs: expect.any(Number) },
    });
  });

  it("keeps function argument deltas separate from teacher-visible text deltas", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = fakeStreamingResponsesClient([
      { type: "response.created", response: { id: "resp_tool" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"topic":"百分数"}' },
      {
        type: "response.completed",
        response: {
          id: "resp_tool",
          output_text: "",
          output: [{ type: "function_call", call_id: "call_1", name: "create_lesson", arguments: '{"topic":"百分数"}' }],
        },
      },
    ]);
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({
      instructions: "stable",
      input: "dynamic",
      onStreamEvent: (event) => { events.push(event); },
    });

    expect(events.filter((event) => event.type === "text_delta")).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "function_call_arguments_delta",
      itemId: "fc_1",
    }));
    expect(response.functionCalls[0]).toMatchObject({ name: "create_lesson", callId: "call_1" });
  });

  it("parses function_call output items into protocol functionCalls", async () => {
    const argumentsText = JSON.stringify({ topic: "水循环", slideCount: 6 });
    const client = fakeResponsesClient({
      output_text: "",
      output: [
        {
          id: "fc_1",
          type: "function_call",
          status: "completed",
          call_id: "call_create_slides_1",
          name: "createSlides",
          arguments: argumentsText,
        },
      ],
    });
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });

    expect(response.functionCalls).toEqual([
      {
        id: "fc_1",
        callId: "call_create_slides_1",
        name: "createSlides",
        argumentsText,
        argumentsJsonParseStatus: "parsed",
        argumentsJson: { topic: "水循环", slideCount: 6 },
      },
    ]);
  });

  it("classifies invalid and missing function_call arguments safely", async () => {
    const client = fakeResponsesClient({
      output_text: "",
      output: [
        {
          type: "function_call",
          call_id: "call_missing",
          name: "createSlides",
          arguments: "   ",
        },
        {
          type: "function_call",
          call_id: "call_invalid_json",
          name: "createSlides",
          arguments: "{not-json",
        },
        {
          type: "function_call",
          call_id: "call_non_object",
          name: "createSlides",
          arguments: JSON.stringify(["topic"]),
        },
      ],
    });
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });

    expect(response.functionCalls.map((call) => [call.callId, call.argumentsJsonParseStatus])).toEqual([
      ["call_missing", "missing"],
      ["call_invalid_json", "invalid_json"],
      ["call_non_object", "invalid_json"],
    ]);
    expect(response.functionCalls).not.toEqual(expect.arrayContaining([expect.objectContaining({ argumentsJson: expect.anything() })]));
  });

  it("summarizes output items without preserving full text or arguments", async () => {
    const client = fakeResponsesClient({
      output_text: "摘要文本",
      output: [
        {
          id: "msg_1",
          type: "message",
          status: "completed",
          content: [{ type: "output_text", text: "这里是很长的模型全文，不能进入摘要。" }],
        },
        {
          id: "tool_1",
          type: "function_call",
          status: "completed",
          name: "createSlides",
          arguments: JSON.stringify({ apiKey: "sk-secret", fullPrompt: "不要保存完整参数" }),
        },
      ],
    });
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });

    expect(response.outputItemsSummary).toEqual([
      { id: "msg_1", type: "message", status: "completed" },
      { id: "tool_1", type: "function_call", status: "completed", name: "createSlides" },
    ]);
    expect(JSON.stringify(response.outputItemsSummary)).not.toContain("模型全文");
    expect(JSON.stringify(response.outputItemsSummary)).not.toContain("sk-secret");
    expect(JSON.stringify(response.outputItemsSummary)).not.toContain("fullPrompt");
    expect(JSON.stringify(response.outputItemsSummary)).not.toContain("不要保存完整参数");
  });

  it("sanitizes diagnostics when provider errors include secrets", async () => {
    const client = fakeFailingResponsesClient(
      new Error("Request failed: Bearer sk-live-secret credential=abc123 baseURL=https://secret.example/v1"),
    );
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });
    const diagnosticsText = JSON.stringify(response.diagnostics);

    expect(response.diagnostics.status).toBe("failed");
    expect(response.diagnostics.errorMessage).toContain("[redacted]");
    expect(diagnosticsText).not.toContain("sk-live-secret");
    expect(diagnosticsText).not.toContain("Bearer");
    expect(diagnosticsText).not.toContain("abc123");
    expect(diagnosticsText).not.toContain("secret.example");
  });

  it("sanitizes diagnostics when provider errors include local paths", async () => {
    const client = fakeFailingResponsesClient(
      new Error("Failed writing C:\\Users\\HB\\secret\\out.json and file:///D:/tmp/request.log then /home/hb/token.txt"),
    );
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });
    const diagnosticsText = JSON.stringify(response.diagnostics);

    expect(response.diagnostics.status).toBe("failed");
    expect(diagnosticsText).toContain("[redacted-path]");
    expect(diagnosticsText).not.toContain("C:\\Users\\HB");
    expect(diagnosticsText).not.toContain("file:///D:/tmp/request.log");
    expect(diagnosticsText).not.toContain("/home/hb/token.txt");
  });

  it("sanitizes diagnostics when local paths contain spaces", async () => {
    const client = fakeFailingResponsesClient(
      new Error("Failed at \"C:\\Users\\HB\\Secret Folder\\out file.json\" and '/home/hb/My Folder/token file.txt'"),
    );
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });
    const diagnosticsText = JSON.stringify(response.diagnostics);

    expect(diagnosticsText).toContain("[redacted-path]");
    expect(diagnosticsText).not.toContain("Secret Folder");
    expect(diagnosticsText).not.toContain("My Folder");
    expect(diagnosticsText).not.toContain("out file.json");
    expect(diagnosticsText).not.toContain("token file.txt");
  });

  it("sanitizes diagnostics when unquoted local paths contain spaces and no extension", async () => {
    const client = fakeFailingResponsesClient(
      new Error("Failed at C:\\Users\\HB\\Secret Folder\\cache and /home/hb/My Folder/cache"),
    );
    const adapter = createOpenAIResponsesGptAdapter({ client, model: "test-model" });

    const response = await adapter.createResponse({ instructions: "i", input: "x" });
    const diagnosticsText = JSON.stringify(response.diagnostics);

    expect(diagnosticsText).toContain("[redacted-path]");
    expect(diagnosticsText).not.toContain("Secret Folder");
    expect(diagnosticsText).not.toContain("My Folder");
    expect(diagnosticsText).not.toContain("Folder\\cache");
    expect(diagnosticsText).not.toContain("Folder/cache");
  });
});

describe("classifyGptProviderCapability", () => {
  it("classifies responses_full", () => {
    expect(
      classifyGptProviderCapability({ responsesAvailable: true, structuredOutputAvailable: true, textOutputAvailable: true }),
    ).toBe("responses_full");
  });

  it("classifies responses_text_only", () => {
    expect(classifyGptProviderCapability({ responsesAvailable: true, textOutputAvailable: true })).toBe("responses_text_only");
  });

  it("classifies chat_completions_only", () => {
    expect(classifyGptProviderCapability({ chatCompletionsAvailable: true })).toBe("chat_completions_only");
  });

  it("classifies unavailable", () => {
    expect(classifyGptProviderCapability({})).toBe("unavailable");
  });
});

function fakeResponsesClient(response: Record<string, unknown>) {
  const client = {
    lastPayload: undefined as Record<string, unknown> | undefined,
    responses: {
      async create(payload: Record<string, unknown>) {
        client.lastPayload = payload;
        return response;
      },
    },
  };
  return client;
}

function fakeStreamingResponsesClient(events: Array<Record<string, unknown>>) {
  const client = {
    lastPayload: undefined as Record<string, unknown> | undefined,
    responses: {
      async create(payload: Record<string, unknown>) {
        client.lastPayload = payload;
        return {
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
        };
      },
    },
  };
  return client;
}

function fakeFailingResponsesClient(error: Error) {
  return {
    responses: {
      async create() {
        throw error;
      },
    },
  };
}

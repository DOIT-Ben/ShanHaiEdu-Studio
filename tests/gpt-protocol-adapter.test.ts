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
    });

    expect(client.lastPayload).toEqual({
      model: "test-model",
      instructions: "只输出教师可读内容。",
      input: "生成一段导入语。",
      text: { format: { type: "text" } },
    });
    expect(response.assistantText).toBe("老师您好，这是生成结果。");
    expect(response.rawText).toBe("老师您好，这是生成结果。");
    expect(response.diagnostics.status).toBe("succeeded");
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

function fakeFailingResponsesClient(error: Error) {
  return {
    responses: {
      async create() {
        throw error;
      },
    },
  };
}

import type {
  GptFunctionCall,
  GptOutputItemSummary,
  GptProtocolDiagnostics,
  GptProtocolRequest,
  GptProtocolResponse,
  GptProtocolStreamEvent,
  GptProtocolTelemetry,
  GptProtocolUsage,
} from "./types";

type OpenAIResponsesAdapterClient = {
  responses: {
    create(payload: Record<string, unknown>): Promise<unknown>;
  };
};

type OpenAIResponsesGptAdapterOptions = {
  client: OpenAIResponsesAdapterClient;
  model: string;
};

type OpenAIResponsesGptAdapter = {
  createResponse(request: GptProtocolRequest): Promise<GptProtocolResponse>;
};

export function createOpenAIResponsesGptAdapter(options: OpenAIResponsesGptAdapterOptions): OpenAIResponsesGptAdapter {
  return {
    async createResponse(request) {
      const startedAtMs = Date.now();
      try {
        const rawResponse = await options.client.responses.create(createResponsesPayload(options.model, request));
        if (isAsyncIterable(rawResponse)) {
          return consumeResponseStream(rawResponse, request, options.model, startedAtMs);
        }
        const rawText = extractRawText(rawResponse);
        const usage = extractUsage(rawResponse);
        const telemetry = createTelemetry(startedAtMs, undefined, 0, rawText, false);

        return {
          assistantText: rawText,
          rawText,
          functionCalls: extractFunctionCalls(rawResponse),
          outputItems: extractOutputItems(rawResponse),
          outputItemsSummary: summarizeOutputItems(rawResponse),
          ...optionalResponseId(rawResponse),
          usage,
          telemetry,
          diagnostics: createDiagnostics("succeeded", options.model),
        };
      } catch (error) {
        const errorMessage = sanitizeDiagnosticText(extractErrorMessage(error));
        const telemetry = createTelemetry(startedAtMs, undefined, 0, "", true);
        await emitStreamEvent(request, { type: "response_failed", errorMessage, telemetry });
        return {
          assistantText: "",
          rawText: "",
          functionCalls: [],
          outputItems: [],
          outputItemsSummary: [],
          usage: emptyUsage(),
          telemetry,
          diagnostics: createDiagnostics("failed", options.model, errorMessage),
        };
      }
    },
  };
}

function createResponsesPayload(model: string, request: GptProtocolRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    instructions: request.instructions,
    input: request.inputItems ?? request.input,
    stream: true,
  };

  if (request.previousResponseId !== undefined) payload.previous_response_id = request.previousResponseId;
  if (request.promptCacheKey !== undefined) payload.prompt_cache_key = request.promptCacheKey;

  if (request.text !== undefined) {
    payload.text = request.text;
  }

  if (request.tools !== undefined) {
    payload.tools = request.tools;
  }

  if (request.toolChoice !== undefined) {
    payload.tool_choice = request.toolChoice;
  }

  if (request.parallelToolCalls !== undefined) {
    payload.parallel_tool_calls = request.parallelToolCalls;
  }

  if (request.reasoning !== undefined) {
    payload.reasoning = request.reasoning;
  }

  return payload;
}

async function consumeResponseStream(
  stream: AsyncIterable<unknown>,
  request: GptProtocolRequest,
  model: string,
  startedAtMs: number,
): Promise<GptProtocolResponse> {
  let firstEventAtMs: number | undefined;
  let firstTextAtMs: number | undefined;
  let chunkCount = 0;
  let rawText = "";
  let completedResponse: unknown;
  let responseId: string | undefined;
  let startedEmitted = false;

  for await (const value of stream) {
    if (!isRecord(value) || typeof value.type !== "string") continue;
    firstEventAtMs ??= Date.now();
    chunkCount += 1;
    if (value.type === "response.created" || value.type === "response.in_progress") {
      const response = isRecord(value.response) ? value.response : undefined;
      responseId = optionalString(response?.id) ?? responseId;
      if (!startedEmitted) {
        startedEmitted = true;
        await emitStreamEvent(request, { type: "response_started", ...(responseId ? { responseId } : {}) });
      }
      continue;
    }
    if (!startedEmitted) {
      startedEmitted = true;
      await emitStreamEvent(request, { type: "response_started", ...(responseId ? { responseId } : {}) });
    }
    if (value.type === "response.output_text.delta" && typeof value.delta === "string") {
      firstTextAtMs ??= Date.now();
      rawText += value.delta;
      await emitStreamEvent(request, { type: "text_delta", delta: value.delta });
      continue;
    }
    if (value.type === "response.function_call_arguments.delta" && typeof value.delta === "string") {
      await emitStreamEvent(request, {
        type: "function_call_arguments_delta",
        ...(optionalString(value.item_id) ? { itemId: optionalString(value.item_id) } : {}),
        delta: value.delta,
      });
      continue;
    }
    if (value.type === "response.completed") {
      completedResponse = value.response;
      responseId = optionalString(isRecord(value.response) ? value.response.id : undefined) ?? responseId;
      continue;
    }
    if (value.type === "response.failed" || value.type === "response.incomplete" || value.type === "error") {
      throw new Error(streamErrorMessage(value));
    }
  }

  const finalResponse = isRecord(completedResponse) ? completedResponse : {};
  rawText = extractRawText(finalResponse) || rawText;
  const usage = extractUsage(finalResponse);
  const telemetry = createTelemetry(startedAtMs, firstEventAtMs, chunkCount, rawText, true, firstTextAtMs);
  await emitStreamEvent(request, {
    type: "response_completed",
    ...(responseId ? { responseId } : {}),
    usage,
    telemetry,
  });
  return {
    assistantText: rawText,
    rawText,
    functionCalls: extractFunctionCalls(finalResponse),
    outputItems: extractOutputItems(finalResponse),
    outputItemsSummary: summarizeOutputItems(finalResponse),
    ...(responseId ? { responseId } : {}),
    usage,
    telemetry,
    diagnostics: createDiagnostics("succeeded", model),
  };
}

async function emitStreamEvent(request: GptProtocolRequest, event: GptProtocolStreamEvent) {
  try {
    await request.onStreamEvent?.(structuredClone(event));
  } catch {
    // Observability and UI projection must not change the Provider result.
  }
}

function extractUsage(rawResponse: unknown): GptProtocolUsage {
  const usage = isRecord(rawResponse) && isRecord(rawResponse.usage) ? rawResponse.usage : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  return {
    inputTokens: nonNegativeNumber(usage.input_tokens),
    outputTokens: nonNegativeNumber(usage.output_tokens),
    totalTokens: nonNegativeNumber(usage.total_tokens),
    cachedTokens: nonNegativeNumber(inputDetails.cached_tokens),
    cacheWriteTokens: nonNegativeNumber(inputDetails.cache_write_tokens),
  };
}

function emptyUsage(): GptProtocolUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
}

function createTelemetry(
  startedAtMs: number,
  firstEventAtMs: number | undefined,
  chunkCount: number,
  text: string,
  streamed: boolean,
  firstTextAtMs?: number,
): GptProtocolTelemetry {
  const completedAtMs = Date.now();
  return {
    streamed,
    startedAt: new Date(startedAtMs).toISOString(),
    ...(firstEventAtMs !== undefined ? {
      firstEventAt: new Date(firstEventAtMs).toISOString(),
      timeToFirstEventMs: Math.max(0, firstEventAtMs - startedAtMs),
    } : {}),
    ...(firstTextAtMs !== undefined ? {
      firstTextAt: new Date(firstTextAtMs).toISOString(),
      timeToFirstTextMs: Math.max(0, firstTextAtMs - startedAtMs),
    } : {}),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    chunkCount,
    textBytes: Buffer.byteLength(text, "utf8"),
  };
}

function streamErrorMessage(event: Record<string, unknown>) {
  if (isRecord(event.error) && typeof event.error.message === "string") return event.error.message;
  if (isRecord(event.response) && isRecord(event.response.error) && typeof event.response.error.message === "string") {
    return event.response.error.message;
  }
  return `Responses stream failed: ${String(event.type)}`;
}

function optionalResponseId(rawResponse: unknown) {
  const responseId = isRecord(rawResponse) ? optionalString(rawResponse.id) : undefined;
  return responseId ? { responseId } : {};
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object"
    && value !== null
    && Symbol.asyncIterator in value
    && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

function extractRawText(rawResponse: unknown): string {
  if (!isRecord(rawResponse)) {
    return "";
  }

  if (typeof rawResponse.output_text === "string") {
    return rawResponse.output_text;
  }

  return "";
}

function summarizeOutputItems(rawResponse: unknown): GptOutputItemSummary[] {
  if (!isRecord(rawResponse) || !Array.isArray(rawResponse.output)) {
    return [];
  }

  return rawResponse.output.filter(isRecord).map((item) => pickOutputItemSummary(item));
}

function extractOutputItems(rawResponse: unknown): unknown[] {
  if (!isRecord(rawResponse) || !Array.isArray(rawResponse.output)) {
    return [];
  }

  return rawResponse.output;
}

function extractFunctionCalls(rawResponse: unknown): GptFunctionCall[] {
  if (!isRecord(rawResponse) || !Array.isArray(rawResponse.output)) {
    return [];
  }

  return rawResponse.output.filter(isRecord).filter(isFunctionCallItem).map(parseFunctionCallItem);
}

function isFunctionCallItem(item: Record<string, unknown>): boolean {
  return item.type === "function_call";
}

function parseFunctionCallItem(item: Record<string, unknown>): GptFunctionCall {
  const argumentsText = typeof item.arguments === "string" ? item.arguments : "";
  const parsedArguments = parseFunctionCallArguments(argumentsText);
  return {
    ...(typeof item.id === "string" && item.id.trim().length > 0 ? { id: item.id } : {}),
    callId: typeof item.call_id === "string" ? item.call_id : "",
    name: typeof item.name === "string" ? item.name : "",
    argumentsText,
    argumentsJsonParseStatus: parsedArguments.status,
    ...(parsedArguments.argumentsJson ? { argumentsJson: parsedArguments.argumentsJson } : {}),
  };
}

function parseFunctionCallArguments(argumentsText: string): {
  status: GptFunctionCall["argumentsJsonParseStatus"];
  argumentsJson?: Record<string, unknown>;
} {
  if (argumentsText.trim().length === 0) {
    return { status: "missing" };
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (isPlainRecord(parsed)) {
      return { status: "parsed", argumentsJson: parsed };
    }
    return { status: "invalid_json" };
  } catch {
    return { status: "invalid_json" };
  }
}

function pickOutputItemSummary(item: Record<string, unknown>): GptOutputItemSummary {
  const summary: GptOutputItemSummary = {};
  copyStringField(item, summary, "id");
  copyStringField(item, summary, "type");
  copyStringField(item, summary, "status");
  copyStringField(item, summary, "name");
  copyStringField(item, summary, "role");
  return summary;
}

function copyStringField(source: Record<string, unknown>, target: GptOutputItemSummary, key: keyof GptOutputItemSummary): void {
  const value = source[key];
  if (typeof value === "string" && value.trim().length > 0) {
    target[key] = sanitizeDiagnosticText(value);
  }
}

function createDiagnostics(status: GptProtocolDiagnostics["status"], model: string, errorMessage?: string): GptProtocolDiagnostics {
  return {
    status,
    provider: "openai_responses",
    model: sanitizeDiagnosticText(model),
    ...(errorMessage ? { errorMessage } : {}),
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown provider error";
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/(["'])(?:file:\/\/\/?|)(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt)\/)[^"']+\1/g, "$1[redacted-path]$1")
    .replace(/file:\/\/\/?[^\n,;)]+?(?=\s+(?:and|then)\s+|[,;)]|$)/gi, "[redacted-path]")
    .replace(/\b[A-Za-z]:[\\/][^\n,;)]+?(?=\s+(?:and|then)\s+|[,;)]|$)/g, "[redacted-path]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt)\/[^\n,;)]+?(?=\s+(?:and|then)\s+|[,;)]|$)/g, "[redacted-path]")
    .replace(/file:\/\/\/?[^\n,;)]+?\.(?:json|log|txt|pptx|md|png|jpe?g|mp4|db)\b/gi, "[redacted-path]")
    .replace(/\b[A-Za-z]:[\\/][^\n,;)]+?\.(?:json|log|txt|pptx|md|png|jpe?g|mp4|db)\b/g, "[redacted-path]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt)\/[^\n,;)]+?\.(?:json|log|txt|pptx|md|png|jpe?g|mp4|db)\b/g, "[redacted-path]")
    .replace(/file:\/\/\/?[^\s,;)]+/gi, "[redacted-path]")
    .replace(/\b[A-Za-z]:[\\/][^\s,;)]+/g, "[redacted-path]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt)\/[^\s,;)]+/g, "[redacted-path]")
    .replace(/Bearer\s+[^\s,;]+/gi, "[redacted]")
    .replace(/\b(api[_-]?key|credential|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bbaseURL\s*[:=]\s*[^\s,;]+/gi, "baseURL=[redacted]")
    .replace(/https?:\/\/[^\s,;)]+/gi, "[redacted-url]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

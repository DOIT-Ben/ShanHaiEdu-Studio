import type { GptOutputItemSummary, GptProtocolDiagnostics, GptProtocolRequest, GptProtocolResponse } from "./types";

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
      try {
        const rawResponse = await options.client.responses.create({
          model: options.model,
          instructions: request.instructions,
          input: request.input,
          text: request.text,
        });
        const rawText = extractRawText(rawResponse);

        return {
          assistantText: rawText,
          rawText,
          outputItemsSummary: summarizeOutputItems(rawResponse),
          diagnostics: createDiagnostics("succeeded", options.model),
        };
      } catch (error) {
        return {
          assistantText: "",
          rawText: "",
          outputItemsSummary: [],
          diagnostics: createDiagnostics("failed", options.model, sanitizeDiagnosticText(extractErrorMessage(error))),
        };
      }
    },
  };
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

export type GptProviderCapabilityStatus =
  | "responses_full"
  | "responses_text_only"
  | "chat_completions_only"
  | "unavailable";

export type GptProtocolRequest = {
  instructions: string;
  input: string;
  inputItems?: unknown[];
  text?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  parallelToolCalls?: boolean;
  reasoning?: { effort: "low" | "medium" | "high" | "xhigh" };
  previousResponseId?: string;
  promptCacheKey?: string;
  onStreamEvent?: (event: GptProtocolStreamEvent) => void | Promise<void>;
};

export type GptProtocolStreamEvent =
  | { type: "response_started"; responseId?: string }
  | { type: "text_delta"; delta: string }
  | { type: "function_call_arguments_delta"; itemId?: string; delta: string }
  | { type: "response_completed"; responseId?: string; usage: GptProtocolUsage; telemetry: GptProtocolTelemetry }
  | { type: "response_failed"; errorMessage: string; telemetry: GptProtocolTelemetry };

export type GptProtocolUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
};

export type GptProtocolTelemetry = {
  streamed: boolean;
  startedAt: string;
  firstEventAt?: string;
  firstTextAt?: string;
  completedAt: string;
  timeToFirstEventMs?: number;
  timeToFirstTextMs?: number;
  durationMs: number;
  chunkCount: number;
  textBytes: number;
};

export type GptFunctionCall = {
  id?: string;
  callId: string;
  name: string;
  argumentsText: string;
  argumentsJsonParseStatus: "parsed" | "invalid_json" | "missing";
  argumentsJson?: Record<string, unknown>;
};

export type GptOutputItemSummary = {
  id?: string;
  type?: string;
  status?: string;
  name?: string;
  role?: string;
};

export type GptProtocolDiagnostics = {
  status: "succeeded" | "failed";
  provider: "openai_responses";
  model: string;
  errorMessage?: string;
};

export type GptProtocolResponse = {
  assistantText: string;
  rawText: string;
  functionCalls: GptFunctionCall[];
  outputItems: unknown[];
  outputItemsSummary: GptOutputItemSummary[];
  responseId?: string;
  usage: GptProtocolUsage;
  telemetry: GptProtocolTelemetry;
  diagnostics: GptProtocolDiagnostics;
};

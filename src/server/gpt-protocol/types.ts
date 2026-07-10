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
  diagnostics: GptProtocolDiagnostics;
};

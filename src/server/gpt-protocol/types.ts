export type GptProviderCapabilityStatus =
  | "responses_full"
  | "responses_text_only"
  | "chat_completions_only"
  | "unavailable";

export type GptProtocolRequest = {
  instructions: string;
  input: string;
  text?: unknown;
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
  outputItemsSummary: GptOutputItemSummary[];
  diagnostics: GptProtocolDiagnostics;
};

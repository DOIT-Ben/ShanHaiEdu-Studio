export type ContextBudgetMode = "full" | "precompact_async" | "compact_required";

export type EstimateContextTokensInput = {
  systemRules: string;
  messages: string[];
  artifacts: string[];
  snapshot?: string;
};

export function estimateContextTokens(input: EstimateContextTokensInput): number {
  const chars = [input.systemRules, input.snapshot ?? "", ...input.messages, ...input.artifacts]
    .filter((part) => part.trim().length > 0)
    .join("\n").length;
  return Math.max(1, Math.ceil(chars / 2));
}

export function resolveContextBudgetMode(input: { estimate: number; maxInputTokens: number }): ContextBudgetMode {
  const ratio = input.estimate / input.maxInputTokens;
  if (ratio >= 0.7) return "compact_required";
  if (ratio >= 0.4) return "precompact_async";
  return "full";
}

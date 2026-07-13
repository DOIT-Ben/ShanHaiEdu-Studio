export const generationIntensityIds = ["standard", "enhanced", "deep", "extreme"] as const;

export type GenerationIntensity = (typeof generationIntensityIds)[number];

export type GenerationIntensityStrategy = {
  intensity: GenerationIntensity;
  model: string;
  reasoningEffort: "medium" | "high" | "xhigh";
  relativeCost: "normal" | "higher" | "high" | "highest";
};

const strategies: Record<GenerationIntensity, GenerationIntensityStrategy> = {
  standard: { intensity: "standard", model: "gpt-5.6-terra", reasoningEffort: "medium", relativeCost: "normal" },
  enhanced: { intensity: "enhanced", model: "gpt-5.6-terra", reasoningEffort: "high", relativeCost: "higher" },
  deep: { intensity: "deep", model: "gpt-5.6-terra", reasoningEffort: "xhigh", relativeCost: "high" },
  extreme: { intensity: "extreme", model: "gpt-5.6-sol", reasoningEffort: "high", relativeCost: "highest" },
};

export function normalizeGenerationIntensity(value: unknown): GenerationIntensity {
  return generationIntensityIds.includes(value as GenerationIntensity) ? value as GenerationIntensity : "standard";
}

export function resolveGenerationIntensityStrategy(value: unknown): GenerationIntensityStrategy {
  return strategies[normalizeGenerationIntensity(value)];
}

export function nextGenerationIntensity(value: GenerationIntensity): GenerationIntensity | null {
  const index = generationIntensityIds.indexOf(value);
  return generationIntensityIds[index + 1] ?? null;
}

export function canSuggestGenerationIntensityUpgrade(input: {
  current: GenerationIntensity;
  consecutiveUnresolvedCount: number;
  retryBudgetExhausted?: boolean;
  constraintConflict?: boolean;
}) {
  if (input.current === "extreme") return { allowed: false as const, target: null, reason: "already_highest" };
  if (input.current === "deep" && input.consecutiveUnresolvedCount < 3 && !input.retryBudgetExhausted) {
    return { allowed: false as const, target: null, reason: "extreme_requires_sustained_failure" };
  }
  const hasSignal = input.consecutiveUnresolvedCount >= 2 || input.retryBudgetExhausted || input.constraintConflict;
  if (!hasSignal) return { allowed: false as const, target: null, reason: "insufficient_signal" };
  return {
    allowed: true as const,
    target: nextGenerationIntensity(input.current),
    reason: input.retryBudgetExhausted ? "retry_budget_exhausted" : input.constraintConflict ? "constraint_conflict" : "repeated_unresolved",
  };
}

export function deriveGenerationIntensitySuggestion(input: {
  current: GenerationIntensity;
  intentEpoch: number;
  recentJobs: Array<{ status: string; errorCode?: string | null }>;
}) {
  const completed = input.recentJobs.filter((job) => job.status !== "queued" && job.status !== "running");
  let consecutiveUnresolvedCount = 0;
  let signature = "turn_failed";
  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const job = completed[index];
    if (!job || job.status !== "failed") break;
    consecutiveUnresolvedCount += 1;
    signature = job.errorCode?.trim() || signature;
  }
  const decision = canSuggestGenerationIntensityUpgrade({ current: input.current, consecutiveUnresolvedCount });
  if (!decision.allowed || !decision.target) return null;
  return {
    target: decision.target,
    reason: decision.reason,
    signature: `${input.intentEpoch}:${signature}`,
  };
}

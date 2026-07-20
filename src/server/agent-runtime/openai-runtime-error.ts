import type { AgentRuntimeFailure } from "./types";

export class RuntimeFailureError extends Error {
  constructor(
    readonly category: AgentRuntimeFailure["category"],
    readonly retryable: boolean,
    readonly reasonCode?: string,
    readonly details: string[] = [],
  ) {
    super(reasonCode ?? category);
    this.name = "RuntimeFailureError";
  }
}

export function classifyRuntimeFailure(error: unknown): AgentRuntimeFailure {
  if (error instanceof RuntimeFailureError) {
    const reasonCode = error.reasonCode ?? providerRuntimeReasonCode(error.category);
    return {
      category: error.category,
      retryable: error.retryable,
      ...(reasonCode ? { reasonCode } : {}),
      ...(error.details.length ? { details: [...error.details] } : {}),
    };
  }
  const category = classifyProviderDiagnostic(error instanceof Error ? error.message : String(error));
  return {
    category,
    retryable: true,
    reasonCode: category === "timeout"
      ? "agent_runtime_timeout"
      : category === "network" ? "agent_runtime_network_failed" : "agent_runtime_provider_failed",
  };
}

export function providerRuntimeReasonCode(category: AgentRuntimeFailure["category"]): string | undefined {
  if (category === "timeout") return "agent_runtime_timeout";
  if (category === "network") return "agent_runtime_network_failed";
  if (category === "provider") return "agent_runtime_provider_failed";
  return undefined;
}

export function extractPptCandidateValidationDetails(error: unknown): string[] {
  if (!(error instanceof Error)) return [];
  const marker = "ppt_design_candidate_semantics_invalid:";
  const start = error.message.indexOf(marker);
  if (start < 0) return [];
  return [...new Set(error.message
    .slice(start + marker.length)
    .split(",")
    .map((detail) => detail.trim())
    .filter((detail) => /^[a-z0-9_:-]{1,120}$/.test(detail)))]
    .slice(0, 12);
}

export function classifyProviderDiagnostic(message: string | undefined): AgentRuntimeFailure["category"] {
  const normalized = message?.toLowerCase() ?? "";
  if (/timeout|timed out|deadline|aborterror/.test(normalized)) return "timeout";
  if (/econnreset|econnrefused|enotfound|dns|network|fetch failed|socket|disconnected/.test(normalized)) return "network";
  return "provider";
}

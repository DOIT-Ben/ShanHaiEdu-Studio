export type ToolInvocationTerminalStatus = "succeeded" | "failed" | "blocked";
export type ToolResultMode = "artifact_required" | "observation_only";

export function toolInvocationStatusForObservationStatus(
  observationStatus: string,
  eventKind?: string,
): ToolInvocationTerminalStatus | null {
  if (observationStatus === "succeeded") {
    return eventKind === "tool_observed" || eventKind === "artifact_committed" ? "succeeded" : null;
  }
  if (observationStatus === "needs_input") return eventKind === "decision_pending" ? "succeeded" : "blocked";
  if (observationStatus === "blocked") return eventKind === "tool_observed" ? "blocked" : null;
  if (observationStatus === "failed" || observationStatus === "repair" || observationStatus === "inconclusive") {
    return eventKind === "tool_observed" ? "failed" : null;
  }
  return null;
}

export function expectedToolTerminalEventKind(
  observationStatus: string,
  invocationStatus: ToolInvocationTerminalStatus,
  resultMode: ToolResultMode,
) {
  if (observationStatus === "succeeded" && invocationStatus === "succeeded") {
    return resultMode === "artifact_required" ? "artifact_committed" : "tool_observed";
  }
  if (observationStatus === "needs_input" && invocationStatus === "succeeded") {
    return "decision_pending";
  }
  return "tool_observed";
}

import type { MainAgentReActContextTelemetry } from "./main-agent-controlled-react-loop";

export type MainAgentToolExposureEvent = {
  sequence: number;
  event: "tools_exposed" | "tool_selected" | "tool_rejected" | "run_paused";
  intentEpoch: number;
  allowedToolNames: string[];
  selectedToolName?: string;
  rejectionReason?: "adapter_failed" | "repeated_tool_call" | "repeated_tool_failure" | "tool_round_limit_reached";
};

export function appendMainAgentToolExposureTrace(
  metadata: Record<string, unknown>,
  event: MainAgentToolExposureEvent,
) {
  return {
    ...metadata,
    mainAgentToolExposureTrace: [...readMainAgentToolExposureTrace(metadata), event].slice(-32),
  };
}

export function readMainAgentToolExposureTrace(metadata: unknown): MainAgentToolExposureEvent[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.mainAgentToolExposureTrace)) return [];
  return metadata.mainAgentToolExposureTrace.filter(isMainAgentToolExposureEvent);
}

export function appendMainAgentReActContextTelemetry(
  metadata: Record<string, unknown>,
  event: MainAgentReActContextTelemetry,
) {
  const existing = Array.isArray(metadata.mainAgentReActContextTelemetry)
    ? metadata.mainAgentReActContextTelemetry.filter(isMainAgentReActContextTelemetry)
    : [];
  return {
    ...metadata,
    mainAgentReActContextTelemetry: [...existing, structuredClone(event)].slice(-16),
  };
}

function isMainAgentToolExposureEvent(value: unknown): value is MainAgentToolExposureEvent {
  return isRecord(value) &&
    typeof value.sequence === "number" &&
    (value.event === "tools_exposed" || value.event === "tool_selected" ||
      value.event === "tool_rejected" || value.event === "run_paused") &&
    typeof value.intentEpoch === "number" &&
    Array.isArray(value.allowedToolNames) &&
    value.allowedToolNames.every((name) => typeof name === "string") &&
    (value.selectedToolName === undefined || typeof value.selectedToolName === "string") &&
    (value.rejectionReason === undefined || value.rejectionReason === "adapter_failed" ||
      value.rejectionReason === "repeated_tool_call" || value.rejectionReason === "repeated_tool_failure" ||
      value.rejectionReason === "tool_round_limit_reached");
}

function isMainAgentReActContextTelemetry(value: unknown): value is MainAgentReActContextTelemetry {
  return isRecord(value) &&
    (value.phase === "initial" || value.phase === "continuation") &&
    nonNegativeInteger(value.toolRound) &&
    positiveInteger(value.requestCharacters) &&
    positiveInteger(value.estimatedInputTokens) &&
    nonNegativeInteger(value.checkpointCharacters) &&
    nonNegativeInteger(value.checkpointObservationCount) &&
    nonNegativeInteger(value.toolCount) &&
    nonNegativeInteger(value.responseDurationMs);
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

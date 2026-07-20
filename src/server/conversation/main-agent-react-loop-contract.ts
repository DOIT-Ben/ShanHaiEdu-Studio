import type { GptProtocolRequest, GptProtocolResponse } from "@/server/gpt-protocol/types";
import type { MainAgentProgressSink } from "./main-agent-stream-projection";
import type {
  MainAgentReActCheckpoint,
  MainAgentReActCheckpointSeed,
  MainAgentReActContinuationObservation,
} from "./main-agent-react-checkpoint";

export type MainAgentReActAdapter = {
  createResponse(request: GptProtocolRequest): Promise<GptProtocolResponse>;
};

export type MainAgentReActDispatchResult = {
  status: "succeeded" | "failed" | "blocked" | "inconclusive";
  observation: MainAgentReActContinuationObservation;
  pauseKind?: "human_gate" | "dialogue_checkpoint";
};

export type MainAgentReActToolSet = {
  tools: unknown[];
  allowedToolNames: readonly string[];
};

export type MainAgentReActLoopOptions = {
  adapter: MainAgentReActAdapter;
  request: GptProtocolRequest;
  tools: unknown[];
  allowedToolNames: readonly string[];
  prepareTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
  refreshTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
  describeToolCall?: (call: { toolName: string; arguments: Record<string, unknown> }) => {
    purpose?: string;
    inputSummary?: string[];
    expectedOutput?: string;
  } | Promise<{
    purpose?: string;
    inputSummary?: string[];
    expectedOutput?: string;
  }>;
  dispatch: (call: { callId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<MainAgentReActDispatchResult>;
  validateCompletion?: () => MainAgentReActCompletionContract | Promise<MainAgentReActCompletionContract>;
  maxToolRounds?: number;
  maxToolRoundsPerSegment?: number;
  checkpointSeed?: MainAgentReActCheckpointSeed;
  getCheckpointSeed?: () => MainAgentReActCheckpointSeed;
  maxCheckpointTokens?: number;
  usePreviousResponseId?: boolean;
  resumeCheckpoint?: MainAgentReActCheckpoint;
  onContextTelemetry?: (event: MainAgentReActContextTelemetry) => void | Promise<void>;
  onRejectedToolCall?: (event: MainAgentReActRejectedToolCall) => void | Promise<void>;
  onBudgetExhausted?: (event: MainAgentReActBudgetExhausted) => void | Promise<void>;
  onSegmentCheckpoint?: (event: MainAgentReActSegmentCheckpoint) => void | Promise<void>;
  onRecoveryCheckpoint?: (event: MainAgentReActRecoveryCheckpoint) => void | Promise<void>;
  onProgress?: MainAgentProgressSink;
};

export type MainAgentReActRejectedToolCall = {
  toolName: string;
  toolRound: number;
  reason: "repeated_tool_call";
};

export type MainAgentReActBudgetExhausted = {
  reason: "tool_round_limit_reached";
  toolRoundsUsed: number;
  maxToolRounds: number;
  pendingToolName: string | null;
  observationIds: string[];
};

export type MainAgentReActSegmentCheckpoint = {
  segmentIndex: number;
  toolRoundsUsed: number;
  pendingToolName: string;
  observationIds: string[];
  checkpoint: MainAgentReActCheckpoint;
};

export type MainAgentReActRecoveryCheckpoint = {
  reason: "adapter_failed" | "completion_contract_unsatisfied" | "dialogue_checkpoint_required" | "human_gate_required" | "repeated_tool_call" | "repeated_tool_failure";
  toolRoundsUsed: number;
  observationIds: string[];
  checkpoint: MainAgentReActCheckpoint;
  remainingRequestedOutputs?: string[];
};

export type MainAgentReActCompletionContract = {
  status: "satisfied" | "unsatisfied";
  remainingRequestedOutputs: string[];
};

export type MainAgentReActContextTelemetry = {
  phase: "initial" | "continuation";
  toolRound: number;
  requestCharacters: number;
  estimatedInputTokens: number;
  checkpointCharacters: number;
  checkpointObservationCount: number;
  toolCount: number;
  responseDurationMs: number;
};

export type MainAgentReActLoopResult = {
  status: "completed" | "failed" | "blocked";
  assistantText: string;
  toolRoundsUsed: number;
  observationIds: string[];
  reason: "none" | "adapter_failed" | "checkpoint_persistence_failed" | "checkpoint_restore_failed" | "completion_contract_unsatisfied" | "control_plane_dispatch_failed" | "dialogue_checkpoint_required" | "human_gate_required" | "multiple_tool_calls_blocked" | "tool_call_invalid" | "tool_round_limit_reached" | "repeated_tool_call" | "repeated_tool_failure";
  diagnosticMessage?: string;
};

import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { GptFunctionCall, GptProtocolRequest } from "@/server/gpt-protocol/types";
import type { TargetLocator } from "@/server/quality/quality-types";

export const MAIN_AGENT_REACT_CHECKPOINT_VERSION = "react-checkpoint.v1" as const;

export type MainAgentReActCheckpointSeed = {
  projectId: string | null;
  taskId: string | null;
  taskBriefDigest: string | null;
  intentEpoch: number | null;
  planRevision: number;
  generationIntensity: GenerationIntensity | null;
  authorization: {
    standardWorkAuthorized: boolean;
    budgetPolicyVersion: string | null;
    maxCostCredits: number | null;
    maxExternalProviderCalls: number | null;
  };
};

export type MainAgentReActContinuationObservation = {
  observationId?: string;
  status: "succeeded" | "failed" | "blocked" | "inconclusive" | "repair" | "needs_input";
  reasonCodes: string[];
  summary?: string;
  artifactRefs?: Array<{
    artifactId: string;
    kind?: string;
    version?: number;
    digest?: string;
  }>;
  reportRefs?: Array<{
    id: string;
    kind?: string;
    digest?: string;
  }>;
  targetLocators?: TargetLocator[];
  nextAction?: string;
  advisoryNextToolIntents?: string[];
};

export type MainAgentReActRoundRecord = {
  round: number;
  toolName: string;
  callDigest: string;
  observation: MainAgentReActContinuationObservation;
};

type CompactedHistory = {
  omittedRounds: number;
  digest: string | null;
  statusCounts: Partial<Record<MainAgentReActContinuationObservation["status"], number>>;
  observationIds: string[];
};

export type MainAgentReActCheckpoint = {
  schemaVersion: typeof MAIN_AGENT_REACT_CHECKPOINT_VERSION;
  baseContextDigest: string;
  task: MainAgentReActCheckpointSeed;
  currentToolNames: string[];
  completedRounds: MainAgentReActRoundRecord[];
  compactedHistory: CompactedHistory;
  checkpointDigest: string;
};

export function createMainAgentReActCheckpoint(input: {
  request: GptProtocolRequest;
  seed?: MainAgentReActCheckpointSeed;
  records: MainAgentReActRoundRecord[];
  currentToolNames: readonly string[];
  maxEstimatedTokens?: number;
}): MainAgentReActCheckpoint {
  const maxEstimatedTokens = Math.max(800, input.maxEstimatedTokens ?? 4_000);
  const compactedHistory: CompactedHistory = {
    omittedRounds: 0,
    digest: null,
    statusCounts: {},
    observationIds: [],
  };
  let completedRounds = input.records.map(normalizeRoundRecord);
  let checkpoint = withCheckpointDigest({
    schemaVersion: MAIN_AGENT_REACT_CHECKPOINT_VERSION,
    baseContextDigest: hashRunInput({ instructions: input.request.instructions, input: input.request.input }),
    task: normalizeSeed(input.seed),
    currentToolNames: uniqueText(input.currentToolNames, 32, 120),
    completedRounds,
    compactedHistory,
  });

  while (estimateSerializedTokens(checkpoint) > maxEstimatedTokens && completedRounds.length > 3) {
    const [oldest, ...rest] = completedRounds;
    completedRounds = rest;
    foldRound(compactedHistory, oldest);
    checkpoint = withCheckpointDigest({ ...checkpoint, completedRounds, compactedHistory });
  }

  if (estimateSerializedTokens(checkpoint) > maxEstimatedTokens) {
    completedRounds = completedRounds.map((record) => ({
      ...record,
      observation: {
        ...record.observation,
        summary: record.observation.summary ? truncate(record.observation.summary, 120) : undefined,
        reasonCodes: record.observation.reasonCodes.slice(0, 6),
        artifactRefs: record.observation.artifactRefs?.slice(0, 4),
        reportRefs: record.observation.reportRefs?.slice(0, 4),
        targetLocators: record.observation.targetLocators?.slice(0, 4),
        advisoryNextToolIntents: record.observation.advisoryNextToolIntents?.slice(0, 4),
      },
    }));
    checkpoint = withCheckpointDigest({ ...checkpoint, completedRounds, compactedHistory });
  }

  return checkpoint;
}

export function buildMainAgentReActContinuationItems(input: {
  request: GptProtocolRequest;
  checkpoint: MainAgentReActCheckpoint;
  latestCall: GptFunctionCall;
}): unknown[] {
  const latestRound = input.checkpoint.completedRounds.at(-1);
  if (!latestRound) throw new Error("ReAct continuation requires a completed round.");
  return [
    { role: "user", content: input.request.input },
    {
      role: "user",
      content: JSON.stringify({
        type: "main_agent_react_checkpoint",
        checkpoint: input.checkpoint,
      }),
    },
    toFunctionCallItem(input.latestCall),
    {
      type: "function_call_output",
      call_id: input.latestCall.callId,
      output: JSON.stringify({
        status: latestRound.observation.status,
        observationId: latestRound.observation.observationId ?? null,
        checkpointDigest: input.checkpoint.checkpointDigest,
      }),
    },
  ];
}

export function measureMainAgentReActRequest(request: GptProtocolRequest) {
  const requestCharacters = JSON.stringify({
    instructions: request.instructions,
    input: request.inputItems ?? request.input,
    text: request.text,
    tools: request.tools,
    toolChoice: request.toolChoice,
    parallelToolCalls: request.parallelToolCalls,
    reasoning: request.reasoning,
  }).length;
  return {
    requestCharacters,
    estimatedInputTokens: Math.max(1, Math.ceil(requestCharacters / 2)),
  };
}

export function checkpointCharacters(checkpoint: MainAgentReActCheckpoint | undefined) {
  return checkpoint ? JSON.stringify(checkpoint).length : 0;
}

function normalizeRoundRecord(record: MainAgentReActRoundRecord): MainAgentReActRoundRecord {
  return {
    round: Math.max(1, Math.trunc(record.round)),
    toolName: truncate(record.toolName, 120),
    callDigest: truncate(record.callDigest, 128),
    observation: {
      ...(record.observation.observationId ? { observationId: truncate(record.observation.observationId, 160) } : {}),
      status: record.observation.status,
      reasonCodes: uniqueText(record.observation.reasonCodes, 12, 160),
      ...(record.observation.summary ? { summary: truncate(record.observation.summary, 360) } : {}),
      ...(record.observation.artifactRefs?.length ? { artifactRefs: record.observation.artifactRefs.slice(0, 12).map((ref) => ({
        artifactId: truncate(ref.artifactId, 160),
        ...(ref.kind ? { kind: truncate(ref.kind, 120) } : {}),
        ...(Number.isInteger(ref.version) ? { version: ref.version } : {}),
        ...(ref.digest ? { digest: truncate(ref.digest, 128) } : {}),
      })) } : {}),
      ...(record.observation.reportRefs?.length ? { reportRefs: record.observation.reportRefs.slice(0, 12).map((ref) => ({
        id: truncate(ref.id, 160),
        ...(ref.kind ? { kind: truncate(ref.kind, 80) } : {}),
        ...(ref.digest ? { digest: truncate(ref.digest, 128) } : {}),
      })) } : {}),
      ...(record.observation.targetLocators?.length ? { targetLocators: structuredClone(record.observation.targetLocators.slice(0, 12)) } : {}),
      ...(record.observation.nextAction ? { nextAction: truncate(record.observation.nextAction, 80) } : {}),
      ...(record.observation.advisoryNextToolIntents?.length ? {
        advisoryNextToolIntents: uniqueText(record.observation.advisoryNextToolIntents, 12, 120),
      } : {}),
    },
  };
}

function normalizeSeed(seed: MainAgentReActCheckpointSeed | undefined): MainAgentReActCheckpointSeed {
  return seed
    ? structuredClone(seed)
    : {
        projectId: null,
        taskId: null,
        taskBriefDigest: null,
        intentEpoch: null,
        planRevision: 0,
        generationIntensity: null,
        authorization: {
          standardWorkAuthorized: false,
          budgetPolicyVersion: null,
          maxCostCredits: null,
          maxExternalProviderCalls: null,
        },
      };
}

function foldRound(history: CompactedHistory, record: MainAgentReActRoundRecord) {
  history.omittedRounds += 1;
  history.digest = hashRunInput({ previous: history.digest, record });
  history.statusCounts[record.observation.status] = (history.statusCounts[record.observation.status] ?? 0) + 1;
  if (record.observation.observationId) {
    history.observationIds = [...history.observationIds, record.observation.observationId].slice(-32);
  }
}

function withCheckpointDigest(checkpoint: Omit<MainAgentReActCheckpoint, "checkpointDigest"> | MainAgentReActCheckpoint): MainAgentReActCheckpoint {
  const { checkpointDigest: _ignored, ...unsigned } = checkpoint as MainAgentReActCheckpoint;
  return { ...unsigned, checkpointDigest: hashRunInput(unsigned) };
}

function toFunctionCallItem(call: GptFunctionCall) {
  return {
    ...(call.id ? { id: call.id } : {}),
    type: "function_call",
    call_id: call.callId,
    name: call.name,
    arguments: call.argumentsText,
  };
}

function estimateSerializedTokens(value: unknown) {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 2));
}

function uniqueText(values: readonly string[], maxItems: number, maxLength: number) {
  return [...new Set(values.map((value) => truncate(value, maxLength)).filter(Boolean))].sort().slice(0, maxItems);
}

function truncate(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

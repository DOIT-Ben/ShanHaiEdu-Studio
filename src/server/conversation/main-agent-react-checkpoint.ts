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

export type MainAgentReActCompactedHistory = {
  omittedRounds: number;
  digest: string | null;
  statusCounts: Partial<Record<MainAgentReActContinuationObservation["status"], number>>;
  observationIds: string[];
};

export type MainAgentReActCheckpoint = {
  schemaVersion: typeof MAIN_AGENT_REACT_CHECKPOINT_VERSION;
  baseContextDigest: string;
  baseContextScope?: "request" | "task_identity";
  task: MainAgentReActCheckpointSeed;
  currentToolNames: string[];
  completedRounds: MainAgentReActRoundRecord[];
  externalObservations?: MainAgentReActContinuationObservation[];
  compactedHistory: MainAgentReActCompactedHistory;
  checkpointDigest: string;
};

export function createMainAgentReActCheckpoint(input: {
  request: GptProtocolRequest;
  seed?: MainAgentReActCheckpointSeed;
  records: MainAgentReActRoundRecord[];
  currentToolNames: readonly string[];
  maxEstimatedTokens?: number;
  compactedHistory?: MainAgentReActCompactedHistory;
  externalObservations?: MainAgentReActContinuationObservation[];
}): MainAgentReActCheckpoint {
  const maxEstimatedTokens = Math.max(800, input.maxEstimatedTokens ?? 4_000);
  const compactedHistory: MainAgentReActCompactedHistory = input.compactedHistory
    ? structuredClone(input.compactedHistory)
    : { omittedRounds: 0, digest: null, statusCounts: {}, observationIds: [] };
  let completedRounds = input.records.map(normalizeRoundRecord);
  const externalObservations = (input.externalObservations ?? [])
    .map(normalizeContinuationObservation)
    .slice(-12);
  const normalizedSeed = normalizeSeed(input.seed);
  const baseContextScope = hasTaskIdentity(normalizedSeed) ? "task_identity" as const : "request" as const;
  let checkpoint = withCheckpointDigest({
    schemaVersion: MAIN_AGENT_REACT_CHECKPOINT_VERSION,
    baseContextDigest: baseContextScope === "task_identity"
      ? taskIdentityDigest(normalizedSeed)
      : requestContextDigest(input.request),
    baseContextScope,
    task: normalizedSeed,
    currentToolNames: uniqueText(input.currentToolNames, 32, 120),
    completedRounds,
    externalObservations,
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

export function isMainAgentReActResumeContextCompatible(input: {
  checkpoint: MainAgentReActCheckpoint;
  request: GptProtocolRequest;
  seed?: MainAgentReActCheckpointSeed;
}) {
  const currentSeed = normalizeSeed(input.seed);
  if (input.checkpoint.baseContextScope === "task_identity") {
    return hasTaskIdentity(currentSeed) &&
      input.checkpoint.baseContextDigest === taskIdentityDigest(currentSeed) &&
      compatibleTaskSeed(input.checkpoint.task, currentSeed);
  }
  if (input.checkpoint.baseContextScope === "request") {
    return input.checkpoint.baseContextDigest === requestContextDigest(input.request);
  }
  // Legacy v1 checkpoints hashed the full dynamic request. Migrate only when the
  // signed checkpoint task identity still matches and the plan did not roll back.
  if (hasTaskIdentity(input.checkpoint.task) && hasTaskIdentity(currentSeed)) {
    return compatibleTaskSeed(input.checkpoint.task, currentSeed);
  }
  return input.checkpoint.baseContextDigest === requestContextDigest(input.request);
}

export function restoreMainAgentReActCheckpoint(checkpoint: MainAgentReActCheckpoint): MainAgentReActCheckpoint {
  if (!checkpoint || checkpoint.schemaVersion !== MAIN_AGENT_REACT_CHECKPOINT_VERSION) {
    throw new Error("Main Agent ReAct checkpoint version is invalid.");
  }
  const { checkpointDigest, ...unsigned } = checkpoint;
  if (!/^[a-f0-9]{64}$/i.test(checkpointDigest) || checkpointDigest !== hashRunInput(unsigned)) {
    throw new Error("Main Agent ReAct checkpoint digest is invalid.");
  }
  return structuredClone(checkpoint);
}

export function rebindMainAgentReActCheckpointAuthorization(
  checkpoint: MainAgentReActCheckpoint,
  authorization: MainAgentReActCheckpointSeed["authorization"],
): MainAgentReActCheckpoint {
  const restored = restoreMainAgentReActCheckpoint(checkpoint);
  const task = { ...restored.task, authorization: structuredClone(authorization) };
  return withCheckpointDigest({
    ...restored,
    task,
    baseContextDigest: restored.baseContextScope === "task_identity"
      ? taskIdentityDigest(task)
      : restored.baseContextDigest,
  });
}

export function buildMainAgentReActResumeItems(input: {
  request: GptProtocolRequest;
  checkpoint: MainAgentReActCheckpoint;
}): unknown[] {
  return [
    { role: "user", content: input.request.input },
    {
      role: "user",
      content: JSON.stringify({
        type: "main_agent_react_checkpoint_resume",
        checkpoint: input.checkpoint,
      }),
    },
  ];
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
    observation: normalizeContinuationObservation(record.observation),
  };
}

function normalizeContinuationObservation(
  observation: MainAgentReActContinuationObservation,
): MainAgentReActContinuationObservation {
  return {
    ...(observation.observationId ? { observationId: truncate(observation.observationId, 160) } : {}),
    status: observation.status,
    reasonCodes: uniqueText(observation.reasonCodes, 12, 160),
    ...(observation.summary ? { summary: truncate(observation.summary, 360) } : {}),
    ...(observation.artifactRefs?.length ? { artifactRefs: observation.artifactRefs.slice(0, 12).map((ref) => ({
      artifactId: truncate(ref.artifactId, 160),
      ...(ref.kind ? { kind: truncate(ref.kind, 120) } : {}),
      ...(Number.isInteger(ref.version) ? { version: ref.version } : {}),
      ...(ref.digest ? { digest: truncate(ref.digest, 128) } : {}),
    })) } : {}),
    ...(observation.reportRefs?.length ? { reportRefs: observation.reportRefs.slice(0, 12).map((ref) => ({
      id: truncate(ref.id, 160),
      ...(ref.kind ? { kind: truncate(ref.kind, 80) } : {}),
      ...(ref.digest ? { digest: truncate(ref.digest, 128) } : {}),
    })) } : {}),
    ...(observation.targetLocators?.length ? { targetLocators: structuredClone(observation.targetLocators.slice(0, 12)) } : {}),
    ...(observation.nextAction ? { nextAction: truncate(observation.nextAction, 80) } : {}),
    ...(observation.advisoryNextToolIntents?.length ? {
      advisoryNextToolIntents: uniqueText(observation.advisoryNextToolIntents, 12, 120),
    } : {}),
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

function requestContextDigest(request: GptProtocolRequest) {
  return hashRunInput({ instructions: request.instructions, input: request.input });
}

function taskIdentityDigest(seed: MainAgentReActCheckpointSeed) {
  return hashRunInput({
    projectId: seed.projectId,
    taskId: seed.taskId,
    taskBriefDigest: seed.taskBriefDigest,
    intentEpoch: seed.intentEpoch,
    generationIntensity: seed.generationIntensity,
    authorization: seed.authorization,
  });
}

function hasTaskIdentity(seed: MainAgentReActCheckpointSeed) {
  return Boolean(
    seed.projectId?.trim() &&
    seed.taskId?.trim() &&
    seed.taskBriefDigest?.match(/^[a-f0-9]{64}$/i) &&
    Number.isInteger(seed.intentEpoch) && Number(seed.intentEpoch) >= 0,
  );
}

function compatibleTaskSeed(checkpoint: MainAgentReActCheckpointSeed, current: MainAgentReActCheckpointSeed) {
  return checkpoint.projectId === current.projectId &&
    checkpoint.taskId === current.taskId &&
    checkpoint.taskBriefDigest === current.taskBriefDigest &&
    checkpoint.intentEpoch === current.intentEpoch &&
    checkpoint.generationIntensity === current.generationIntensity &&
    checkpoint.planRevision <= current.planRevision &&
    JSON.stringify(checkpoint.authorization) === JSON.stringify(current.authorization);
}

function foldRound(history: MainAgentReActCompactedHistory, record: MainAgentReActRoundRecord) {
  history.omittedRounds += 1;
  history.digest = hashRunInput({ previous: history.digest, record });
  history.statusCounts[record.observation.status] = (history.statusCounts[record.observation.status] ?? 0) + 1;
  if (record.observation.observationId) {
    history.observationIds = [...history.observationIds, record.observation.observationId].slice(-32);
  }
}

function withCheckpointDigest(checkpoint: Omit<MainAgentReActCheckpoint, "checkpointDigest"> | MainAgentReActCheckpoint): MainAgentReActCheckpoint {
  const unsigned: Omit<MainAgentReActCheckpoint, "checkpointDigest"> = {
    schemaVersion: checkpoint.schemaVersion,
    baseContextDigest: checkpoint.baseContextDigest,
    ...(checkpoint.baseContextScope ? { baseContextScope: checkpoint.baseContextScope } : {}),
    task: checkpoint.task,
    currentToolNames: checkpoint.currentToolNames,
    completedRounds: checkpoint.completedRounds,
    ...(checkpoint.externalObservations ? { externalObservations: checkpoint.externalObservations } : {}),
    compactedHistory: checkpoint.compactedHistory,
  };
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

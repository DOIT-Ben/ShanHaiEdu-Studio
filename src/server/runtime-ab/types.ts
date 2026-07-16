import { createHash } from "node:crypto";

import type { IntentGrant, TaskBrief } from "@/server/conversation/task-contract";

export type RuntimeAbToolName = string;

export type RuntimeAbToolParameters = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
  description?: string;
};

export type RuntimeAbToolDefinition = {
  type: "function";
  name: RuntimeAbToolName;
  description: string;
  parameters: RuntimeAbToolParameters;
  strict: true;
};

export type RuntimeAbObservation = {
  observationId: string;
  callId: string;
  toolName: RuntimeAbToolName;
  callDigest: string;
  argumentsDigest: string;
  idempotencyKey: string;
  status: "succeeded" | "failed";
  producedOutputs: string[];
  summary: string;
  reasonCode?: string;
};

export type RuntimeAbCheckpointScope = {
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
};

export type RuntimeAbCheckpoint = RuntimeAbCheckpointScope & {
  schemaVersion: "runtime-ab-checkpoint.v3";
  intensity: TaskBrief["generationIntensity"];
  taskBriefDigest: string;
  intentGrantDigest: string;
  currentToolSet: RuntimeAbToolName[];
  toolContractDigest: string;
  observations: RuntimeAbObservation[];
  checkpointDigest: string;
};

export type RuntimeAbCheckpointStore = {
  readonly durability: "durable";
  load(scope: RuntimeAbCheckpointScope): Promise<RuntimeAbCheckpoint | undefined>;
  save(checkpoint: RuntimeAbCheckpoint): Promise<void>;
};

export type RuntimeAbToolCall = {
  callId: string;
  toolName: RuntimeAbToolName;
  arguments: Record<string, unknown>;
};

export type RuntimeAbCallBinding = {
  callDigest: string;
  argumentsDigest: string;
};

export type RuntimeAbToolExecutionOutcome =
  | { status: "succeeded"; producedOutputs: string[]; summary: string }
  | { status: "failed"; reasonCode: string; summary: string };

export type RuntimeAbGateway = {
  execute(call: RuntimeAbToolCall): Promise<RuntimeAbObservation>;
};

export type RuntimeAbTraceEntry = {
  turn: number;
  callId: string;
  toolName: RuntimeAbToolName;
  arguments: Record<string, unknown>;
  callDigest: string;
  argumentsDigest: string;
  idempotencyKey: string;
  observationId: string;
  observationStatus: RuntimeAbObservation["status"];
};

export type RuntimeAbIsolation = {
  tracing: false;
  retries: 0;
  maxFunctionToolConcurrency: 1;
  maxTurns: 6;
  session: false;
  handoffs: false;
  websocket: false;
  sdkOwnsBusinessState: false;
};

export type RuntimeAbEvaluationProfile = RuntimeAbIsolation & {
  adoptionStatus: "evaluation_only";
  productionEligible: false;
};

export type RuntimeAbRunResult = {
  runtimeKind: "responses" | "agents_sdk";
  adoptionStatus: "evaluation_only" | "not_adopted";
  productionEligible: false;
  status: "completed" | "paused" | "failed";
  reasonCode?: string;
  finalSummary: string;
  trace: RuntimeAbTraceEntry[];
  checkpoint: RuntimeAbCheckpoint;
  requestCount: number;
  isolation: RuntimeAbIsolation;
};

export type RuntimeAbRunInput = {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  planRevision: number;
  gateway: RuntimeAbGateway;
  checkpointStore: RuntimeAbCheckpointStore;
};

export type RuntimeAbModelTurnInput = {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  observations: RuntimeAbObservation[];
  tools: RuntimeAbToolDefinition[];
};

export type RuntimeAbTurnDecision =
  | { kind: "tool"; call: RuntimeAbToolCall }
  | { kind: "complete"; summary: string }
  | { kind: "paused"; summary: string; reasonCode: string };

export type RuntimeAbAdapter = {
  readonly runtimeKind: "responses" | "agents_sdk";
  readonly profile: RuntimeAbEvaluationProfile;
  decide(input: RuntimeAbModelTurnInput): Promise<RuntimeAbTurnDecision>;
};

export type RuntimeAbResponsesRequest = RuntimeAbModelTurnInput & {
  tool_choice: "auto";
  parallel_tool_calls: false;
  retries: 0;
};

export type RuntimeAbResponsesResult = {
  output_text: string;
  output: Array<{
    type: "function_call";
    call_id: string;
    name: string;
    arguments: string;
  }>;
};

export type RuntimeAbResponsesClient = {
  responses: {
    create(request: RuntimeAbResponsesRequest): Promise<RuntimeAbResponsesResult>;
  };
};

export const RUNTIME_AB_EVALUATION_PROFILE: RuntimeAbEvaluationProfile = Object.freeze({
  adoptionStatus: "evaluation_only",
  productionEligible: false,
  tracing: false,
  retries: 0,
  maxFunctionToolConcurrency: 1,
  maxTurns: 6,
  session: false,
  handoffs: false,
  websocket: false,
  sdkOwnsBusinessState: false,
});

export const RUNTIME_AB_ISOLATION: RuntimeAbIsolation = Object.freeze({
  tracing: RUNTIME_AB_EVALUATION_PROFILE.tracing,
  retries: RUNTIME_AB_EVALUATION_PROFILE.retries,
  maxFunctionToolConcurrency: RUNTIME_AB_EVALUATION_PROFILE.maxFunctionToolConcurrency,
  maxTurns: RUNTIME_AB_EVALUATION_PROFILE.maxTurns,
  session: RUNTIME_AB_EVALUATION_PROFILE.session,
  handoffs: RUNTIME_AB_EVALUATION_PROFILE.handoffs,
  websocket: RUNTIME_AB_EVALUATION_PROFILE.websocket,
  sdkOwnsBusinessState: RUNTIME_AB_EVALUATION_PROFILE.sdkOwnsBusinessState,
});

export class RuntimeAbCheckpointError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeAbCheckpointError";
  }
}

export function assertRuntimeAbRunInput(input: RuntimeAbRunInput) {
  if (!input.checkpointStore || input.checkpointStore.durability !== "durable") {
    throw new Error("Runtime A/B requires a durable checkpoint store.");
  }
  if (!Number.isInteger(input.planRevision) || input.planRevision < 0) {
    throw new Error("Runtime A/B plan revision must be a non-negative integer.");
  }
  if (
    input.intentGrant.projectId !== input.taskBrief.projectId
    || input.intentGrant.taskId !== input.taskBrief.taskId
    || input.intentGrant.intentEpoch !== input.taskBrief.intentEpoch
    || input.intentGrant.intensity !== input.taskBrief.generationIntensity
  ) {
    throw new Error("Runtime A/B IntentGrant does not match the current TaskBrief.");
  }
}

export function assertRuntimeAbEvaluationProfile(profile: RuntimeAbEvaluationProfile) {
  if (!profile || profile.productionEligible !== false) {
    throw new Error("Runtime A/B profile must never be production eligible.");
  }
  if (
    profile.adoptionStatus !== "evaluation_only"
    || profile.tracing !== false
    || profile.retries !== 0
    || profile.maxFunctionToolConcurrency !== 1
    || profile.session !== false
    || profile.handoffs !== false
    || profile.websocket !== false
    || profile.sdkOwnsBusinessState !== false
  ) {
    throw new Error("Runtime A/B evaluation profile is invalid.");
  }
}

export function createRuntimeAbCheckpoint(input: {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  planRevision: number;
  toolDefinitions: readonly RuntimeAbToolDefinition[];
  observations: readonly RuntimeAbObservation[];
}): RuntimeAbCheckpoint {
  const currentToolSet = normalizedToolDefinitions(input.toolDefinitions).map((tool) => tool.name);
  const unsigned = {
    schemaVersion: "runtime-ab-checkpoint.v3" as const,
    projectId: input.taskBrief.projectId,
    taskId: input.taskBrief.taskId,
    intentEpoch: input.taskBrief.intentEpoch,
    planRevision: input.planRevision,
    intensity: input.taskBrief.generationIntensity,
    taskBriefDigest: input.taskBrief.digest,
    intentGrantDigest: digestRuntimeAbValue(input.intentGrant),
    currentToolSet,
    toolContractDigest: digestRuntimeAbValue(normalizedToolDefinitions(input.toolDefinitions)),
    observations: input.observations.map((observation) => structuredClone(observation)),
  };
  return { ...unsigned, checkpointDigest: digestRuntimeAbValue(unsigned) };
}

export function restoreRuntimeAbCheckpoint(input: {
  checkpoint?: RuntimeAbCheckpoint;
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  planRevision: number;
  toolDefinitions: readonly RuntimeAbToolDefinition[];
}): RuntimeAbObservation[] {
  const { checkpoint } = input;
  if (!checkpoint) return [];
  if (checkpoint.schemaVersion !== "runtime-ab-checkpoint.v3") {
    throw new RuntimeAbCheckpointError("checkpoint_version_mismatch", "Runtime A/B checkpoint version is invalid.");
  }
  const { checkpointDigest, ...unsigned } = checkpoint;
  if (!isDigest(checkpointDigest) || checkpointDigest !== digestRuntimeAbValue(unsigned)) {
    throw new RuntimeAbCheckpointError("checkpoint_digest_mismatch", "Runtime A/B checkpoint digest is invalid.");
  }
  if (checkpoint.projectId !== input.taskBrief.projectId || checkpoint.taskId !== input.taskBrief.taskId) {
    throw new RuntimeAbCheckpointError("checkpoint_task_mismatch", "Runtime A/B checkpoint project or task is stale.");
  }
  if (checkpoint.intentEpoch !== input.taskBrief.intentEpoch) {
    throw new RuntimeAbCheckpointError("checkpoint_intent_epoch_mismatch", "Runtime A/B checkpoint IntentEpoch is stale.");
  }
  if (checkpoint.planRevision !== input.planRevision) {
    throw new RuntimeAbCheckpointError("checkpoint_plan_revision_mismatch", "Runtime A/B checkpoint plan revision is stale.");
  }
  if (checkpoint.intensity !== input.taskBrief.generationIntensity) {
    throw new RuntimeAbCheckpointError("checkpoint_intensity_mismatch", "Runtime A/B checkpoint intensity is stale.");
  }
  if (checkpoint.taskBriefDigest !== input.taskBrief.digest) {
    throw new RuntimeAbCheckpointError("checkpoint_task_brief_mismatch", "Runtime A/B checkpoint TaskBrief digest is stale.");
  }
  if (checkpoint.intentGrantDigest !== digestRuntimeAbValue(input.intentGrant)) {
    throw new RuntimeAbCheckpointError("checkpoint_intent_grant_mismatch", "Runtime A/B checkpoint IntentGrant digest is stale.");
  }
  const expected = normalizedToolDefinitions(input.toolDefinitions);
  if (
    JSON.stringify(checkpoint.currentToolSet) !== JSON.stringify(expected.map((tool) => tool.name))
    || checkpoint.toolContractDigest !== digestRuntimeAbValue(expected)
  ) {
    throw new RuntimeAbCheckpointError("checkpoint_tool_set_mismatch", "Runtime A/B checkpoint Tool set is stale.");
  }
  for (const observation of checkpoint.observations) assertObservationBinding(observation);
  return structuredClone(checkpoint.observations);
}

export function createRuntimeAbCallBinding(call: Pick<RuntimeAbToolCall, "toolName" | "arguments">): RuntimeAbCallBinding {
  const normalized = { toolName: call.toolName.trim(), arguments: call.arguments };
  return {
    callDigest: digestRuntimeAbValue(normalized),
    argumentsDigest: digestRuntimeAbValue(call.arguments),
  };
}

export function runtimeAbCheckpointScope(input: Pick<RuntimeAbRunInput, "taskBrief" | "planRevision">): RuntimeAbCheckpointScope {
  return {
    projectId: input.taskBrief.projectId,
    taskId: input.taskBrief.taskId,
    intentEpoch: input.taskBrief.intentEpoch,
    planRevision: input.planRevision,
  };
}

export function isRuntimeAbToolName(value: string, toolDefinitions: readonly RuntimeAbToolDefinition[]): value is RuntimeAbToolName {
  return toolDefinitions.some((tool) => tool.name === value);
}

export function digestRuntimeAbValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function assertObservationBinding(observation: RuntimeAbObservation) {
  if (!isDigest(observation.callDigest) || !isDigest(observation.argumentsDigest) || !isDigest(observation.idempotencyKey)) {
    throw new RuntimeAbCheckpointError("checkpoint_observation_binding_invalid", "Runtime A/B checkpoint Observation binding is invalid.");
  }
}

function normalizedToolDefinitions(toolDefinitions: readonly RuntimeAbToolDefinition[]) {
  return toolDefinitions
    .map((tool) => structuredClone(tool))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isDigest(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort((left, right) => left.localeCompare(right))
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
}

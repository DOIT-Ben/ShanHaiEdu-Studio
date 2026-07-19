import type { Artifact, GenerationJob, RunInputSnapshot, ToolInvocationRecord } from "@/generated/prisma/client";
import { canonicalizeRunInput, hashRunInput } from "@/server/execution/run-input-snapshot";
import { isPersistedArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactAvailableForTaskBinding } from "@/server/quality/artifact-truth-boundary";
import { hasOrderedGenerationSourceKinds } from "@/server/tools/generation-source-binding";
import { resolveGenerationUnitBinding } from "./generation-unit-binding";

export function hasCompatibleArtifactPlanRevision(artifactPlanRevision: number, invocationPlanRevision: number) {
  return Number.isInteger(artifactPlanRevision) && artifactPlanRevision >= 0 &&
    artifactPlanRevision <= invocationPlanRevision;
}

export function matchesGenerationReplayContract(input: {
  invocation: ToolInvocationRecord;
  request: Record<string, unknown>;
  capabilityId: string;
  expectedGenerationKind: string;
  requiredArtifactKinds: readonly string[];
  primarySourceArtifactKind: string;
  sourceArtifacts: readonly Artifact[];
  generationJob: GenerationJob;
  snapshot: RunInputSnapshot;
}) {
  const common = readCommonGenerationBinding(input);
  if (!common) return false;
  const sourceArtifactId = text(input.request.sourceArtifactId);
  const sourceArtifactVersion = input.request.sourceArtifactVersion;
  const upstreamArtifactIds = input.request.upstreamArtifactIds === undefined
    ? []
    : textArray(input.request.upstreamArtifactIds);
  const sourceIds = sourceArtifactId && upstreamArtifactIds
    ? [sourceArtifactId, ...upstreamArtifactIds]
    : null;
  return sourceIds !== null && Number.isInteger(sourceArtifactVersion) &&
    input.generationJob.sourceArtifactId === sourceArtifactId &&
    equalTextArrays(common.sourceIds, sourceIds) &&
    common.payloadSource?.id === sourceArtifactId && common.payloadSource.version === sourceArtifactVersion &&
    matchesGenerationUnit("artifact_route", input.invocation.toolName, input.request, input.generationJob, common.payload);
}

export function matchesGenerationInvocationContract(input: {
  authority: string;
  invocation: ToolInvocationRecord;
  request: Record<string, unknown>;
  capabilityId: string;
  expectedGenerationKind: string;
  requiredArtifactKinds: readonly string[];
  primarySourceArtifactKind: string;
  sourceArtifacts: readonly Artifact[];
  generationJob: GenerationJob;
  snapshot: RunInputSnapshot;
}) {
  if (input.authority === "artifact_route") return matchesGenerationReplayContract(input);
  if (input.authority !== "main_agent") return false;
  const common = readCommonGenerationBinding(input);
  const envelope = parsedRecord(input.invocation.executionEnvelopeJson);
  const generationInput = common ? parsedRecord(common.payload.input) : null;
  const inputSources = generationInput && Array.isArray(generationInput.sourceArtifacts)
    ? generationInput.sourceArtifacts.map(parsedRecord)
    : null;
  try {
    return common !== null && generationInput !== null && envelope !== null &&
      input.generationJob.idempotencyKey === input.invocation.idempotencyKey &&
      input.generationJob.sourceArtifactId === common.sourceIds[0] &&
      generationInput.toolName === input.invocation.toolName &&
      canonicalizeRunInput(generationInput.arguments) === canonicalizeRunInput(input.request) &&
      generationInput.taskBriefDigest === envelope.taskBriefDigest &&
      generationInput.intentEpoch === input.invocation.intentEpoch && inputSources !== null &&
      inputSources.length === common.sourceIds.length && inputSources.every((source, index) =>
        source?.artifactId === common.sourceIds[index]) &&
      matchesGenerationUnit("main_agent", input.invocation.toolName, input.request, input.generationJob, common.payload);
  } catch {
    return false;
  }
}

function readCommonGenerationBinding(input: {
  invocation: ToolInvocationRecord;
  capabilityId: string;
  expectedGenerationKind: string;
  requiredArtifactKinds: readonly string[];
  primarySourceArtifactKind: string;
  sourceArtifacts: readonly Artifact[];
  generationJob: GenerationJob;
  snapshot: RunInputSnapshot;
}) {
  const sourceIds = parseTextArray(input.snapshot.sourceArtifactIdsJson);
  const payload = parsedRecord(input.snapshot.payloadJson);
  const payloadSource = payload ? parsedRecord(payload.sourceArtifact) : null;
  const envelope = parsedRecord(input.invocation.executionEnvelopeJson);
  const sourceDescriptors = payload ? readSourceDescriptors(payload) : null;
  const sourceArtifactById = new Map(input.sourceArtifacts.map((artifact) => [artifact.id, artifact]));
  try {
    if (!sourceIds || sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length ||
        !payload || !payloadSource || !envelope || !sourceDescriptors ||
        input.generationJob.projectId !== input.invocation.projectId ||
        input.generationJob.intentEpoch !== input.invocation.intentEpoch ||
        input.generationJob.kind !== input.expectedGenerationKind ||
        input.generationJob.sourceArtifactId !== sourceIds[0] ||
        input.generationJob.runInputSnapshotId !== input.snapshot.id ||
        input.generationJob.inputHash !== input.snapshot.inputHash ||
        input.snapshot.projectId !== input.invocation.projectId ||
        input.snapshot.intentEpoch !== input.invocation.intentEpoch ||
        input.snapshot.capabilityId !== input.capabilityId ||
        payload.projectId !== input.invocation.projectId || payload.intentEpoch !== input.invocation.intentEpoch ||
        payload.capabilityId !== input.capabilityId || payload.kind !== input.generationJob.kind ||
        !equalTextArrays(textArray(payload.sourceArtifactIds), sourceIds) ||
        payloadSource.id !== input.generationJob.sourceArtifactId ||
        sourceDescriptors.length !== sourceIds.length ||
        sourceDescriptors.some((descriptor, index) => descriptor.id !== sourceIds[index]) ||
        !hasOrderedGenerationSourceKinds({
          requiredArtifactKinds: input.requiredArtifactKinds,
          primarySourceArtifactKind: input.primarySourceArtifactKind,
          sourceKinds: sourceDescriptors.map((descriptor) => descriptor.kind),
        }) ||
        sourceIds.some((sourceId, index) => {
          const artifact = sourceArtifactById.get(sourceId);
          const descriptor = sourceDescriptors[index];
          return !artifact || artifact.projectId !== input.invocation.projectId ||
            !isArtifactAvailableForTaskBinding(artifact, {
              taskId: input.invocation.taskId,
              intentEpoch: input.invocation.intentEpoch,
              digest: String(envelope.taskBriefDigest),
            }) || !isPersistedArtifactTrustedForDownstream(artifact) || artifact.kind !== descriptor.kind ||
            artifact.version !== descriptor.version;
        }) ||
        input.requiredArtifactKinds.some((kind) =>
          !sourceIds.some((sourceId) => sourceArtifactById.get(sourceId)?.kind === kind)) ||
        canonicalizeRunInput(payload) !== input.snapshot.payloadJson ||
        hashRunInput(payload) !== input.snapshot.inputHash) {
      return null;
    }
    return { payload, payloadSource, sourceIds };
  } catch {
    return null;
  }
}

function readSourceDescriptors(payload: Record<string, unknown>) {
  const generationInput = parsedRecord(payload.input);
  if (!generationInput) return null;
  if (Array.isArray(generationInput.sourceArtifacts)) {
    return compactSourceDescriptors(
      generationInput.sourceArtifacts.map((value) => sourceDescriptor(value, "artifactId")),
    );
  }
  const source = sourceDescriptor(generationInput.source, "id");
  const upstream = Array.isArray(generationInput.upstream)
    ? generationInput.upstream.map((value) => sourceDescriptor(value, "id"))
    : [];
  return source ? compactSourceDescriptors([source, ...upstream]) : null;
}

function compactSourceDescriptors(values: Array<{ id: string; kind: string; version: number } | null>) {
  return values.every((value): value is { id: string; kind: string; version: number } => value !== null)
    ? values
    : null;
}

function sourceDescriptor(value: unknown, idKey: "id" | "artifactId") {
  const source = parsedRecord(value);
  const id = text(source?.[idKey]);
  const kind = text(source?.kind);
  const version = source?.version;
  return id && kind && Number.isInteger(version) ? { id, kind, version: version as number } : null;
}

function matchesGenerationUnit(
  authority: string,
  toolName: string,
  request: Record<string, unknown>,
  generationJob: GenerationJob,
  payload: Record<string, unknown>,
) {
  const binding = resolveGenerationUnitBinding({ authority, toolName, request });
  if (binding.kind === "invalid") return false;
  const expectedUnitId = binding.kind === "single" ? binding.unitId : null;
  const payloadUnitId = text(parsedRecord(payload.input)?.unitId);
  return generationJob.unitId === expectedUnitId && payloadUnitId === expectedUnitId;
}

function parsedRecord(value: unknown) {
  if (typeof value !== "string") {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim())
    ? value.map((item) => item.trim())
    : null;
}

function parseTextArray(value: string) {
  try {
    return textArray(JSON.parse(value));
  } catch {
    return null;
  }
}

function equalTextArrays(left: string[] | null, right: string[]) {
  return left !== null && left.length === right.length && left.every((value, index) => value === right[index]);
}

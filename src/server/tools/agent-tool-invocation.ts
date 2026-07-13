import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { ExecutionIdentitySnapshot } from "@/server/workbench/types";

export const AGENT_TOOL_INVOCATION_SCHEMA_VERSION = "agent-tool-invocation.v1" as const;

export type AgentToolInvocationEnvelope = {
  schemaVersion: typeof AGENT_TOOL_INVOCATION_SCHEMA_VERSION;
  invocationId: string;
  toolId: string;
  identity: ExecutionIdentitySnapshot;
  projectId: string;
  intentEpoch: number;
  sourceMessageId: string;
  reviewTargetRef: AgentToolReviewTargetRef | null;
  approvedArtifactRefs: AgentToolApprovedArtifactRef[];
  arguments: Record<string, unknown>;
  inputHash: string;
  actionDigest: string;
  requestedAt: string;
};

export type AgentToolArtifactRef = {
  artifactId: string;
  kind: string;
  version: number;
  digest: string;
};

export type AgentToolApprovedArtifactRef = AgentToolArtifactRef;
export type AgentToolReviewTargetRef = AgentToolArtifactRef;

export type CreateAgentToolInvocationEnvelopeInput = Omit<
  AgentToolInvocationEnvelope,
  "schemaVersion" | "inputHash" | "actionDigest" | "requestedAt" | "reviewTargetRef"
> & {
  requestedAt?: string;
  reviewTargetRef?: AgentToolReviewTargetRef | null;
};

export function createAgentToolInvocationEnvelope(
  input: CreateAgentToolInvocationEnvelopeInput,
): AgentToolInvocationEnvelope {
  const semanticInput = normalizeSemanticInput(input);
  const inputHash = hashAgentToolInvocationInput(semanticInput);
  return {
    ...semanticInput,
    inputHash,
    actionDigest: hashActionDigest(semanticInput, inputHash),
  };
}

export function hasValidAgentToolInvocationEnvelope(
  envelope: AgentToolInvocationEnvelope,
): boolean {
  try {
    if (envelope.schemaVersion !== AGENT_TOOL_INVOCATION_SCHEMA_VERSION) return false;
    const semanticInput = normalizeSemanticInput(envelope);
    const inputHash = hashAgentToolInvocationInput(semanticInput);
    return envelope.inputHash === inputHash && envelope.actionDigest === hashActionDigest(semanticInput, inputHash);
  } catch {
    return false;
  }
}

function hashAgentToolInvocationInput(
  input: Omit<AgentToolInvocationEnvelope, "inputHash" | "actionDigest">,
): string {
  const { requestedAt: _requestedAt, ...semantic } = input;
  return hashRunInput(semantic);
}

function hashActionDigest(
  input: Omit<AgentToolInvocationEnvelope, "inputHash" | "actionDigest">,
  inputHash: string,
) {
  return hashRunInput({
    projectId: input.projectId,
    intentEpoch: input.intentEpoch,
    toolId: input.toolId,
    sourceMessageId: input.sourceMessageId,
    inputHash,
  });
}

function normalizeSemanticInput(
  input: CreateAgentToolInvocationEnvelopeInput | AgentToolInvocationEnvelope,
): Omit<AgentToolInvocationEnvelope, "inputHash" | "actionDigest"> {
  const invocationId = requireText(input.invocationId, "invocationId");
  const toolId = requireText(input.toolId, "toolId");
  const projectId = requireText(input.projectId, "projectId");
  const actorUserId = requireText(input.identity.actorUserId, "identity.actorUserId");
  const sourceMessageId = requireText(input.sourceMessageId, "sourceMessageId");

  if (!Number.isInteger(input.intentEpoch) || input.intentEpoch < 0) {
    throw new Error("Agent Tool intentEpoch must be a non-negative integer.");
  }
  if (!input.arguments || typeof input.arguments !== "object" || Array.isArray(input.arguments)) {
    throw new Error("Agent Tool arguments must be an object.");
  }

  return {
    schemaVersion: AGENT_TOOL_INVOCATION_SCHEMA_VERSION,
    invocationId,
    toolId,
    identity: {
      actorUserId,
      actorAuthMode: input.identity.actorAuthMode,
      authSessionId: input.identity.authSessionId?.trim() || null,
    },
    projectId,
    intentEpoch: input.intentEpoch,
    sourceMessageId,
    reviewTargetRef: normalizeReviewTargetRef(input.reviewTargetRef),
    approvedArtifactRefs: normalizeApprovedArtifactRefs(input.approvedArtifactRefs),
    arguments: structuredClone(input.arguments),
    requestedAt: normalizeRequestedAt(input.requestedAt),
  };
}

function normalizeApprovedArtifactRefs(value: AgentToolApprovedArtifactRef[] | undefined): AgentToolApprovedArtifactRef[] {
  if (!Array.isArray(value)) throw new Error("Agent Tool approvedArtifactRefs are required.");
  return value
    .map((ref) => normalizeArtifactRef(ref, "approvedArtifactRefs"))
    .sort((a, b) => `${a.artifactId}:${a.version}:${a.kind}`.localeCompare(`${b.artifactId}:${b.version}:${b.kind}`));
}

function normalizeReviewTargetRef(value: AgentToolReviewTargetRef | null | undefined): AgentToolReviewTargetRef | null {
  return value == null ? null : normalizeArtifactRef(value, "reviewTargetRef");
}

function normalizeArtifactRef(value: AgentToolArtifactRef, field: string): AgentToolArtifactRef {
  const artifactId = requireText(value.artifactId, `${field}.artifactId`);
  const kind = requireText(value.kind, `${field}.kind`);
  if (!Number.isInteger(value.version) || value.version < 1) throw new Error(`Agent Tool ${field} version is invalid.`);
  if (!/^[a-f0-9]{64}$/i.test(value.digest)) throw new Error(`Agent Tool ${field} digest is invalid.`);
  return { artifactId, kind, version: value.version, digest: value.digest.toLowerCase() };
}

function normalizeRequestedAt(value: string | undefined) {
  const requestedAt = value?.trim() || new Date().toISOString();
  if (!Number.isFinite(Date.parse(requestedAt))) throw new Error("Agent Tool requestedAt is invalid.");
  return new Date(requestedAt).toISOString();
}

function requireText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Agent Tool ${field} is required.`);
  return normalized;
}

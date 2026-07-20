import type { BusinessSkillContext } from "@/server/agent-runtime/types";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import type { FinalPackageInspectors } from "@/server/package/versioned-final-package";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleCandidate, PptKeySampleSet, PptSampleApproval } from "@/server/ppt-quality/ppt-asset-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { PptFullDeckCandidate } from "@/server/ppt-quality/ppt-production-types";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import type { ArtifactRecord } from "@/server/workbench/types";

import type { ToolArtifactTruth, ToolDefinition, ToolExecutionResult } from "./tool-types";

export type PackageArtifactRef = {
  kind: string;
  artifactId: string;
};

export type PackageToolAdapterInput = {
  tool: ToolDefinition;
  projectId: string;
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  artifactRefs: PackageArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  sourceMessageId?: string;
  businessSkillContext?: BusinessSkillContext;
  runPptKeySampleAssembly?: (input: {
    designPackage: PptDesignPackage;
    requestBatch: PptAssetRequestBatch;
    manifest: PptAssetManifest;
  }) => Promise<PptKeySampleCandidate>;
  runPptFullDeckAssembly?: (input: {
    designPackage: PptDesignPackage;
    requestBatch: PptAssetRequestBatch;
    manifest: PptAssetManifest;
    sampleSet: PptKeySampleSet;
    sampleApproval: PptSampleApproval;
  }) => Promise<PptFullDeckCandidate>;
  finalPackageInspectors?: Partial<FinalPackageInspectors>;
};

export function findResolvedArtifacts(input: PackageToolAdapterInput, kind: string): ArtifactRecord[] {
  const refIds = new Set(
    input.artifactRefs
      .filter((ref) => ref.kind === kind && ref.artifactId.trim())
      .map((ref) => ref.artifactId),
  );
  return (input.resolvedArtifacts ?? []).filter(
    (artifact) =>
      refIds.has(artifact.id) &&
      artifact.projectId === input.projectId &&
      artifact.kind === kind &&
      artifact.nodeKey === kind &&
      isArtifactTrustedForDownstream(artifact),
  );
}

export function requireArtifact(input: PackageToolAdapterInput, kind: string): ArtifactRecord {
  const artifact = findResolvedArtifacts(input, kind)[0];
  if (!artifact) throw new Error(`missing_${kind}`);
  return artifact;
}

export function buildArtifactTruth(tool: ToolDefinition, fallbackKind: string): ToolArtifactTruth {
  return {
    created: true,
    persisted: true,
    persistenceScope: "provider_local_file",
    providerPersisted: true,
    workbenchPersisted: false,
    placeholder: false,
    producedArtifactKind: tool.producedArtifactKind ?? fallbackKind,
  };
}

export function buildFailureResult(
  input: PackageToolAdapterInput,
  kind: "tool_failed" | "quality_gate_failed",
  teacherSafeSummary: string,
  internalReason: string,
  errorCategory: string,
): ToolExecutionResult {
  const capabilityId = input.tool.capabilityId ?? "unknown";
  return {
    status: "failed",
    toolId: input.tool.id,
    capabilityId,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: input.tool.producedArtifactKind,
      kind,
      teacherSafeSummary,
      internalReasonSanitized: internalReason,
      retryPolicy: {
        retryable: false,
        nextAction: kind === "quality_gate_failed" ? "fix_inputs" : "skip_or_replan",
      },
    }),
    artifactCreated: false,
    errorCategory,
    budgetEvent: buildBudgetEvent(input.tool, "failed", kind),
  };
}

export function buildBudgetEvent(
  tool: ToolDefinition,
  status: "succeeded" | "failed",
  kind: "tool_succeeded" | "tool_failed" | "quality_gate_failed",
) {
  return buildAgentHarnessBudgetEvent({
    capabilityId: tool.capabilityId ?? "unknown",
    actionKey: `${tool.id}:${tool.producedArtifactKind ?? ""}`,
    expectedArtifactKind: tool.producedArtifactKind,
    status,
    kind,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

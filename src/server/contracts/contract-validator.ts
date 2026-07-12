import { randomUUID } from "node:crypto";

import type { ApprovedArtifactInput } from "@/server/agent-runtime/types";
import type { SaveArtifactDraft } from "@/server/capabilities/types";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type {
  CreateValidationReportInput,
  ValidationDomain,
  ValidationGateResult,
  ValidationOverallStatus,
  ValidationReport,
} from "@/server/quality/quality-types";
import type { ProviderArtifactRef } from "@/server/tools/provider-tool-adapter";
import type { ToolArtifactTruth, ToolDefinition, ToolQualityGateResult } from "@/server/tools/tool-types";
import type { ArtifactRecord } from "@/server/workbench/types";
import { validatePptDesignPackage } from "@/server/ppt-quality/ppt-design-validator";
import { validatePptAssetManifest } from "@/server/ppt-quality/ppt-asset-validator";
import type { PptAssetManifest, PptAssetRequestBatch } from "@/server/ppt-quality/ppt-asset-types";
import type { PptKeySampleCandidate } from "@/server/ppt-quality/ppt-asset-types";
import { validatePptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";
import type { PptFullDeckCandidate } from "@/server/ppt-quality/ppt-production-types";
import { validatePptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import type { PptDesignPackage, PptDesignValidationIssue } from "@/server/ppt-quality/ppt-quality-types";
import { resolveRuntimeContract } from "./runtime-contract";

const VALIDATOR_ID = "runtime_contract";
const VALIDATOR_VERSION = "v1";

type ToolResultForValidation = {
  status: string;
  artifactDraft?: SaveArtifactDraft;
  artifactTruth?: ToolArtifactTruth;
  qualityGate?: ToolQualityGateResult;
};

export function createValidationReport(input: CreateValidationReportInput): ValidationReport {
  const authority = input.authority ?? "deterministic";
  const semanticPayload = {
    authority,
    domain: input.domain,
    stage: input.stage,
    target: input.target,
    contract: input.contract,
    inputHash: input.inputHash,
    intentEpoch: input.intentEpoch,
    overallStatus: input.overallStatus,
    gates: input.gates,
  };

  return {
    ...input,
    authority,
    reportDigest: hashRunInput(semanticPayload),
  };
}

export function hasValidValidationReportDigest(report: ValidationReport): boolean {
  const { reportDigest, ...input } = report;
  return createValidationReport(input).reportDigest === reportDigest;
}

export function validateToolPreconditions(input: {
  tool: ToolDefinition;
  projectId: string;
  approvedArtifacts?: ApprovedArtifactInput[];
  artifactRefs?: ProviderArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  inputHash?: string;
  intentEpoch?: number;
}): ValidationReport {
  const contract = resolveRuntimeContract(input.tool);
  const gates = contract.requiredArtifactKinds.map((kind): ValidationGateResult => {
    const evidenceRef = approvedInputEvidence(kind, input);
    const passed = Boolean(evidenceRef);
    return gate({
      gateId: `required_input:${kind}`,
      status: passed ? "passed" : "failed",
      evidenceRefs: evidenceRef ? [evidenceRef] : [],
      locators: [{ kind: "input", artifactKind: kind }],
      stage: contract.capabilityId,
      reasonCode: passed ? undefined : "required_approved_input_missing",
    });
  });

  return createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: domainFor(contract.capabilityId),
    stage: contract.capabilityId,
    target: { kind: "tool_execution", targetId: input.tool.id },
    contract: { id: contract.id, version: contract.version },
    inputHash: input.inputHash,
    intentEpoch: input.intentEpoch,
    overallStatus: overallStatus(gates),
    gates,
  });
}

export function validateToolExecutionResult(input: {
  tool: ToolDefinition;
  projectId: string;
  result: ToolResultForValidation;
  inputHash?: string;
  intentEpoch?: number;
}): ValidationReport {
  const contract = resolveRuntimeContract(input.tool);
  const artifactDraft = input.result.artifactDraft;
  const gates: ValidationGateResult[] = [];

  if (input.result.status !== "succeeded" || !artifactDraft) {
    gates.push(gate({
      gateId: "execution_result",
      status: "failed",
      evidenceRefs: [],
      locators: [{ kind: "tool", toolId: input.tool.id }],
      stage: contract.capabilityId,
      reasonCode: "tool_execution_not_succeeded",
    }));
  } else {
    gates.push(gate({
      gateId: "output_kind",
      status: artifactDraft.kind === contract.outputArtifactKind ? "passed" : "failed",
      evidenceRefs: [`artifact_draft:${hashArtifactDraft(artifactDraft)}`],
      locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
      stage: contract.capabilityId,
      reasonCode: artifactDraft.kind === contract.outputArtifactKind ? undefined : "output_kind_mismatch",
    }));
    gates.push(gate({
      gateId: "output_node",
      status: artifactDraft.nodeKey === contract.outputNodeKey ? "passed" : "failed",
      evidenceRefs: [`artifact_draft:${hashArtifactDraft(artifactDraft)}`],
      locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
      stage: contract.capabilityId,
      reasonCode: artifactDraft.nodeKey === contract.outputNodeKey ? undefined : "output_node_mismatch",
    }));

    if (contract.capabilityId === "ppt_design") {
      gates.push(...validatePptQualityArtifact(artifactDraft));
    }

    if (contract.capabilityId === "ppt_sample_assets" || contract.capabilityId === "ppt_full_assets") {
      gates.push(...validatePptSampleAssetsArtifact(artifactDraft));
    }

    if (contract.capabilityId === "ppt_key_samples") {
      gates.push(validatePptKeySampleCandidateArtifact(artifactDraft));
    }

    if (contract.capabilityId === "ppt_full_deck" || contract.capabilityId === "ppt_page_repair") {
      gates.push(validatePptFullDeckCandidateArtifact(artifactDraft));
    }

    if (input.tool.adapterKind === "provider") {
      const truthPassed = hasVerifiedArtifactTruth(input.result.artifactTruth, contract.outputArtifactKind);
      gates.push(gate({
        gateId: "artifact_truth",
        status: truthPassed ? "passed" : "failed",
        evidenceRefs: truthPassed ? [`artifact_truth:${contract.outputArtifactKind}`] : [],
        locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
        stage: contract.capabilityId,
        reasonCode: truthPassed ? undefined : "artifact_truth_missing_or_unverified",
      }));

      const qualityPassed = input.result.qualityGate?.passed === true;
      gates.push(gate({
        gateId: "provider_quality_gate",
        status: qualityPassed ? "passed" : "failed",
        evidenceRefs: qualityPassed ? input.result.qualityGate?.gates.map((item) => `quality_gate:${item}`) ?? [] : [],
        locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
        stage: contract.capabilityId,
        reasonCode: qualityPassed ? undefined : "provider_quality_gate_missing_or_failed",
      }));
    }
  }

  const targetDigest = artifactDraft ? hashArtifactDraft(artifactDraft) : undefined;
  return createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: domainFor(contract.capabilityId),
    stage: contract.capabilityId,
    target: { kind: artifactDraft ? "artifact_draft" : "tool_execution", targetId: input.tool.id, targetDigest },
    contract: { id: contract.id, version: contract.version },
    inputHash: input.inputHash,
    intentEpoch: input.intentEpoch,
    overallStatus: overallStatus(gates),
    gates,
  });
}

function validatePptFullDeckCandidateArtifact(artifactDraft: SaveArtifactDraft): ValidationGateResult {
  const value = artifactDraft.structuredContent?.pptFullDeckCandidate;
  let passed = false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    try {
      passed = validatePptFullDeckCandidate(value as PptFullDeckCandidate);
    } catch {
      passed = false;
    }
  }
  return gate({
    gateId: "ppt_full_deck_candidate",
    status: passed ? "passed" : "failed",
    evidenceRefs: passed ? [`ppt_full_deck_candidate:${(value as PptFullDeckCandidate).candidateDigest}`] : [],
    locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
    stage: "ppt_full_deck",
    reasonCode: passed ? undefined : "ppt_full_deck_candidate_invalid",
  });
}

function validatePptKeySampleCandidateArtifact(artifactDraft: SaveArtifactDraft): ValidationGateResult {
  const value = artifactDraft.structuredContent?.pptKeySampleCandidate;
  let passed = false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    try {
      passed = validatePptKeySampleCandidate(value as PptKeySampleCandidate);
    } catch {
      passed = false;
    }
  }
  return gate({
    gateId: "ppt_key_sample_candidate",
    status: passed ? "passed" : "failed",
    evidenceRefs: passed ? [`ppt_key_sample_candidate:${(value as PptKeySampleCandidate).candidateDigest}`] : [],
    locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
    stage: "ppt_key_samples",
    reasonCode: passed ? undefined : "ppt_key_sample_candidate_invalid",
  });
}

function validatePptSampleAssetsArtifact(artifactDraft: SaveArtifactDraft): ValidationGateResult[] {
  const structuredContent = artifactDraft.structuredContent ?? {};
  const requestBatch = structuredContent.pptAssetRequestBatch;
  const manifest = structuredContent.pptAssetManifest;
  const batchPassed = isValidPptAssetRequestBatch(requestBatch);
  const gates = [gate({
    gateId: "ppt_asset_request_batch",
    status: batchPassed ? "passed" : "failed",
    evidenceRefs: batchPassed ? [`ppt_asset_request_batch:${(requestBatch as PptAssetRequestBatch).batchDigest}`] : [],
    locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
    stage: "ppt_sample_assets",
    reasonCode: batchPassed ? undefined : "ppt_asset_request_batch_invalid",
  })];

  let manifestPassed = false;
  if (batchPassed && manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    try {
      manifestPassed = validatePptAssetManifest(manifest as PptAssetManifest, requestBatch as PptAssetRequestBatch).valid;
    } catch {
      manifestPassed = false;
    }
  }
  gates.push(gate({
    gateId: "ppt_asset_manifest",
    status: manifestPassed ? "passed" : "failed",
    evidenceRefs: manifestPassed ? [`ppt_asset_manifest:${(manifest as PptAssetManifest).manifestDigest}`] : [],
    locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
    stage: "ppt_sample_assets",
    reasonCode: manifestPassed ? undefined : "ppt_asset_manifest_invalid",
  }));
  return gates;
}

function isValidPptAssetRequestBatch(value: unknown): value is PptAssetRequestBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const batch = value as Partial<PptAssetRequestBatch>;
  if (batch.schemaVersion !== "ppt-asset-request-batch.v1" || !batch.designPackageDigest?.trim() || !Array.isArray(batch.requests) || batch.requests.length === 0) return false;
  const { batchDigest, ...semanticBatch } = batch;
  return typeof batchDigest === "string" && hashRunInput(semanticBatch) === batchDigest;
}

function validatePptQualityArtifact(artifactDraft: SaveArtifactDraft): ValidationGateResult[] {
  const structuredContent = artifactDraft.structuredContent ?? {};
  const generationMode = structuredContent.generationMode;
  const modePassed = generationMode === "model_generated";
  const gates: ValidationGateResult[] = [gate({
    gateId: "ppt_quality_generation_mode",
    status: modePassed ? "passed" : "failed",
    evidenceRefs: modePassed ? ["generation_mode:model_generated"] : [],
    locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
    stage: "ppt_design",
    reasonCode: modePassed
      ? undefined
      : generationMode === "deterministic_draft"
        ? "deterministic_ppt_preview_only"
        : "ppt_generation_mode_missing",
  })];

  const packageValue = structuredContent.pptDesignPackage;
  if (!packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) {
    gates.push(gate({
      gateId: "ppt_design_package",
      status: "failed",
      evidenceRefs: [],
      locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
      stage: "ppt_design",
      reasonCode: "ppt_design_package_missing",
    }));
    return gates;
  }

  const validation = safelyValidatePptDesignPackage(packageValue);
  gates.push(gate({
    gateId: "ppt_design_package",
    status: validation.valid ? "passed" : "failed",
    evidenceRefs: validation.valid ? [`ppt_design_package:${hashRunInput(packageValue)}`] : [],
    locators: [{ kind: "artifact", artifactKind: artifactDraft.kind }],
    stage: "ppt_design",
    reasonCode: validation.valid ? undefined : "ppt_design_package_invalid",
  }));
  gates.push(...validation.issues.map((item) => gate({
    gateId: `ppt_design:${item.code}`,
    status: "failed",
    evidenceRefs: [],
    locators: [item.locator],
    stage: item.responsibleStage,
    reasonCode: item.code,
  })));
  return gates;
}

function safelyValidatePptDesignPackage(value: object): {
  valid: boolean;
  issues: PptDesignValidationIssue[];
} {
  try {
    return validatePptDesignPackage(value as PptDesignPackage);
  } catch {
    return {
      valid: false,
      issues: [{
        code: "ppt_design_package_malformed",
        message: "PPT design package cannot be parsed by the quality validator.",
        locator: { kind: "artifact", artifactKind: "ppt_design_draft" },
        responsibleStage: "ppt_page_design",
      }],
    };
  }
}

export function hashArtifactDraft(draft: SaveArtifactDraft): string {
  return hashRunInput({
    nodeKey: draft.nodeKey,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    markdownContent: draft.markdownContent ?? "",
    structuredContent: draft.structuredContent ?? {},
  });
}

function approvedInputEvidence(kind: string, input: {
  tool: ToolDefinition;
  projectId: string;
  approvedArtifacts?: ApprovedArtifactInput[];
  artifactRefs?: ProviderArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
}): string | undefined {
  if (input.tool.adapterKind === "provider" || input.tool.adapterKind === "package") {
    const ref = input.artifactRefs?.find((candidate) => candidate.kind === kind && candidate.artifactId.trim());
    if (!ref) return undefined;
    const artifact = input.resolvedArtifacts?.find((candidate) =>
      candidate.id === ref.artifactId &&
      candidate.projectId === input.projectId &&
      candidate.kind === kind &&
      candidate.nodeKey === kind &&
      (candidate.status === "approved" && candidate.isApproved === true || isRepairablePptCandidate(input.tool, candidate)),
    );
    return artifact ? `artifact:${artifact.id}:v${artifact.version}` : undefined;
  }

  const approved = input.approvedArtifacts?.find((candidate) => candidate.nodeKey === kind);
  if (approved) return `approved_artifact:${kind}`;
  const ref = input.artifactRefs?.find((candidate) => candidate.kind === kind && candidate.artifactId.trim());
  return ref ? `artifact_ref:${ref.artifactId}` : undefined;
}

function isRepairablePptCandidate(tool: ToolDefinition, artifact: ArtifactRecord): boolean {
  if (tool.capabilityId !== "ppt_page_repair" || artifact.kind !== "pptx_artifact" || artifact.nodeKey !== "pptx_artifact") return false;
  const candidate = artifact.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
  return Boolean(candidate && validatePptFullDeckCandidate(candidate) && artifact.status === "needs_review" && artifact.isApproved === false);
}

function hasVerifiedArtifactTruth(truth: ToolArtifactTruth | undefined, outputKind: string | undefined): boolean {
  return Boolean(
    truth?.created === true &&
    truth.persisted === true &&
    truth.placeholder === false &&
    truth.producedArtifactKind === outputKind,
  );
}

function gate(input: {
  gateId: string;
  status: ValidationGateResult["status"];
  evidenceRefs: string[];
  locators: ValidationGateResult["locators"];
  stage: string;
  reasonCode?: string;
}): ValidationGateResult {
  return {
    gateId: input.gateId,
    validatorId: VALIDATOR_ID,
    validatorVersion: VALIDATOR_VERSION,
    status: input.status,
    evidenceRefs: input.evidenceRefs,
    locators: input.locators,
    responsibleStage: input.stage,
    reasonCode: input.reasonCode,
  };
}

function overallStatus(gates: ValidationGateResult[]): ValidationOverallStatus {
  if (gates.some((item) => item.status === "failed")) return "failed";
  if (gates.some((item) => item.status === "inconclusive")) return "inconclusive";
  return "passed";
}

function domainFor(capabilityId: string): ValidationDomain {
  if (capabilityId.includes("ppt") || capabilityId === "image_asset") return "ppt";
  if (capabilityId.includes("video") || ["knowledge_anchor_extract", "creative_theme_generate", "storyboard_generate", "asset_brief_generate", "asset_image_generate", "concat_only_assemble"].includes(capabilityId)) return "video";
  if (capabilityId === "final_package") return "package";
  if (capabilityId === "requirement_spec" || capabilityId === "lesson_plan") return "lesson";
  return "generic";
}

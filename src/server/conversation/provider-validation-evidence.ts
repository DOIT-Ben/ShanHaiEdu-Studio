import type {
  Artifact,
  GenerationJob,
  ToolInvocationRecord,
  ValidationReportRecord,
} from "@/generated/prisma/client";
import {
  hasValidValidationReportDigest,
  hashArtifactDraft,
  validationDomainForCapability,
} from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import type { ValidationReport } from "@/server/quality/quality-types";
import type { SaveArtifactDraft } from "@/server/capabilities/types";

import { resolveServerToolDefinition } from "./tool-result-mode";

const requiredProviderSuccessGates = [
  "execution_result",
  "output_kind",
  "output_node",
  "artifact_truth",
  "provider_quality_gate",
] as const;

export function isValidProviderSuccessValidationReport(input: {
  invocation: ToolInvocationRecord;
  generationJob: GenerationJob;
  artifactDraft: SaveArtifactDraft;
  report: ValidationReport;
}) {
  try {
    const { invocation, generationJob, artifactDraft, report } = input;
    const tool = resolveServerToolDefinition(invocation.toolName);
    const contract = resolveRuntimeContract(tool);
    const gateIds = report.gates.map((gate) => gate.gateId);
    const gateById = new Map(report.gates.map((gate) => [gate.gateId, gate]));
    return tool.adapterKind === "provider" && hasValidValidationReportDigest(report) &&
      report.authority === "deterministic" && report.overallStatus === "passed" &&
      report.domain === validationDomainForCapability(contract.capabilityId) &&
      report.stage === contract.capabilityId && report.contract.id === contract.id &&
      report.contract.version === contract.version && report.target.kind === "artifact_draft" &&
      report.target.targetId === tool.id && report.target.targetVersion === undefined &&
      report.target.targetDigest === hashArtifactDraft(artifactDraft) &&
      report.inputHash === generationJob.inputHash && report.intentEpoch === invocation.intentEpoch &&
      generationJob.projectId === invocation.projectId && generationJob.intentEpoch === invocation.intentEpoch &&
      contract.outputArtifactKind === artifactDraft.kind && contract.outputNodeKey === artifactDraft.nodeKey &&
      new Set(gateIds).size === gateIds.length &&
      report.gates.every((gate) => gate.status === "passed") &&
      requiredProviderSuccessGates.every((gateId) => gateById.get(gateId)?.status === "passed") &&
      Boolean(report.reportId.trim()) && /^[a-f0-9]{64}$/i.test(report.reportDigest) &&
      Number.isFinite(new Date(report.createdAt).getTime());
  } catch {
    return false;
  }
}

export function matchesPersistedProviderValidationReport(input: {
  invocation: ToolInvocationRecord;
  generationJob: GenerationJob;
  artifact: Artifact;
  record: ValidationReportRecord;
}) {
  const report = parseValidationReport(input.record.payloadJson);
  const artifactDraft = persistedArtifactDraft(input.artifact);
  if (!report || !artifactDraft || !isValidProviderSuccessValidationReport({
    invocation: input.invocation,
    generationJob: input.generationJob,
    artifactDraft,
    report,
  })) {
    return false;
  }
  const { record, artifact, generationJob, invocation } = input;
  const createdAt = new Date(report.createdAt);
  return record.id === report.reportId && record.projectId === invocation.projectId &&
    record.capabilityId === report.stage && record.stage === report.stage &&
    record.authority === report.authority && record.domain === report.domain &&
    record.targetKind === report.target.kind && record.targetId === report.target.targetId &&
    record.targetVersion === (report.target.targetVersion ?? null) &&
    record.targetDigest === (report.target.targetDigest ?? null) &&
    record.inputHash === (report.inputHash ?? null) && record.intentEpoch === (report.intentEpoch ?? null) &&
    record.contractId === report.contract.id && record.contractVersion === report.contract.version &&
    record.overallStatus === report.overallStatus && record.reportDigest === report.reportDigest &&
    record.payloadJson === JSON.stringify(report) && record.artifactId === artifact.id &&
    record.generationJobId === generationJob.id &&
    record.createdAt.getTime() === createdAt.getTime();
}

export function parseValidationReport(value: string): ValidationReport | null {
  try {
    const report = JSON.parse(value) as unknown;
    return report && typeof report === "object" && !Array.isArray(report)
      ? report as ValidationReport
      : null;
  } catch {
    return null;
  }
}

export function persistedArtifactDraft(artifact: Artifact): SaveArtifactDraft | null {
  try {
    const structuredContent = JSON.parse(artifact.structuredContentJson) as unknown;
    if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) return null;
    return {
      nodeKey: artifact.nodeKey,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      markdownContent: artifact.markdownContent,
      structuredContent: structuredContent as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

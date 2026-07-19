import type { PrismaClient, ToolInvocationRecord } from "@/generated/prisma/client";
import {
  hasValidValidationReportDigest,
  hashArtifactDraft,
  validationDomainForCapability,
} from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import type { SaveArtifactInput } from "@/server/workbench/types";

import { isValidProviderSuccessValidationReport } from "./provider-validation-evidence";
import { hasValidExecutionEnvelope, type ExecutionEnvelope } from "./task-contract";
import { resolveServerToolDefinition } from "./tool-result-mode";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function saveValidationReportInTransaction(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  artifactId: string,
  input: SaveArtifactInput,
  generationJobId?: string,
) {
  const report = input.validationReport!;
  const envelope = parseExecutionEnvelope(invocation.executionEnvelopeJson);
  const tool = resolveServerToolDefinition(invocation.toolName);
  const contract = resolveRuntimeContract(tool);
  const artifactDraft = {
    nodeKey: input.nodeKey,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    markdownContent: input.markdownContent,
    structuredContent: input.structuredContent,
  };
  if (!hasValidValidationReportDigest(report) || report.overallStatus !== "passed" ||
      report.authority !== "deterministic" ||
      report.domain !== validationDomainForCapability(contract.capabilityId) ||
      report.target.kind !== "artifact_draft" || report.target.targetId !== tool.id ||
      report.target.targetVersion !== undefined || report.target.targetDigest !== hashArtifactDraft(artifactDraft) ||
      report.intentEpoch !== invocation.intentEpoch || report.stage !== contract.capabilityId ||
      report.contract.id !== contract.id || report.contract.version !== contract.version ||
      contract.outputArtifactKind !== input.kind) {
    throw new Error("Validation report rejected during atomic Tool result commit.");
  }
  const generationJob = generationJobId
    ? await validationGenerationJob(tx, invocation, generationJobId, contract.capabilityId)
    : null;
  if (report.inputHash !== (generationJob?.inputHash ?? envelope.idempotencyKey) ||
      (tool.adapterKind === "provider" && (!generationJob || !isValidProviderSuccessValidationReport({
        invocation, generationJob, artifactDraft, report,
      })))) {
    throw new Error("Validation report rejected during atomic Tool result commit.");
  }
  const createdAt = new Date(report.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Validation report createdAt is invalid.");
  await tx.validationReportRecord.create({
    data: {
      id: report.reportId,
      projectId: invocation.projectId,
      capabilityId: report.stage,
      stage: report.stage,
      authority: report.authority,
      domain: report.domain,
      targetKind: report.target.kind,
      targetId: report.target.targetId,
      targetVersion: report.target.targetVersion,
      targetDigest: report.target.targetDigest,
      inputHash: report.inputHash,
      intentEpoch: report.intentEpoch,
      contractId: report.contract.id,
      contractVersion: report.contract.version,
      overallStatus: report.overallStatus,
      reportDigest: report.reportDigest,
      payloadJson: JSON.stringify(report),
      artifactId,
      ...(generationJobId ? { generationJobId } : {}),
      createdAt,
    },
  });
}

async function validationGenerationJob(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  generationJobId: string,
  capabilityId: string,
) {
  const job = await tx.generationJob.findFirst({
    where: { id: generationJobId, projectId: invocation.projectId, intentEpoch: invocation.intentEpoch },
    include: {
      runInputSnapshot: {
        select: { projectId: true, intentEpoch: true, capabilityId: true, inputHash: true },
      },
    },
  });
  if (job?.status !== "running" || !job.inputHash || !job.runInputSnapshot ||
      job.runInputSnapshot.projectId !== invocation.projectId ||
      job.runInputSnapshot.intentEpoch !== invocation.intentEpoch ||
      job.runInputSnapshot.capabilityId !== capabilityId || job.runInputSnapshot.inputHash !== job.inputHash) {
    throw new Error("Validation report rejected during atomic Tool result commit.");
  }
  return job;
}

function parseExecutionEnvelope(value: string): ExecutionEnvelope {
  try {
    const parsed = JSON.parse(value) as ExecutionEnvelope;
    if (hasValidExecutionEnvelope(parsed)) return parsed;
  } catch {
    // Fall through to the stable contract error.
  }
  throw new Error("Tool invocation ExecutionEnvelope is invalid.");
}

import type { Artifact, GenerationJob, PrismaClient, ToolInvocationRecord } from "@/generated/prisma/client";

import { matchesGenerationInvocationContract } from "./tool-artifact-replay-contract";
import { matchesPersistedProviderValidationReport } from "./provider-validation-evidence";
import { resolveServerToolResultContract } from "./tool-result-mode";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function requireBoundGenerationJob(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  authority: string,
  generationJobId: string,
  allowedStatuses: string[],
): Promise<GenerationJob> {
  const request = parseRecord(invocation.requestJson);
  const contract = request ? resolveServerToolResultContract(invocation.toolName, request) : null;
  const generationJob = await tx.generationJob.findUnique({ where: { id: generationJobId } });
  const snapshot = generationJob?.runInputSnapshotId
    ? await tx.runInputSnapshot.findUnique({ where: { id: generationJob.runInputSnapshotId } })
    : null;
  const sourceArtifacts = generationJob && snapshot
    ? await tx.artifact.findMany({ where: { projectId: invocation.projectId } })
    : [];
  if (!request || !contract?.capabilityId || !contract.requiresGenerationEvidence ||
      !contract.expectedGenerationKind || !contract.primarySourceArtifactKind || !generationJob || !snapshot ||
      !allowedStatuses.includes(generationJob.status) ||
      !matchesGenerationInvocationContract({
        authority,
        invocation,
        request,
        capabilityId: contract.capabilityId,
        expectedGenerationKind: contract.expectedGenerationKind,
        requiredArtifactKinds: contract.requiredArtifactKinds,
        primarySourceArtifactKind: contract.primarySourceArtifactKind,
        sourceArtifacts,
        generationJob,
        snapshot,
      })) {
    throw new Error("GenerationJob does not match the current Tool invocation contract.");
  }
  return generationJob;
}

export async function requirePersistedProviderGenerationEvidence(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  generationJob: GenerationJob,
  artifact: Artifact,
) {
  const reports = await tx.validationReportRecord.findMany({
    where: {
      projectId: invocation.projectId,
      OR: [{ generationJobId: generationJob.id }, { artifactId: artifact.id }],
    },
  });
  if (reports.length !== 1 || !matchesPersistedProviderValidationReport({
    invocation,
    generationJob,
    artifact,
    record: reports[0],
  })) {
    throw new Error("Persisted Provider evidence does not match the completed GenerationJob.");
  }
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

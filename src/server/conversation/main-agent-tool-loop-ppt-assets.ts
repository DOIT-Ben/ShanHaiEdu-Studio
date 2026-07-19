import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { buildPptAssetRequestBatch } from "@/server/ppt-quality/ppt-asset-request-builder";
import type { PptAssetBatchLifecycle } from "@/server/ppt-quality/ppt-asset-batch-run";
import type { PptAssetRequest, PptGeneratedAsset } from "@/server/ppt-quality/ppt-asset-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import type { MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import type { ArtifactRecord, GenerationJobRecord } from "@/server/workbench/types";

import type { CreateMainAgentToolLoopOptionsInput } from "./main-agent-tool-loop-types";
import type { TaskBrief } from "./task-contract";

export type PptAssetBatchExecutionPlan = {
  pendingUnitCount: number;
  authoritativeProviderCallsUsed: number;
  lifecycle: PptAssetBatchLifecycle;
};

export async function preparePptAssetBatchExecution(input: {
  service: CreateMainAgentToolLoopOptionsInput["service"];
  projectId: string;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  taskBrief: TaskBrief;
}): Promise<PptAssetBatchExecutionPlan | null> {
  if (input.definition.internalToolId !== "generate_ppt_sample_assets" &&
      input.definition.internalToolId !== "generate_ppt_full_assets") return null;
  const sourceArtifact = input.artifacts
    .filter((artifact) => artifact.kind === "ppt_design_draft" && isArtifactTrustedForDownstream(artifact))
    .at(-1);
  const packageValue = sourceArtifact?.structuredContent.pptDesignPackage;
  if (!sourceArtifact || !packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) return null;
  let requestBatch: ReturnType<typeof buildPptAssetRequestBatch>;
  try {
    requestBatch = buildPptAssetRequestBatch(
      packageValue as PptDesignPackage,
      input.definition.internalToolId === "generate_ppt_full_assets" ? "full_production" : "key_samples",
    );
  } catch {
    return null;
  }
  const jobs = await input.service.getGenerationJobs(input.projectId);
  const jobsByUnit = jobsForBatch(jobs, sourceArtifact.id, input.taskBrief.intentEpoch);
  const completed = new Map<string, PptGeneratedAsset>();
  for (const request of requestBatch.requests) {
    const result = readVerifiedPptAssetUnitResult(jobsByUnit.get(request.assetId), request, requestBatch.batchDigest);
    if (result) completed.set(request.assetId, result);
  }
  const lifecycle = createPptAssetBatchLifecycle({
    ...input,
    sourceArtifactId: sourceArtifact.id,
    batchDigest: requestBatch.batchDigest,
    completed,
  });
  return {
    pendingUnitCount: requestBatch.requests.length - completed.size,
    authoritativeProviderCallsUsed: jobs
      .filter((job) => job.intentEpoch === input.taskBrief.intentEpoch && job.countsAsProviderSubmission !== false)
      .reduce((count, job) => count + job.attempts, 0),
    lifecycle,
  };
}

function jobsForBatch(jobs: GenerationJobRecord[], sourceArtifactId: string, intentEpoch: number) {
  const jobsByUnit = new Map<string, GenerationJobRecord>();
  for (const job of jobs) {
    if (job.kind !== "image" || job.sourceArtifactId !== sourceArtifactId ||
        job.intentEpoch !== intentEpoch || !job.unitId) continue;
    jobsByUnit.set(job.unitId, job);
  }
  return jobsByUnit;
}

function createPptAssetBatchLifecycle(input: {
  service: CreateMainAgentToolLoopOptionsInput["service"];
  projectId: string;
  definition: MainAgentToolDefinition;
  taskBrief: TaskBrief;
  sourceArtifactId: string;
  batchDigest: string;
  completed: Map<string, PptGeneratedAsset>;
}): PptAssetBatchLifecycle {
  const activeJobIds = new Map<string, string>();
  const capabilityId = input.definition.capabilityId ?? "ppt_sample_assets";
  return {
    loadSucceededUnit: async (request) => input.completed.get(request.assetId) ?? null,
    onSubmissionStarted: async (request) => {
      const idempotencyKey = hashRunInput({
        taskId: input.taskBrief.taskId,
        capabilityId,
        batchDigest: input.batchDigest,
        assetId: request.assetId,
      });
      const queued = await input.service.createGenerationJob(input.projectId, {
        kind: "image",
        sourceArtifactId: input.sourceArtifactId,
        unitId: request.assetId,
        capabilityId,
        idempotencyKey,
        sourceArtifactIds: [input.sourceArtifactId],
        inputSnapshot: {
          taskId: input.taskBrief.taskId,
          taskBriefDigest: input.taskBrief.digest,
          intentEpoch: input.taskBrief.intentEpoch,
          batchDigest: input.batchDigest,
          request: structuredClone(request),
        },
      });
      if (queued.status === "succeeded") throw new Error("ppt_asset_unit_result_unverifiable");
      const active = await input.service.startGenerationJobForExecution(input.projectId, queued.id);
      if (active.job.status === "submission_unknown") throw new Error("submission_unknown");
      if (active.job.status !== "running") throw new Error(`ppt_asset_unit_not_runnable:${active.job.status}`);
      activeJobIds.set(request.assetId, active.job.id);
    },
    onSubmissionSucceeded: async (request, result) => {
      const jobId = activeJobIds.get(request.assetId);
      if (!jobId) throw new Error("ppt_asset_unit_job_missing");
      await input.service.completeGenerationUnit(input.projectId, jobId, {
        providerResultJson: JSON.stringify({
          schemaVersion: "ppt-asset-unit-result.v1",
          taskId: input.taskBrief.taskId,
          batchDigest: input.batchDigest,
          assetId: request.assetId,
          requestInputHash: request.inputHash,
          result: structuredClone(result),
        }),
      });
    },
    onSubmissionFailed: async (request, error) => {
      const jobId = activeJobIds.get(request.assetId);
      if (!jobId) return;
      await input.service.failGenerationJob(input.projectId, jobId, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

function readVerifiedPptAssetUnitResult(
  job: GenerationJobRecord | undefined,
  request: PptAssetRequest,
  batchDigest: string,
): PptGeneratedAsset | null {
  if (!job || job.status !== "succeeded" || !job.providerResultJson) return null;
  try {
    const value = JSON.parse(job.providerResultJson) as Record<string, unknown>;
    if (value.schemaVersion !== "ppt-asset-unit-result.v1" || value.batchDigest !== batchDigest ||
        value.assetId !== request.assetId || value.requestInputHash !== request.inputHash ||
        !isPptGeneratedAsset(value.result, request)) return null;
    return structuredClone(value.result);
  } catch {
    return null;
  }
}

function isPptGeneratedAsset(value: unknown, request: PptAssetRequest): value is PptGeneratedAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.provider === "string" && result.provider.length > 0 &&
    typeof result.model === "string" && result.model.length > 0 &&
    typeof result.clientRequestId === "string" && result.clientRequestId.length > 0 &&
    typeof result.fileName === "string" && result.fileName.length > 0 &&
    typeof result.storageRef === "string" && result.storageRef.length > 0 &&
    typeof result.sha256 === "string" && /^[a-f0-9]{64}$/i.test(result.sha256) &&
    typeof result.bytes === "number" && result.bytes > 0 &&
    typeof result.width === "number" && result.width > 0 &&
    typeof result.height === "number" && result.height > 0 &&
    typeof result.mime === "string" && result.mime.startsWith("image/") &&
    result.transparentBackgroundVerified === request.transparentBackground &&
    Array.isArray(result.sentReferenceAssetIds) &&
    isPptAssetFileEvidence(result.rawAsset) && isPptAssetFileEvidence(result.normalizedAsset);
}

function isPptAssetFileEvidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return typeof file.fileName === "string" && file.fileName.length > 0 &&
    typeof file.storageRef === "string" && file.storageRef.length > 0 &&
    typeof file.sha256 === "string" && /^[a-f0-9]{64}$/i.test(file.sha256) &&
    typeof file.bytes === "number" && file.bytes > 0 &&
    typeof file.width === "number" && file.width > 0 &&
    typeof file.height === "number" && file.height > 0 &&
    typeof file.mime === "string" && file.mime.startsWith("image/");
}

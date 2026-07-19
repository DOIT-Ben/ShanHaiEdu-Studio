import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db/client";
import { createValidationReport, validationDomainForCapability } from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import type { PptAssetBatchLifecycle } from "@/server/ppt-quality/ppt-asset-batch-run";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { selectLatestGenerationSources } from "@/server/tools/generation-source-binding";
import type { MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ArtifactRecord, GenerationJobRecord } from "@/server/workbench/types";
import type { createWorkbenchService } from "@/server/workbench/service";

import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import { appendAgentObservationMetadata, createAgentObservation } from "./react-control";
import { createControlPlaneStore } from "./control-plane-store";
import { resolveGenerationUnitBinding } from "./generation-unit-binding";
import type { ExecutionEnvelope } from "./task-contract";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

class NativeProviderGenerationPreparationError extends Error {
  constructor(
    readonly reasonCode: "native_provider_generation_contract_invalid" | "native_provider_generation_prepare_failed",
    readonly generationJobId?: string,
    readonly generationInputHash?: string | null,
  ) {
    super(reasonCode);
    this.name = "NativeProviderGenerationPreparationError";
  }
}

export async function claimMainAgentToolInvocation(input: {
  service: WorkbenchService;
  controlPlaneStore: ControlPlaneStore;
  invocationId: string;
  executionEnvelope: ExecutionEnvelope;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  arguments: Record<string, unknown>;
  pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
}) {
  const claim = await input.controlPlaneStore.startToolInvocation({
    invocationId: input.invocationId,
    envelope: input.executionEnvelope,
    toolName: input.definition.internalToolId ?? input.definition.id,
    request: structuredClone(input.arguments),
  });
  if (claim.kind === "terminal_replay") return { kind: "replay" as const, claim };
  const resumedProviderGeneration = claim.kind === "in_progress"
    ? await resumeNativeProviderGeneration({
        service: input.service,
        projectId: input.executionEnvelope.projectId,
        definition: input.definition,
        artifacts: input.artifacts,
        arguments: input.arguments,
        idempotencyKey: input.executionEnvelope.idempotencyKey,
        taskBriefDigest: input.executionEnvelope.taskBriefDigest,
        intentEpoch: input.executionEnvelope.intentEpoch,
        pptAssetBatchLifecycle: input.pptAssetBatchLifecycle,
      })
    : null;
  if (claim.kind === "in_progress" && !resumedProviderGeneration) {
    return { kind: "replay" as const, claim };
  }
  return {
    kind: "ready" as const,
    claim,
    invocationId: claim.invocation.invocationId,
    resumedProviderGeneration,
  };
}

export async function prepareNativeProviderGenerationForInvocation(input: {
  service: WorkbenchService;
  controlPlaneStore: ControlPlaneStore;
  invocationId: string;
  executionEnvelope: ExecutionEnvelope;
  triggerMessageId: string;
  messageMetadata: Record<string, unknown>;
  projectId: string;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  taskBriefDigest: string;
  intentEpoch: number;
  pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
}) {
  try {
    return {
      kind: "ready" as const,
      generation: await prepareNativeProviderGeneration(input),
    };
  } catch (error) {
    const failure = error instanceof NativeProviderGenerationPreparationError
      ? error
      : new NativeProviderGenerationPreparationError("native_provider_generation_prepare_failed");
    const persisted = await persistNativeProviderPreparationFailure(input, failure);
    const messageMetadata = appendAgentObservationMetadata(input.messageMetadata, persisted.observation);
    await input.service.updateMessageMetadata(input.projectId, input.triggerMessageId, messageMetadata);
    const dispatchResult: MainAgentReActDispatchResult = {
      status: "failed",
      observation: {
        observationId: persisted.observation.observationId,
        status: "failed",
        reasonCodes: persisted.observation.reasonCodes,
        summary: persisted.observation.teacherSafeSummary,
        reportRefs: [{
          id: persisted.validationReport.reportId,
          kind: "validation",
          digest: persisted.validationReport.reportDigest,
        }],
        targetLocators: persisted.observation.targetLocators,
        nextAction: "replan",
      },
    };
    return { kind: "failed" as const, dispatchResult, messageMetadata };
  }
}

export async function prepareNativeProviderGeneration(input: {
  service: WorkbenchService;
  projectId: string;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  taskBriefDigest: string;
  intentEpoch: number;
  pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
}) {
  const prepared = resolveNativeProviderGenerationInput(input);
  if (!prepared) return null;
  let queued: GenerationJobRecord;
  try {
    queued = await input.service.createGenerationJob(
      input.projectId,
      generationJobInput(input, prepared),
    );
  } catch {
    throw new NativeProviderGenerationPreparationError("native_provider_generation_prepare_failed");
  }
  let active;
  try {
    active = await input.service.startGenerationJobForExecution(input.projectId, queued.id);
  } catch {
    throw new NativeProviderGenerationPreparationError(
      "native_provider_generation_prepare_failed",
      queued.id,
      queued.inputHash,
    );
  }
  return nativeProviderGenerationResult(input, prepared.trustedSources, active);
}

export async function resumeNativeProviderGeneration(input: {
  service: WorkbenchService;
  projectId: string;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  taskBriefDigest: string;
  intentEpoch: number;
  pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
}) {
  try {
    const prepared = resolveNativeProviderGenerationInput(input);
    if (!prepared) return null;
    const existing = await prisma.generationJob.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    const providerTaskId = existing?.providerTaskId?.trim();
    if (!existing || existing.status !== "running" || existing.pollState !== "polling" ||
        !providerTaskId || existing.intentEpoch !== input.intentEpoch || !existing.inputHash) {
      return null;
    }
    const job = await input.service.createGenerationJob(
      input.projectId,
      generationJobInput(input, prepared),
    );
    if (job.id !== existing.id || job.status !== "running" || job.inputHash !== existing.inputHash) return null;
    const current = await prisma.generationJob.findUnique({ where: { id: existing.id } });
    if (!current || current.status !== "running" || current.pollState !== "polling" ||
        current.providerTaskId !== existing.providerTaskId || current.inputHash !== existing.inputHash) {
      return null;
    }
    return nativeProviderGenerationResult(input, prepared.trustedSources, {
      job,
      providerTaskId,
      pollState: "polling",
    });
  } catch {
    return null;
  }
}

async function persistNativeProviderPreparationFailure(
  input: {
    controlPlaneStore: ControlPlaneStore;
    invocationId: string;
    executionEnvelope: ExecutionEnvelope;
    triggerMessageId: string;
    definition: MainAgentToolDefinition;
  },
  error: NativeProviderGenerationPreparationError,
) {
  const toolName = input.definition.internalToolId ?? input.definition.id;
  const runtimeContract = resolveRuntimeContract(getToolDefinition(toolName));
  const observation = createAgentObservation({
    projectId: input.executionEnvelope.projectId,
    source: "validation",
    status: "failed",
    actionKey: toolName,
    inputHash: input.executionEnvelope.idempotencyKey,
    reasonCodes: [error.reasonCode],
    reportRefs: [],
    targetLocators: [{ kind: "tool", toolId: toolName }],
    responsibleStage: runtimeContract.capabilityId,
    minimalNextAction: "repair_upstream",
    teacherSafeSummary: "这一步的可信输入或生成单元不完整，系统没有提交外部请求，已保存失败位置。",
  });
  const validationReport = createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: validationDomainForCapability(runtimeContract.capabilityId),
    stage: runtimeContract.capabilityId,
    target: { kind: "tool_invocation", targetId: input.invocationId },
    contract: { id: runtimeContract.id, version: runtimeContract.version },
    inputHash: error.generationInputHash ?? input.executionEnvelope.idempotencyKey,
    intentEpoch: input.executionEnvelope.intentEpoch,
    overallStatus: "failed",
    gates: [{
      gateId: "native_provider_generation_preparation",
      validatorId: "native_provider_generation",
      validatorVersion: "v1",
      status: "failed",
      evidenceRefs: [],
      locators: [{ kind: "tool", toolId: toolName }],
      responsibleStage: runtimeContract.capabilityId,
      reasonCode: error.reasonCode,
    }],
  });
  await input.controlPlaneStore.commitToolFailure({
    invocationId: input.invocationId,
    ...(error.generationJobId ? {
      generationJob: {
        jobId: error.generationJobId,
        status: "failed" as const,
        errorMessage: observation.teacherSafeSummary,
      },
    } : {}),
    validationReport,
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: structuredClone(observation) as unknown as Record<string, unknown>,
    },
    event: {
      eventId: randomUUID(),
      projectId: input.executionEnvelope.projectId,
      taskId: input.executionEnvelope.taskId,
      runId: `turn:${input.triggerMessageId}`,
      intentEpoch: input.executionEnvelope.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { observationId: observation.observationId, status: "failed", reasonCode: error.reasonCode },
    },
  });
  return { observation, validationReport };
}

function generationJobKindFor(definition: MainAgentToolDefinition): GenerationJobRecord["kind"] {
  if (definition.producedArtifactKind === "pptx_artifact") return "pptx";
  if (definition.producedArtifactKind === "video_narration_generate") return "audio";
  if (definition.producedArtifactKind === "video_segment_generate") return "video";
  return "image";
}

function resolveNativeProviderGenerationInput(input: {
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  arguments: Record<string, unknown>;
}) {
  if (input.definition.adapterKind !== "provider" || typeof input.definition.internalToolId !== "string") return null;
  const trustedSources = selectLatestGenerationSources({
    requiredArtifactKinds: input.definition.requiredArtifactKinds,
    primarySourceArtifactKind: input.definition.primarySourceArtifactKind ?? null,
    artifacts: input.artifacts,
    isTrusted: isArtifactTrustedForDownstream,
  });
  const unitBinding = resolveGenerationUnitBinding({
    authority: "main_agent",
    toolName: input.definition.id,
    request: input.arguments,
  });
  if (!trustedSources || !trustedSources[0] || unitBinding.kind === "invalid") {
    throw new NativeProviderGenerationPreparationError("native_provider_generation_contract_invalid");
  }
  return {
    definition: input.definition,
    trustedSources,
    sourceArtifact: trustedSources[0],
    unitId: unitBinding.kind === "single" ? unitBinding.unitId : null,
  };
}

function generationJobInput(
  input: {
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    taskBriefDigest: string;
    intentEpoch: number;
    pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
  },
  prepared: NonNullable<ReturnType<typeof resolveNativeProviderGenerationInput>>,
) {
  return {
    kind: generationJobKindFor(prepared.definition),
    sourceArtifactId: prepared.sourceArtifact.id,
    ...(prepared.unitId ? { unitId: prepared.unitId } : {}),
    capabilityId: prepared.definition.capabilityId,
    idempotencyKey: input.idempotencyKey,
    sourceArtifactIds: prepared.trustedSources.map((artifact) => artifact.id),
    inputSnapshot: {
      toolName: prepared.definition.internalToolId,
      arguments: structuredClone(input.arguments),
      taskBriefDigest: input.taskBriefDigest,
      intentEpoch: input.intentEpoch,
      sourceArtifacts: prepared.trustedSources.map((artifact) => ({
        artifactId: artifact.id,
        kind: artifact.kind,
        version: artifact.version,
      })),
    },
    ...(input.pptAssetBatchLifecycle ? { countsAsProviderSubmission: false } : {}),
  };
}

function nativeProviderGenerationResult(
  input: {
    service: WorkbenchService;
    projectId: string;
    pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
  },
  sourceArtifacts: ArtifactRecord[],
  active: Awaited<ReturnType<WorkbenchService["startGenerationJobForExecution"]>>,
) {
  return {
    active,
    pptAssetBatchLifecycle: input.pptAssetBatchLifecycle,
    sourceArtifacts,
    lifecycle: {
      providerTaskId: active.providerTaskId,
      onTaskAccepted: async (providerTaskId: string) => {
        await input.service.recordGenerationProviderTask(input.projectId, active.job.id, { providerTaskId });
      },
      onPoll: async () => {
        await input.service.recordGenerationPoll(input.projectId, active.job.id);
      },
    },
  };
}

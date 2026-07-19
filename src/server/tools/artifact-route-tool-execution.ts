import { randomUUID } from "node:crypto";

import {
  createControlPlaneStore,
  type PersistedTaskAggregate,
} from "@/server/conversation/control-plane-store";
import {
  createExecutionEnvelope,
  type ExecutionEnvelope,
} from "@/server/conversation/task-contract";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToRequestedOutput } from "@/server/quality/artifact-truth-boundary";
import type { ValidationReport } from "@/server/quality/quality-types";
import type { ArtifactKind, ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

import { executeThroughToolGateway } from "./tool-execution-gateway";
import type { ToolExecutionResult } from "./tool-types";

type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;
type SuccessfulToolResult = Extract<ToolExecutionResult, { status: "succeeded" }> & {
  validationReport: ValidationReport;
};
type FailedToolResult = Exclude<ToolExecutionResult, { status: "succeeded" }>;

export type ArtifactRouteToolExecutionClaim = {
  controlPlaneStore: ControlPlaneStore;
  aggregate: PersistedTaskAggregate;
  executionEnvelope: ExecutionEnvelope;
  invocationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  runId: string;
};

export type ArtifactRouteTaskContext = {
  controlPlaneStore: ControlPlaneStore;
  aggregate: PersistedTaskAggregate;
};

export class ArtifactRouteToolExecutionError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = "ArtifactRouteToolExecutionError";
  }
}

export async function resolveArtifactRouteTaskContext(input: {
  project: ProjectRecord;
  controlPlaneStore?: ControlPlaneStore;
}): Promise<ArtifactRouteTaskContext> {
  const controlPlaneStore = input.controlPlaneStore ?? createControlPlaneStore();
  const intentEpoch = input.project.intentEpoch ?? 0;
  const aggregate = await controlPlaneStore.getTaskAggregate(input.project.id, intentEpoch);
  if (!aggregate) throw new ArtifactRouteToolExecutionError("task_aggregate_required");
  if (aggregate.taskBrief.projectId !== input.project.id || aggregate.taskBrief.intentEpoch !== intentEpoch) {
    throw new ArtifactRouteToolExecutionError("task_aggregate_scope_mismatch");
  }
  return { controlPlaneStore, aggregate };
}

export async function claimArtifactRouteToolExecution(input: {
  project: ProjectRecord;
  actorUserId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  sourceArtifacts: ArtifactRecord[];
  controlPlaneStore?: ControlPlaneStore;
  taskContext?: ArtifactRouteTaskContext;
  invocationId?: string;
}): Promise<ArtifactRouteToolExecutionClaim> {
  const intentEpoch = input.project.intentEpoch ?? 0;
  const taskContext = input.taskContext ?? await resolveArtifactRouteTaskContext({
    project: input.project,
    controlPlaneStore: input.controlPlaneStore,
  });
  const { controlPlaneStore, aggregate } = taskContext;
  if (aggregate.taskBrief.projectId !== input.project.id || aggregate.taskBrief.intentEpoch !== intentEpoch) {
    throw new ArtifactRouteToolExecutionError("task_aggregate_scope_mismatch");
  }
  assertCurrentTaskSourceArtifacts({
    artifacts: input.sourceArtifacts,
    aggregate,
    arguments: input.arguments,
  });

  let executionEnvelope: ExecutionEnvelope;
  try {
    executionEnvelope = createExecutionEnvelope({
      actorUserId: input.actorUserId,
      taskBrief: aggregate.taskBrief,
      planRevision: aggregate.plan.revision,
      intensity: input.project.generationIntensity ?? aggregate.taskBrief.generationIntensity,
      intentGrant: aggregate.intentGrant,
      action: { toolName: input.toolName, arguments: structuredClone(input.arguments) },
    });
  } catch {
    throw new ArtifactRouteToolExecutionError("execution_envelope_invalid");
  }

  const request = {
    toolName: input.toolName,
    projectId: input.project.id,
    intentEpoch,
    arguments: structuredClone(input.arguments),
  };
  const invocationId = input.invocationId ?? randomUUID();
  const claim = await executeThroughToolGateway({
    request,
    current: {
      actorUserId: input.actorUserId,
      projectId: input.project.id,
      taskId: aggregate.taskBrief.taskId,
      intentEpoch,
      planRevision: aggregate.plan.revision,
      intensity: input.project.generationIntensity ?? aggregate.taskBrief.generationIntensity,
      taskBriefDigest: aggregate.taskBrief.digest,
    },
    executionEnvelope,
    execute: () => controlPlaneStore.startArtifactRouteToolInvocation({
      invocationId,
      envelope: executionEnvelope,
      toolName: input.toolName,
      request: structuredClone(input.arguments),
    }),
  });
  if ("reasonCode" in claim) throw new ArtifactRouteToolExecutionError(claim.reasonCode);
  if (claim.kind !== "claimed") {
    throw new ArtifactRouteToolExecutionError(
      claim.kind === "terminal_replay" ? "tool_invocation_terminal_replay" : "tool_invocation_in_progress",
    );
  }

  return {
    controlPlaneStore,
    aggregate,
    executionEnvelope,
    invocationId: claim.invocation.invocationId,
    toolName: input.toolName,
    arguments: structuredClone(input.arguments),
    runId: `artifact-route:${claim.invocation.invocationId}`,
  };
}

function assertCurrentTaskSourceArtifacts(input: {
  artifacts: ArtifactRecord[];
  aggregate: PersistedTaskAggregate;
  arguments: Record<string, unknown>;
}) {
  if (input.artifacts.length === 0) {
    throw new ArtifactRouteToolExecutionError("source_artifact_required");
  }
  for (const artifact of input.artifacts) {
    if (artifact.projectId !== input.aggregate.taskBrief.projectId) {
      throw new ArtifactRouteToolExecutionError("source_artifact_project_mismatch");
    }
    if (!isArtifactBoundToRequestedOutput(artifact, input.aggregate.taskBrief)) {
      throw new ArtifactRouteToolExecutionError("source_artifact_task_binding_mismatch");
    }
    if (!isArtifactTrustedForDownstream(artifact)) {
      throw new ArtifactRouteToolExecutionError("source_artifact_untrusted");
    }
  }

  const [sourceArtifact, ...upstreamArtifacts] = input.artifacts;
  if (input.arguments.sourceArtifactId !== sourceArtifact.id ||
      input.arguments.sourceArtifactVersion !== sourceArtifact.version) {
    throw new ArtifactRouteToolExecutionError("source_artifact_arguments_mismatch");
  }
  if (Object.prototype.hasOwnProperty.call(input.arguments, "upstreamArtifactIds")) {
    const upstreamArtifactIds = input.arguments.upstreamArtifactIds;
    if (!Array.isArray(upstreamArtifactIds) ||
        upstreamArtifactIds.some((id) => typeof id !== "string") ||
        upstreamArtifactIds.length !== upstreamArtifacts.length ||
        upstreamArtifactIds.some((id, index) => id !== upstreamArtifacts[index].id)) {
      throw new ArtifactRouteToolExecutionError("source_artifact_arguments_mismatch");
    }
  }
}

export async function commitArtifactRouteToolSuccess(input: {
  claim: ArtifactRouteToolExecutionClaim;
  generationJobId: string;
  result: SuccessfulToolResult;
}) {
  const observationId = randomUUID();
  const committed = await input.claim.controlPlaneStore.commitToolResult({
    invocationId: input.claim.invocationId,
    generationJobId: input.generationJobId,
    artifact: {
      nodeKey: input.result.artifactDraft.nodeKey as ArtifactKind,
      kind: input.result.artifactDraft.kind as ArtifactKind,
      title: input.result.artifactDraft.title,
      status: "needs_review",
      summary: input.result.artifactDraft.summary,
      markdownContent: input.result.artifactDraft.markdownContent ?? "",
      structuredContent: input.result.artifactDraft.structuredContent,
      validationReport: input.result.validationReport,
    },
    observation: {
      observationId,
      status: "succeeded",
      reasonCodes: ["business_tool_succeeded"],
      payload: {
        actionKey: input.result.toolId,
        inputHash: input.claim.executionEnvelope.idempotencyKey,
        summary: input.result.assistantSummary,
        budgetEvent: structuredClone(input.result.budgetEvent),
      },
    },
    event: eventForClaim(input.claim, "artifact_committed", {
      observationId,
      toolName: input.result.toolId,
      generationJobId: input.generationJobId,
    }),
  });
  return {
    ...committed,
    artifact: committed.artifact as { id: string },
  };
}

export async function commitArtifactRouteToolFailure(input: {
  claim: ArtifactRouteToolExecutionClaim;
  generationJobId?: string;
  result?: FailedToolResult;
  teacherSafeSummary?: string;
  reasonCodes?: string[];
  errorCategory?: string;
}) {
  const observationId = randomUUID();
  const errorCategory = input.errorCategory ?? (
    input.result && "errorCategory" in input.result ? input.result.errorCategory : undefined
  );
  const reasonCodes = uniqueText([
    ...(input.reasonCodes ?? []),
    ...(input.result ? [input.result.observation.kind] : []),
    ...(errorCategory ? [errorCategory] : []),
  ]);
  const teacherSafeSummary = input.teacherSafeSummary ?? input.result?.observation.teacherSafeSummary ??
    "这一步暂时没有执行成功，已保存恢复信息。";

  return input.claim.controlPlaneStore.commitToolFailure({
    invocationId: input.claim.invocationId,
    ...(input.generationJobId ? {
      generationJob: {
        jobId: input.generationJobId,
        status: errorCategory === "submission_unknown" ? "submission_unknown" as const : "failed" as const,
        errorMessage: teacherSafeSummary,
      },
    } : {}),
    observation: {
      observationId,
      status: "failed",
      reasonCodes: reasonCodes.length ? reasonCodes : ["artifact_route_tool_failed"],
      payload: {
        actionKey: input.claim.toolName,
        inputHash: input.claim.executionEnvelope.idempotencyKey,
        summary: teacherSafeSummary,
      },
    },
    event: eventForClaim(input.claim, "tool_observed", {
      observationId,
      toolName: input.claim.toolName,
      status: "failed",
      reasonCodes,
      ...(input.generationJobId ? { generationJobId: input.generationJobId } : {}),
    }),
  });
}

export async function commitArtifactRouteToolReplay(input: {
  claim: ArtifactRouteToolExecutionClaim;
  artifactId: string;
  generationJobId: string;
}) {
  const observationId = randomUUID();
  return input.claim.controlPlaneStore.commitToolObservation({
    invocationId: input.claim.invocationId,
    existingArtifact: {
      artifactId: input.artifactId,
      generationJobId: input.generationJobId,
    },
    observation: {
      observationId,
      status: "succeeded",
      reasonCodes: ["generation_result_reused"],
      payload: {
        actionKey: input.claim.toolName,
        inputHash: input.claim.executionEnvelope.idempotencyKey,
        artifactId: input.artifactId,
        generationJobId: input.generationJobId,
      },
    },
    event: eventForClaim(input.claim, "artifact_committed", {
      observationId,
      toolName: input.claim.toolName,
      status: "succeeded",
      artifactId: input.artifactId,
      generationJobId: input.generationJobId,
    }),
  });
}

function eventForClaim(
  claim: ArtifactRouteToolExecutionClaim,
  kind: "artifact_committed" | "tool_observed",
  payload: Record<string, unknown>,
) {
  return {
    eventId: randomUUID(),
    projectId: claim.executionEnvelope.projectId,
    taskId: claim.executionEnvelope.taskId,
    runId: claim.runId,
    intentEpoch: claim.executionEnvelope.intentEpoch,
    kind,
    visibility: "internal" as const,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function uniqueText(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

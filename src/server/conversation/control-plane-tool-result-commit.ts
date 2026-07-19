import type { Artifact, GenerationJob, PrismaClient, ToolInvocationRecord } from "@/generated/prisma/client";
import {
  hasValidValidationReportDigest,
  validationDomainForCapability,
} from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import { commitToolResultAtomically } from "@/server/execution/tool-result-commit";
import type { ValidationReport } from "@/server/quality/quality-types";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { SaveArtifactInput } from "@/server/workbench/types";

import type { AgentEventEnvelope } from "./agent-event-envelope";
import {
  appendResolvedToolInvocationAudit,
  assertToolTerminalEventBinding,
  requireActiveToolInvocationAuthority,
  requireFrozenToolResultMode,
} from "./orchestration-tool-authority";
import type { ExecutionEnvelope } from "./task-contract";
import { hasCompatibleArtifactPlanRevision } from "./tool-artifact-replay-contract";
import {
  requireBoundGenerationJob,
  requirePersistedProviderGenerationEvidence,
} from "./tool-generation-job-binding";
import { resolveServerToolResultContract, type ToolResultMode } from "./tool-result-mode";
import { expectedToolTerminalEventKind } from "./tool-terminal-status";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type AgentEventInput = Omit<AgentEventEnvelope, "schemaVersion" | "sequence">;

export type ToolResultObservationInput = {
  observationId: string;
  status: string;
  reasonCodes: string[];
  payload: Record<string, unknown>;
};

export type CommitToolObservationInput = {
  invocationId: string;
  generationJob?: { jobId: string; status: "failed" | "submission_unknown"; errorMessage: string };
  existingArtifact?: { artifactId: string; generationJobId: string };
  observation: ToolResultObservationInput;
  event: AgentEventInput;
  validationReport?: ValidationReport;
};

export type CommitToolArtifactInput = {
  invocationId: string;
  generationJobId?: string;
  artifact: SaveArtifactInput;
  observation: ToolResultObservationInput;
  event: AgentEventInput;
};

export type ToolResultCommitOperations = {
  saveArtifact(
    tx: TransactionClient,
    invocation: ToolInvocationRecord,
    artifact: SaveArtifactInput,
    generationJobId?: string,
  ): Promise<Artifact>;
  appendEvent(tx: TransactionClient, event: AgentEventInput): Promise<AgentEventEnvelope>;
  advancePlanRevision(tx: TransactionClient, invocation: ToolInvocationRecord): Promise<void>;
};

export function commitToolArtifactResult(
  client: PrismaClient,
  input: CommitToolArtifactInput,
  operations: ToolResultCommitOperations,
) {
  return commitToolResultAtomically({
    transaction: (commit) => client.$transaction(async (tx) => {
      const { invocation, attempted } = await requireActiveToolInvocationAuthority(tx, input.invocationId);
      assertToolEventRunBinding(input.event, attempted);
      const resultMode = requireFrozenToolResultMode(attempted);
      if (resultMode !== "artifact_required") {
        throw new Error("Observation-only Tool cannot commit an Artifact result.");
      }
      const request = parseRecord(invocation.requestJson);
      const resultContract = request ? resolveServerToolResultContract(invocation.toolName, request) : null;
      if (!resultContract || resultContract.resultMode !== resultMode ||
          (resultContract.artifactKind !== null &&
            (input.artifact.kind !== resultContract.artifactKind || input.artifact.nodeKey !== resultContract.artifactKind))) {
        throw new Error("Tool Artifact result does not match the server result contract.");
      }
      if (resultContract.requiresGenerationEvidence &&
          (!input.generationJobId || !input.artifact.validationReport)) {
        throw new Error("Provider Tool Artifact result requires GenerationJob and ValidationReport evidence.");
      }
      const invocationStatus = assertToolTerminalEventBinding(
        input.event,
        invocation,
        input.observation.observationId,
        input.observation.status,
      );
      if (invocationStatus !== "succeeded") throw new Error("Artifact Tool result is not successful.");
      if (input.event.kind !== expectedToolTerminalEventKind(input.observation.status, invocationStatus, resultMode)) {
        throw new Error("Tool result event kind is invalid.");
      }
      const generationJob = input.generationJobId
        ? await requireBoundGenerationJob(
            tx,
            invocation,
            attempted.authority,
            input.generationJobId,
            ["queued", "running"],
          )
        : null;
      let committedArtifactId: string | undefined;
      let committedObservationId: string | undefined;
      return commit({
        saveArtifact: async (artifact) => {
          const created = await operations.saveArtifact(tx, invocation, artifact, input.generationJobId);
          committedArtifactId = created.id;
          return created;
        },
        saveObservation: async (observation) => {
          if (!committedArtifactId) throw new Error("Atomic result is missing its Artifact.");
          const created = await tx.observationRecord.create({
            data: {
              observationId: observation.observationId,
              projectId: invocation.projectId,
              taskId: invocation.taskId,
              invocationId: invocation.invocationId,
              intentEpoch: invocation.intentEpoch,
              status: observation.status,
              reasonCodesJson: JSON.stringify(uniqueText(observation.reasonCodes)),
              payloadJson: JSON.stringify(observation.payload),
              artifactId: committedArtifactId,
            },
          });
          committedObservationId = created.observationId;
          return created;
        },
        saveEvent: async (event) => {
          if (!committedArtifactId || !committedObservationId) {
            throw new Error("Atomic result is missing its Observation.");
          }
          const created = await operations.appendEvent(tx, enrichEvent(
            event,
            input.observation,
            invocation.toolName,
            committedArtifactId,
            input.generationJobId,
          ));
          const finishedAt = new Date();
          await finishInvocation(tx, invocation, committedObservationId, finishedAt, committedArtifactId);
          if (generationJob) {
            await finishGenerationJob(tx, invocation, generationJob, committedArtifactId);
          }
          await appendResolvedToolInvocationAudit(tx, {
            attempted,
            observationId: committedObservationId,
            invocationStatus: "succeeded",
            occurredAt: finishedAt,
          });
          await operations.advancePlanRevision(tx, invocation);
          return created;
        },
      });
    }),
    artifact: input.artifact,
    observation: input.observation,
    event: input.event,
  });
}

export function commitToolObservationResult(
  client: PrismaClient,
  input: CommitToolObservationInput,
  allowSucceeded: boolean,
  operations: ToolResultCommitOperations,
) {
  return client.$transaction(async (tx) => {
    const { invocation, attempted } = await requireActiveToolInvocationAuthority(tx, input.invocationId);
    assertToolEventRunBinding(input.event, attempted);
    const invocationStatus = assertToolTerminalEventBinding(
      input.event,
      invocation,
      input.observation.observationId,
      input.observation.status,
    );
    if (!allowSucceeded && invocationStatus === "succeeded") {
      throw new Error("Tool failure commit cannot persist a successful terminal result.");
    }
    const resultMode = requireFrozenToolResultMode(attempted);
    if (input.event.kind !== expectedToolTerminalEventKind(input.observation.status, invocationStatus, resultMode)) {
      throw new Error("Tool result event kind is invalid.");
    }
    if (input.existingArtifact && input.generationJob) {
      throw new Error("Tool result cannot bind an existing Artifact and fail a GenerationJob together.");
    }
    const generationJob = input.generationJob
      ? await requireBoundGenerationJob(
          tx,
          invocation,
          attempted.authority,
          input.generationJob.jobId,
          ["queued", "running", "failed", "submission_unknown"],
        )
      : null;
    const existingArtifact = await resolveExistingArtifactResult(
      tx,
      invocation,
      attempted,
      input,
      invocationStatus,
      resultMode,
    );
    if (input.validationReport) {
      await saveToolInvocationValidationReport(tx, invocation, input.validationReport, generationJob);
    }
    const observation = await tx.observationRecord.create({
      data: {
        observationId: input.observation.observationId,
        projectId: invocation.projectId,
        taskId: invocation.taskId,
        invocationId: invocation.invocationId,
        intentEpoch: invocation.intentEpoch,
        status: input.observation.status,
        reasonCodesJson: JSON.stringify(uniqueText(input.observation.reasonCodes)),
        payloadJson: JSON.stringify(input.observation.payload),
        artifactId: existingArtifact?.id,
      },
    });
    const event = await operations.appendEvent(
      tx,
      enrichEvent(
        input.event,
        input.observation,
        invocation.toolName,
        existingArtifact?.id,
        input.existingArtifact?.generationJobId ?? input.generationJob?.jobId,
      ),
    );
    const finishedAt = new Date();
    await finishInvocation(tx, invocation, observation.observationId, finishedAt, existingArtifact?.id, invocationStatus);
    if (input.generationJob && generationJob) {
      await failGenerationJob(tx, invocation, input.generationJob, generationJob);
    }
    await appendResolvedToolInvocationAudit(tx, {
      attempted,
      observationId: observation.observationId,
      invocationStatus,
      occurredAt: finishedAt,
    });
    await operations.advancePlanRevision(tx, invocation);
    return { observation, event };
  });
}

function enrichEvent(
  event: AgentEventInput,
  observation: ToolResultObservationInput,
  toolName: string,
  artifactId?: string,
  generationJobId?: string,
): AgentEventInput {
  const payload = { ...event.payload };
  for (const field of ["observationId", "status", "reasonCodes", "toolName", "artifactId", "generationJobId"]) {
    delete payload[field];
  }
  return {
    ...event,
    payload: {
      ...payload,
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: uniqueText(observation.reasonCodes),
      toolName,
      ...(artifactId ? { artifactId } : {}),
      ...(generationJobId ? { generationJobId } : {}),
    },
  };
}

async function finishInvocation(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  observationId: string,
  finishedAt: Date,
  artifactId?: string,
  status: "succeeded" | "failed" | "blocked" = "succeeded",
) {
  const terminal = await tx.toolInvocationRecord.updateMany({
    where: { invocationId: invocation.invocationId, status: "running" },
    data: { status, artifactId, observationId, finishedAt },
  });
  if (terminal.count !== 1) throw new Error("Tool invocation is not active.");
}

async function finishGenerationJob(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  generationJob: GenerationJob,
  artifactId: string,
) {
  const updated = await tx.generationJob.updateMany({
    where: {
      id: generationJob.id,
      projectId: invocation.projectId,
      intentEpoch: invocation.intentEpoch,
      inputHash: generationJob.inputHash,
      runInputSnapshotId: generationJob.runInputSnapshotId,
      status: { in: ["queued", "running"] },
    },
    data: {
      status: "succeeded",
      pollState: "completed",
      resultArtifactId: artifactId,
      errorMessage: null,
      finishedAt: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new Error("GenerationJob cannot be completed from the current Tool invocation.");
  }
}

async function failGenerationJob(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  input: NonNullable<CommitToolObservationInput["generationJob"]>,
  generationJob: GenerationJob,
) {
  const allowedStatuses = input.status === "submission_unknown"
    ? ["queued", "running", "submission_unknown"]
    : ["queued", "running", "failed"];
  const updated = await tx.generationJob.updateMany({
    where: {
      id: generationJob.id,
      projectId: invocation.projectId,
      intentEpoch: invocation.intentEpoch,
      inputHash: generationJob.inputHash,
      runInputSnapshotId: generationJob.runInputSnapshotId,
      resultArtifactId: null,
      status: { in: allowedStatuses },
    },
    data: {
      status: input.status,
      pollState: input.status === "submission_unknown" ? "submission_unknown" : "failed",
      errorMessage: input.errorMessage,
      finishedAt: new Date(),
    },
  });
  if (updated.count !== 1) throw new Error("GenerationJob cannot be failed from the current Tool invocation.");
}

function assertToolEventRunBinding(
  event: AgentEventInput,
  attempted: { authority: string; teacherMessageId: string | null; toolInvocationId: string | null },
) {
  const expectedRunId = attempted.authority === "artifact_route"
    ? attempted.toolInvocationId ? `artifact-route:${attempted.toolInvocationId}` : null
    : attempted.teacherMessageId ? `turn:${attempted.teacherMessageId}` : null;
  if (!expectedRunId || event.runId !== expectedRunId) {
    throw new Error("Tool result event run does not match the frozen TurnJob.");
  }
}

async function resolveExistingArtifactResult(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  attempted: { authority: string },
  input: CommitToolObservationInput,
  invocationStatus: "succeeded" | "failed" | "blocked",
  resultMode: ToolResultMode,
) {
  if (invocationStatus !== "succeeded") {
    if (input.existingArtifact) throw new Error("Failed or blocked Tool result cannot bind an Artifact.");
    return null;
  }
  if (resultMode === "observation_only") {
    if (input.existingArtifact) throw new Error("Observation-only Tool cannot bind an Artifact.");
    return null;
  }
  if (!input.existingArtifact) throw new Error("Artifact-producing Tool succeeded without an Artifact binding.");
  if (attempted.authority !== "artifact_route") {
    throw new Error("Existing Artifact replay is not authorized by the artifact route contract.");
  }
  const envelope = parseExecutionEnvelope(invocation.executionEnvelopeJson);
  const request = parseRecord(invocation.requestJson);
  const contract = request ? resolveServerToolResultContract(invocation.toolName, request) : null;
  const artifact = await tx.artifact.findUnique({ where: { id: input.existingArtifact.artifactId } });
  if (!request || !contract || contract.resultMode !== "artifact_required" || !contract.artifactKind || !contract.capabilityId ||
      !artifact || artifact.projectId !== invocation.projectId || artifact.taskId !== invocation.taskId ||
      artifact.taskBriefDigest !== envelope.taskBriefDigest || artifact.intentEpoch !== invocation.intentEpoch ||
      !hasCompatibleArtifactPlanRevision(artifact.planRevision ?? -1, invocation.planRevision) ||
      artifact.origin !== "tool_result" ||
      artifact.kind !== contract.artifactKind || artifact.nodeKey !== contract.artifactKind) {
    throw new Error("Existing Artifact result does not match the Tool result contract.");
  }
  let generationJob: GenerationJob;
  try {
    generationJob = await requireBoundGenerationJob(
      tx,
      invocation,
      attempted.authority,
      input.existingArtifact.generationJobId,
      ["succeeded"],
    );
  } catch {
    throw new Error("Existing Artifact result is not bound to the completed GenerationJob.");
  }
  if (generationJob.resultArtifactId !== artifact.id) {
    throw new Error("Existing Artifact result is not bound to the completed GenerationJob.");
  }
  try {
    await requirePersistedProviderGenerationEvidence(tx, invocation, generationJob, artifact);
  } catch {
    throw new Error("Existing Artifact result is not bound to valid persisted Provider evidence.");
  }
  return artifact;
}

async function saveToolInvocationValidationReport(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  report: ValidationReport,
  generationJob?: GenerationJob | null,
) {
  let tool;
  try {
    tool = getToolDefinition(invocation.toolName);
  } catch {
    throw new Error("Tool invocation ValidationReport is invalid.");
  }
  const contract = resolveRuntimeContract(tool);
  const expectedInputHash = generationJob ? generationJob.inputHash : invocation.idempotencyKey;
  if (!hasValidValidationReportDigest(report) || report.overallStatus !== "failed" ||
      report.target.kind !== "tool_invocation" || report.target.targetId !== invocation.invocationId ||
      report.target.targetVersion !== undefined || report.target.targetDigest !== undefined ||
      report.authority !== "deterministic" || report.domain !== validationDomainForCapability(contract.capabilityId) ||
      report.stage !== contract.capabilityId || report.contract.id !== contract.id ||
      report.contract.version !== contract.version || report.inputHash !== expectedInputHash ||
      report.intentEpoch !== invocation.intentEpoch) {
    throw new Error("Tool invocation ValidationReport is invalid.");
  }
  const createdAt = new Date(report.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Validation report createdAt is invalid.");
  await tx.validationReportRecord.create({
    data: {
      id: report.reportId, projectId: invocation.projectId, capabilityId: contract.capabilityId,
      stage: report.stage, authority: report.authority, domain: report.domain,
      targetKind: report.target.kind, targetId: report.target.targetId,
      targetVersion: report.target.targetVersion, targetDigest: report.target.targetDigest,
      inputHash: report.inputHash, intentEpoch: report.intentEpoch,
      contractId: report.contract.id, contractVersion: report.contract.version,
      overallStatus: report.overallStatus, reportDigest: report.reportDigest,
      payloadJson: JSON.stringify(report), createdAt,
    },
  });
}

function parseExecutionEnvelope(value: string): ExecutionEnvelope {
  return JSON.parse(value) as ExecutionEnvelope;
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return record(parsed);
  } catch {
    return null;
  }
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

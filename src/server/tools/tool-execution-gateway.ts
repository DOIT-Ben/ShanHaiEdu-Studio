import { createHash } from "node:crypto";

import {
  hasValidExecutionEnvelope,
  type ExecutionEnvelope,
} from "@/server/conversation/task-contract";
import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

export type ToolGatewayRequest = {
  toolName: string;
  projectId: string;
  intentEpoch: number;
  arguments: Record<string, unknown>;
};

export type CurrentToolExecutionScope = {
  actorUserId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
  intensity: GenerationIntensity;
  taskBriefDigest?: string;
};

export type ToolGatewayFailureReason =
  | "execution_envelope_required"
  | "execution_envelope_invalid"
  | "execution_actor_mismatch"
  | "execution_project_mismatch"
  | "execution_task_mismatch"
  | "execution_intent_epoch_mismatch"
  | "execution_plan_revision_mismatch"
  | "execution_intensity_mismatch"
  | "execution_task_brief_digest_required"
  | "execution_task_brief_digest_mismatch"
  | "execution_action_mismatch"
  | "execution_not_authorized"
  | "execution_grant_expired";

export type ToolGatewayFailure = {
  status: "failed";
  reasonCode: ToolGatewayFailureReason;
};

export type ValidatedToolExecution = {
  request: ToolGatewayRequest;
  executionEnvelope: ExecutionEnvelope;
  idempotencyKey: string;
};

export async function executeThroughToolGateway<TResult>(input: {
  request: ToolGatewayRequest;
  current: CurrentToolExecutionScope;
  executionEnvelope?: ExecutionEnvelope;
  execute: (input: ValidatedToolExecution) => Promise<TResult> | TResult;
}): Promise<TResult | ToolGatewayFailure> {
  const envelope = input.executionEnvelope;
  if (!envelope) return failure("execution_envelope_required");
  if (!hasValidExecutionEnvelope(envelope)) return failure("execution_envelope_invalid");

  const scopeFailure = validateCurrentScope(input.request, input.current, envelope);
  if (scopeFailure) return failure(scopeFailure);

  return input.execute({
    request: input.request,
    executionEnvelope: envelope,
    idempotencyKey: envelope.idempotencyKey,
  });
}

function validateCurrentScope(
  request: ToolGatewayRequest,
  current: CurrentToolExecutionScope,
  envelope: ExecutionEnvelope,
): ToolGatewayFailureReason | undefined {
  if (envelope.actorUserId !== current.actorUserId.trim()) return "execution_actor_mismatch";
  if (request.projectId !== current.projectId || envelope.projectId !== current.projectId) {
    return "execution_project_mismatch";
  }
  if (envelope.taskId !== current.taskId) return "execution_task_mismatch";
  if (request.intentEpoch !== current.intentEpoch || envelope.intentEpoch !== current.intentEpoch) {
    return "execution_intent_epoch_mismatch";
  }
  if (envelope.planRevision !== current.planRevision) return "execution_plan_revision_mismatch";
  if (envelope.intensity !== current.intensity) return "execution_intensity_mismatch";

  if (!current.taskBriefDigest) return "execution_task_brief_digest_required";
  if (envelope.taskBriefDigest !== current.taskBriefDigest) return "execution_task_brief_digest_mismatch";
  if (envelope.actionDigest !== digestAction(request)) return "execution_action_mismatch";
  if (envelope.intentGrant.standardWorkAuthorized !== true) return "execution_not_authorized";
  if (isExpired(envelope.intentGrant.expiresAt)) return "execution_grant_expired";

  return undefined;
}

function digestAction(request: ToolGatewayRequest) {
  const normalized = {
    toolName: request.toolName.trim(),
    arguments: request.arguments,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function isExpired(expiresAt: string | null) {
  if (expiresAt === null) return false;
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now();
}

function failure(reasonCode: ToolGatewayFailureReason): ToolGatewayFailure {
  return { status: "failed", reasonCode };
}

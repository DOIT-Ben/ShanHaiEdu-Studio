import type { PrismaClient } from "@/generated/prisma/client";
import {
  normalizeExternalAuditRepairHandoff,
  type ExternalAuditRepairHandoff,
  type ExternalAuditTaskBinding,
} from "@/server/conversation/external-audit-repair-contract";
import {
  commitExternalAuditRepairEvidence,
  type ExternalAuditRunStateBinding,
} from "@/server/conversation/external-audit-evidence-transaction";

export type { ExternalAuditRunStateBinding } from "@/server/conversation/external-audit-evidence-transaction";

export async function ingestExternalAuditRepairEvidence(input: {
  client: PrismaClient;
  runStateBinding: ExternalAuditRunStateBinding;
  handoff: ExternalAuditRepairHandoff;
}) {
  const handoff = normalizeExternalAuditRepairHandoff(input.handoff);
  const binding = normalizeRunStateBinding(input.runStateBinding);
  assertRunStateBinding(handoff, binding);
  return commitExternalAuditRepairEvidence({ client: input.client, binding, handoff });
}

function assertRunStateBinding(handoff: ExternalAuditRepairHandoff, binding: ExternalAuditRunStateBinding) {
  if (handoff.runId !== binding.runId || handoff.manifestSha256 !== binding.manifestSha256 ||
      handoff.packageArtifactId !== binding.packageArtifactId ||
      handoff.packageArtifactVersion !== binding.packageArtifactVersion ||
      handoff.packageVersion !== binding.packageVersion || handoff.packageSha256 !== binding.packageSha256 ||
      JSON.stringify(handoff.taskBinding) !== JSON.stringify(pickTaskBinding(binding))) {
    throw new Error("external_audit_run_state_binding_mismatch");
  }
}

function normalizeRunStateBinding(value: ExternalAuditRunStateBinding): ExternalAuditRunStateBinding {
  const binding = value as unknown as Record<string, unknown>;
  return {
    actorUserId: requiredText(binding.actorUserId),
    actorAuthMode: requiredAuthMode(binding.actorAuthMode),
    runId: requiredText(binding.runId),
    manifestSha256: requiredDigest(binding.manifestSha256),
    packageArtifactId: requiredText(binding.packageArtifactId),
    packageArtifactVersion: requiredPositiveInteger(binding.packageArtifactVersion),
    packageVersion: requiredText(binding.packageVersion),
    packageSha256: requiredDigest(binding.packageSha256),
    projectId: requiredText(binding.projectId),
    taskId: requiredText(binding.taskId),
    intentEpoch: requiredNonNegativeInteger(binding.intentEpoch),
    taskBriefDigest: requiredDigest(binding.taskBriefDigest),
    planRevision: requiredNonNegativeInteger(binding.planRevision),
    turnJobId: requiredText(binding.turnJobId),
    teacherMessageId: requiredText(binding.teacherMessageId),
    idempotencyKey: requiredText(binding.idempotencyKey),
  };
}

function pickTaskBinding(binding: ExternalAuditRunStateBinding): ExternalAuditTaskBinding {
  return {
    actorUserId: binding.actorUserId,
    actorAuthMode: binding.actorAuthMode,
    projectId: binding.projectId,
    taskId: binding.taskId,
    intentEpoch: binding.intentEpoch,
    taskBriefDigest: binding.taskBriefDigest,
    planRevision: binding.planRevision,
    turnJobId: binding.turnJobId,
    teacherMessageId: binding.teacherMessageId,
    idempotencyKey: binding.idempotencyKey,
  };
}

function requiredAuthMode(value: unknown): "local" | "password" | "oauth" | "sso" {
  if (value !== "local" && value !== "password" && value !== "oauth" && value !== "sso") {
    throw new Error("external_audit_run_state_binding_invalid");
  }
  return value;
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("external_audit_run_state_binding_invalid");
  return value.trim();
}

function requiredDigest(value: unknown) {
  const digest = requiredText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("external_audit_run_state_binding_invalid");
  return digest;
}

function requiredNonNegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("external_audit_run_state_binding_invalid");
  return Number(value);
}

function requiredPositiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("external_audit_run_state_binding_invalid");
  return Number(value);
}

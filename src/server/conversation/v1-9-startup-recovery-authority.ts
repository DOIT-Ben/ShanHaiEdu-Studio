import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import { restoreMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import { isTaskBrief } from "@/server/conversation/task-contract";
import {
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  type V1_9RunManifestV2,
  type V1_9RunState,
} from "../../../scripts/lib/v1-9-e2e-contract.mjs";
import { assertCanonicalExistingPathChain } from "../../../scripts/lib/physical-path-integrity.mjs";

const providerHealthReasons = new Set([
  "main_agent_provider_policy_blocked",
  "main_agent_provider_authorization_failed",
  "main_agent_provider_unavailable",
]);

const contractRepairErrors = new Set([
  "main_agent_execution_failed",
  "control_plane_lifecycle_conflict",
  "main_agent_retry_budget_exhausted",
]);

export type V1_9StartupRecoveryIdentity = {
  projectId: string;
  taskId: string;
  intentEpoch: number;
  teacherMessageId: string;
  turnJobId: string;
  actorUserId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  authSessionId: string | null;
  planId: string;
  planRevision: number;
  checkpointId: string;
  taskBriefDigest: string;
  recoveryEvidenceDigest: string | null;
};

export type V1_9StartupRecoveryDisposition =
  | { kind: "none" }
  | {
      kind: "interrupted_running" | "checkpoint" | "provider_health" | "contract_repair" | "external_audit";
      identity: V1_9StartupRecoveryIdentity;
      reasonCode: string;
    };

export type V1_9StartupRecoveryRunContext = {
  runId: string;
  manifestPath: string;
  statePath: string;
  manifest: V1_9RunManifestV2;
  runState: V1_9RunState;
};

export function readV1_9StartupRecoveryRunContext(input: {
  cwd: string;
  manifestPath: string;
  statePath: string;
}): V1_9StartupRecoveryRunContext {
  try {
    const cwd = assertCanonicalExistingPathChain(path.resolve(input.cwd));
    const pointerPath = assertCanonicalExistingPathChain(path.join(cwd, "test-results", "v1-9-product-e2e-active.json"));
    const pointer = strictRecord(JSON.parse(readFileSync(pointerPath, "utf8")), [
      "schemaVersion", "runId", "relativeRunRoot", "manifestPath", "manifestSha256", "statePath",
    ]);
    if (pointer.schemaVersion !== "v1-9-active-run.v2") throw invalidRecoveryIdentity();
    const runId = requiredSafeText(pointer.runId);
    const relativeRunRoot = requiredRelativeRunRoot(pointer.relativeRunRoot, runId);
    const runRoot = path.resolve(cwd, ...relativeRunRoot.split("/"));
    const manifestPath = expectedRunFile(cwd, runRoot, pointer.manifestPath, "run-manifest.json");
    const statePath = expectedRunFile(cwd, runRoot, pointer.statePath, "run-state.json");
    if (path.resolve(input.manifestPath) !== manifestPath || path.resolve(input.statePath) !== statePath) {
      throw invalidRecoveryIdentity();
    }
    assertCanonicalExistingPathChain(manifestPath);
    assertCanonicalExistingPathChain(statePath);
    const manifestBytes = readFileSync(manifestPath);
    const manifest = normalizeV1_9RunManifestV2(JSON.parse(manifestBytes.toString("utf8")));
    const runState = normalizeV1_9RunState(JSON.parse(readFileSync(statePath, "utf8")));
    const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
    if (manifest.runId !== runId || runState.runId !== runId || runState.manifestSha256 !== manifestSha256 ||
        sha256(manifestBytes) !== manifestSha256 || requiredDigest(pointer.manifestSha256) !== manifestSha256) {
      throw invalidRecoveryIdentity();
    }
    return { runId, manifestPath, statePath, manifest, runState };
  } catch (error) {
    if (error instanceof Error && error.message === "v1_9_startup_recovery_identity_invalid") throw error;
    throw invalidRecoveryIdentity();
  }
}

export async function resolveV1_9StartupRecoveryDisposition(input: {
  client: PrismaClient;
  runState: unknown;
  now?: Date;
}): Promise<V1_9StartupRecoveryDisposition> {
  const state = normalizeV1_9RunState(input.runState);
  if (isNoRecoveryState(state.status)) return { kind: "none" };

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw invalidRecoveryIdentity();
  const frozen = frozenIdentity(state);
  const facts = await input.client.$transaction(async (tx) => {
    const [project, aggregate, teacherMessage, turnJob, otherActiveJobs] = await Promise.all([
      tx.project.findUnique({
        where: { id: frozen.projectId },
        select: { status: true, archivedAt: true, deletedAt: true, intentEpoch: true },
      }),
      tx.taskAggregate.findUnique({ where: { taskId: frozen.taskId } }),
      tx.conversationMessage.findFirst({
        where: { id: frozen.teacherMessageId, projectId: frozen.projectId, role: "teacher" },
        select: { metadataJson: true },
      }),
      tx.conversationTurnJob.findFirst({
        where: { id: frozen.turnJobId, projectId: frozen.projectId },
      }),
      tx.conversationTurnJob.count({
        where: {
          projectId: frozen.projectId,
          id: { not: frozen.turnJobId },
          status: { in: ["queued", "running"] },
        },
      }),
    ]);
    const authSession = turnJob?.authSessionId
      ? await tx.authSession.findUnique({ where: { id: turnJob.authSessionId } })
      : null;
    return { project, aggregate, teacherMessage, turnJob, otherActiveJobs, authSession };
  });

  if (!facts.project || facts.project.status !== "active" || facts.project.archivedAt || facts.project.deletedAt ||
      facts.project.intentEpoch !== frozen.intentEpoch || !facts.aggregate || !facts.teacherMessage || !facts.turnJob ||
      facts.otherActiveJobs !== 0) {
    throw invalidRecoveryIdentity();
  }

  const aggregateBrief = parseTaskBrief(facts.aggregate.taskBriefJson);
  const messageBrief = parseTaskBrief(recordValue(parseJson(facts.teacherMessage.metadataJson)).taskBrief);
  const checkpoint = parseCheckpoint(facts.aggregate.checkpointJson);
  if (facts.aggregate.projectId !== frozen.projectId || facts.aggregate.intentEpoch !== frozen.intentEpoch ||
      facts.aggregate.planId !== frozen.planId || facts.aggregate.planRevision !== frozen.planRevision ||
      aggregateBrief.digest !== frozen.taskBriefDigest || aggregateBrief.sourceMessageId !== frozen.teacherMessageId ||
      messageBrief.digest !== frozen.taskBriefDigest || messageBrief.taskId !== frozen.taskId ||
      checkpoint.checkpointDigest !== frozen.checkpointId || checkpoint.task.projectId !== frozen.projectId ||
      checkpoint.task.taskId !== frozen.taskId || checkpoint.task.taskBriefDigest !== frozen.taskBriefDigest ||
      checkpoint.task.intentEpoch !== frozen.intentEpoch || checkpoint.task.planRevision !== frozen.planRevision) {
    throw invalidRecoveryIdentity();
  }

  const job = facts.turnJob;
  if (job.teacherMessageId !== frozen.teacherMessageId || job.actorUserId !== frozen.actorUserId ||
      job.actorAuthMode !== frozen.actorAuthMode) {
    throw invalidRecoveryIdentity();
  }
  assertActiveSession(frozen, job.authSessionId, facts.authSession, now);

  const identity: V1_9StartupRecoveryIdentity = {
    projectId: frozen.projectId,
    taskId: frozen.taskId,
    intentEpoch: frozen.intentEpoch,
    teacherMessageId: frozen.teacherMessageId,
    turnJobId: frozen.turnJobId,
    actorUserId: frozen.actorUserId,
    actorAuthMode: frozen.actorAuthMode,
    authSessionId: job.authSessionId,
    planId: frozen.planId,
    planRevision: frozen.planRevision,
    checkpointId: frozen.checkpointId,
    taskBriefDigest: frozen.taskBriefDigest,
    recoveryEvidenceDigest: job.recoveryEvidenceDigest,
  };

  if (state.status === "running") {
    const queued = job.status === "queued" && job.lockedBy === null && job.lockedUntil === null;
    const expired = job.status === "running" && job.lockedUntil !== null && job.lockedUntil.getTime() <= now.getTime() &&
      job.attempts < job.maxAttempts;
    if (!queued && !expired) throw invalidRecoveryIdentity();
    return { kind: "interrupted_running", identity, reasonCode: queued ? "queued_turn_resume" : "expired_turn_lease" };
  }

  if (state.status === "external_acceptance_repair_required") {
    const repairDigest = state.packageAcceptance?.currentRepair?.repairHandoffDigest;
    if (job.status !== "queued" || !repairDigest || job.recoveryEvidenceDigest !== repairDigest) {
      throw invalidRecoveryIdentity();
    }
    return { kind: "external_audit", identity, reasonCode: "external_acceptance_repair_required" };
  }

  const recovery = state.recovery;
  if (!recovery || recovery.turnJobId !== frozen.turnJobId || recovery.teacherMessageId !== frozen.teacherMessageId) {
    throw invalidRecoveryIdentity();
  }
  if (providerHealthReasons.has(recovery.reasonCode)) {
    const failedForProviderHealth = job.status === "failed" &&
      job.failureRetryability === "after_provider_health_change" && job.errorCode === recovery.reasonCode;
    const resumableProviderHealth = isResumableRecoveryIntermediate(job, now);
    if (!failedForProviderHealth && !resumableProviderHealth) throw invalidRecoveryIdentity();
    return { kind: "provider_health", identity, reasonCode: recovery.reasonCode };
  }
  if (isResumableRecoveryIntermediate(job, now)) {
    const kind = contractRepairErrors.has(recovery.reasonCode) ? "contract_repair" : "checkpoint";
    return { kind, identity, reasonCode: recovery.reasonCode };
  }
  if (job.status === "failed" && job.failureRetryability === "retryable" && job.attempts < job.maxAttempts) {
    return { kind: "checkpoint", identity, reasonCode: recovery.reasonCode };
  }
  const contractRepair = job.status === "succeeded" ||
    (job.status === "failed" && job.failureRetryability === "not_retryable" && Boolean(job.errorCode) &&
      contractRepairErrors.has(job.errorCode!));
  if (contractRepair) return { kind: "contract_repair", identity, reasonCode: recovery.reasonCode };
  throw invalidRecoveryIdentity();
}

export async function requeueV1_9CheckpointRecoveryTurn(input: {
  client: PrismaClient;
  identity: V1_9StartupRecoveryIdentity;
  reasonCode: string;
  now?: Date;
}): Promise<boolean> {
  const identity = input.identity;
  const reasonCode = requiredSafeText(input.reasonCode);
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw invalidRecoveryIdentity();
  return input.client.$transaction(async (tx) => {
    const [project, aggregate, teacherMessage, turnJob, otherActiveJobs] = await Promise.all([
      tx.project.findUnique({
        where: { id: identity.projectId },
        select: { status: true, archivedAt: true, deletedAt: true, intentEpoch: true },
      }),
      tx.taskAggregate.findUnique({ where: { taskId: identity.taskId } }),
      tx.conversationMessage.findFirst({
        where: { id: identity.teacherMessageId, projectId: identity.projectId, role: "teacher" },
        select: { metadataJson: true },
      }),
      tx.conversationTurnJob.findFirst({
        where: { id: identity.turnJobId, projectId: identity.projectId },
      }),
      tx.conversationTurnJob.count({
        where: {
          projectId: identity.projectId,
          id: { not: identity.turnJobId },
          status: { in: ["queued", "running"] },
        },
      }),
    ]);
    if (!project || project.status !== "active" || project.archivedAt || project.deletedAt ||
        project.intentEpoch !== identity.intentEpoch || !aggregate || !teacherMessage || !turnJob ||
        otherActiveJobs !== 0 ||
        turnJob.teacherMessageId !== identity.teacherMessageId || turnJob.actorUserId !== identity.actorUserId ||
        turnJob.actorAuthMode !== identity.actorAuthMode || turnJob.authSessionId !== identity.authSessionId) {
      return false;
    }

    const resumableIntermediate = isResumableRecoveryIntermediate(turnJob, now);
    const freshFailed = turnJob.status === "failed" && turnJob.failureRetryability === "retryable" &&
      turnJob.errorCode === reasonCode && turnJob.attempts < turnJob.maxAttempts;
    if (!resumableIntermediate && !freshFailed) return false;
    const authSession = turnJob.authSessionId
      ? await tx.authSession.findUnique({ where: { id: turnJob.authSessionId } })
      : null;
    assertActiveSession(identity, turnJob.authSessionId, authSession, now);
    const aggregateBrief = parseTaskBrief(aggregate.taskBriefJson);
    const messageBrief = parseTaskBrief(recordValue(parseJson(teacherMessage.metadataJson)).taskBrief);
    const checkpoint = parseCheckpoint(aggregate.checkpointJson);
    if (aggregate.projectId !== identity.projectId || aggregate.intentEpoch !== identity.intentEpoch ||
        aggregate.planId !== identity.planId || aggregate.planRevision !== identity.planRevision ||
        aggregateBrief.digest !== identity.taskBriefDigest || aggregateBrief.sourceMessageId !== identity.teacherMessageId ||
        messageBrief.digest !== identity.taskBriefDigest || messageBrief.taskId !== identity.taskId ||
        checkpoint.checkpointDigest !== identity.checkpointId || checkpoint.task.projectId !== identity.projectId ||
        checkpoint.task.taskId !== identity.taskId || checkpoint.task.taskBriefDigest !== identity.taskBriefDigest ||
        checkpoint.task.intentEpoch !== identity.intentEpoch || checkpoint.task.planRevision !== identity.planRevision) {
      return false;
    }

    const recoveryEvidenceDigest = createHash("sha256").update(JSON.stringify({
      projectId: identity.projectId,
      taskId: identity.taskId,
      intentEpoch: identity.intentEpoch,
      teacherMessageId: identity.teacherMessageId,
      turnJobId: identity.turnJobId,
      checkpointId: identity.checkpointId,
      failureEvidenceDigest: turnJob.failureEvidenceDigest,
      reasonCode,
    })).digest("hex");
    if (resumableIntermediate) return turnJob.recoveryEvidenceDigest === recoveryEvidenceDigest;
    if (turnJob.recoveryEvidenceDigest === recoveryEvidenceDigest ||
        turnJob.failureEvidenceDigest === recoveryEvidenceDigest) return false;
    const updated = await tx.conversationTurnJob.updateMany({
      where: {
        id: identity.turnJobId,
        projectId: identity.projectId,
        status: "failed",
        failureRetryability: "retryable",
        errorCode: reasonCode,
      },
      data: {
        status: "queued",
        recoveryEvidenceDigest,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: null,
      },
    });
    return updated.count === 1;
  });
}

function isResumableRecoveryIntermediate(
  job: { status: string; recoveryEvidenceDigest: string | null; lockedBy: string | null; lockedUntil: Date | null; attempts: number; maxAttempts: number },
  now: Date,
) {
  if (!job.recoveryEvidenceDigest || !/^[a-f0-9]{64}$/i.test(job.recoveryEvidenceDigest)) {
    return false;
  }
  if (job.status === "queued") {
    return job.attempts < job.maxAttempts && job.lockedBy === null && job.lockedUntil === null;
  }
  return job.status === "running" && job.lockedUntil !== null && job.lockedUntil.getTime() <= now.getTime();
}

function frozenIdentity(state: V1_9RunState) {
  const lock = state.taskContractLock;
  const authority = state.orchestrationAuthoritySummary;
  const planId = authority?.subject.planId;
  const checkpointId = state.recovery?.checkpointId ?? state.checkpoint?.checkpointId ?? null;
  if (!lock || !authority || !state.identity.projectId || !state.identity.taskId || state.identity.intentEpoch === null ||
      !state.identity.actorUserId || !checkpointId || authority.subject.planRevision !== state.ledger.currentPlanRevision ||
      typeof planId !== "string" || planId.trim() === "") {
    throw invalidRecoveryIdentity();
  }
  return {
    projectId: state.identity.projectId,
    taskId: state.identity.taskId,
    intentEpoch: state.identity.intentEpoch,
    actorUserId: state.identity.actorUserId,
    actorAuthMode: lock.actorAuthMode,
    teacherMessageId: lock.teacherMessageId,
    turnJobId: lock.turnJobId,
    taskBriefDigest: lock.taskBriefDigest,
    planId,
    planRevision: authority.subject.planRevision,
    checkpointId,
  };
}

function assertActiveSession(
  identity: ReturnType<typeof frozenIdentity>,
  authSessionId: string | null,
  session: { userId: string; authMode: string; expiresAt: Date; revokedAt: Date | null } | null,
  now: Date,
) {
  if (identity.actorAuthMode === "local") {
    if (authSessionId !== null || session !== null) throw invalidRecoveryIdentity();
    return;
  }
  if (!authSessionId || !session || session.userId !== identity.actorUserId ||
      session.authMode !== identity.actorAuthMode || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    throw invalidRecoveryIdentity();
  }
}

function parseTaskBrief(value: unknown) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!isTaskBrief(parsed)) throw invalidRecoveryIdentity();
  return parsed;
}

function parseCheckpoint(value: string) {
  try {
    return restoreMainAgentReActCheckpoint(parseJson(value) as Parameters<typeof restoreMainAgentReActCheckpoint>[0]);
  } catch {
    throw invalidRecoveryIdentity();
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidRecoveryIdentity();
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRecoveryIdentity();
  return value as Record<string, unknown>;
}

function isNoRecoveryState(status: V1_9RunState["status"]) {
  return [
    "prepared",
    "paused_pending_decision",
    "package_ready_for_external_acceptance",
    "completed",
    "terminated_contract_upgrade",
  ].includes(status);
}

function invalidRecoveryIdentity() {
  return new Error("v1_9_startup_recovery_identity_invalid");
}

function strictRecord(value: unknown, fields: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRecoveryIdentity();
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...fields].sort())) throw invalidRecoveryIdentity();
  return record;
}

function requiredSafeText(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9._:-]+$/i.test(value)) throw invalidRecoveryIdentity();
  return value;
}

function requiredRelativeRunRoot(value: unknown, runId: string) {
  if (typeof value !== "string") throw invalidRecoveryIdentity();
  const normalized = value.replaceAll("\\", "/");
  if (normalized !== `test-results/${runId}`) throw invalidRecoveryIdentity();
  return normalized;
}

function expectedRunFile(cwd: string, runRoot: string, value: unknown, fileName: string) {
  if (typeof value !== "string") throw invalidRecoveryIdentity();
  const candidate = path.resolve(cwd, ...value.replaceAll("\\", "/").split("/"));
  if (candidate !== path.join(runRoot, fileName)) throw invalidRecoveryIdentity();
  return candidate;
}

function requiredDigest(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw invalidRecoveryIdentity();
  return value.toLowerCase();
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

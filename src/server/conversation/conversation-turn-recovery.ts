import path from "node:path";

import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import { createWorkbenchActor } from "@/server/auth/actor";
import { prisma } from "@/server/db/client";
import { createAgentToolExecutorFromEnv } from "@/server/tools/openai-agent-tool-executor";
import { createWorkbenchService } from "@/server/workbench/service";

import { drainProjectConversationQueue } from "./conversation-turn-queue";
import {
  recoverV1_9ExternalAuditTurn,
  resolveV1_9ExternalAuditRecoveryAuthority,
  type V1_9ExternalAuditRecoveryAuthority,
} from "./external-audit-startup-recovery";
import { createMainConversationAgentFromEnv, resolveMainAgentToolControlPlane } from "./model-main-conversation-agent";
import {
  resolveV1_9ProviderHealthRecoveryAuthority,
  type RecoveryEnv,
  type V1_9ProviderHealthRecoveryAuthority,
  type V1_9ProviderHealthRecoveryAuthorityDependencies,
} from "./provider-health-startup-recovery";
import {
  verifyContractRepairRecoveryEvidence,
  type ContractRepairRecoveryConfig,
} from "./v1-9-contract-repair-evidence";
import {
  readV1_9StartupRecoveryRunContext,
  requeueV1_9CheckpointRecoveryTurn,
  resolveV1_9StartupRecoveryDisposition,
  type V1_9StartupRecoveryDisposition,
  type V1_9StartupRecoveryIdentity,
  type V1_9StartupRecoveryRunContext,
} from "./v1-9-startup-recovery-authority";

export { resolveContractRepairRecoveryConfig } from "./v1-9-contract-repair-evidence";
export { resolveV1_9ProviderHealthRecoveryAuthority };
export type {
  V1_9ProviderHealthRecoveryAuthority,
  V1_9ProviderHealthRecoveryAuthorityDependencies,
};

const globalRecovery = globalThis as typeof globalThis & { __shanhaiTurnRecoveryPromise?: Promise<void> };

type V1_9StartupRecoveryEvidence =
  | { kind: "none" | "interrupted_running" | "checkpoint" }
  | { kind: "provider_health"; authority: V1_9ProviderHealthRecoveryAuthority }
  | { kind: "contract_repair"; contractRepair: ContractRepairRecoveryConfig }
  | { kind: "external_audit"; authority: V1_9ExternalAuditRecoveryAuthority };

type V1_9StartupRecoveryDependencies = {
  readRunContext(input: { cwd: string; manifestPath: string; statePath: string }): V1_9StartupRecoveryRunContext;
  resolveDisposition(input: { client: typeof prisma; runState: unknown }): Promise<V1_9StartupRecoveryDisposition>;
  validateEvidence(input: {
    cwd: string;
    env: RecoveryEnv;
    context: V1_9StartupRecoveryRunContext;
    disposition: V1_9StartupRecoveryDisposition;
  }): V1_9StartupRecoveryEvidence;
  execute(input: {
    env: RecoveryEnv;
    disposition: V1_9StartupRecoveryDisposition;
    evidence: V1_9StartupRecoveryEvidence;
  }): Promise<void>;
};

export function scheduleRetryableConversationTurnRecovery(env: RecoveryEnv = process.env): Promise<void> {
  if (!shouldInspectV1_9StartupRecovery(env)) return Promise.resolve();
  globalRecovery.__shanhaiTurnRecoveryPromise ??= recoverV1_9StartupConversationTurn(env).then(() => undefined);
  return globalRecovery.__shanhaiTurnRecoveryPromise;
}

export function createV1_9StartupRecoverySingleFlight() {
  let recovery: Promise<void> | undefined;
  return (operation: () => Promise<void>) => recovery ??= operation();
}

export async function recoverV1_9StartupConversationTurn(
  env: RecoveryEnv,
  dependencies: Partial<V1_9StartupRecoveryDependencies> = {},
) {
  if (!shouldInspectV1_9StartupRecovery(env)) return { kind: "none" } as const;
  const deps = { ...defaultStartupDependencies, ...dependencies };
  const cwd = resolveV1_9RepositoryRoot(env);
  const context = deps.readRunContext({
    cwd,
    manifestPath: env.V1_9_E2E_MANIFEST_PATH,
    statePath: env.V1_9_E2E_STATE_PATH,
  });
  const disposition = await deps.resolveDisposition({ client: prisma, runState: context.runState });
  const evidence = deps.validateEvidence({ cwd, env, context, disposition });
  await deps.execute({ env, disposition, evidence });
  return disposition;
}

export function shouldInspectV1_9StartupRecovery(
  env: RecoveryEnv,
): env is RecoveryEnv & Required<Pick<RecoveryEnv, "V1_9_E2E_MANIFEST_PATH" | "V1_9_E2E_STATE_PATH">> {
  const hasManifest = Boolean(env.V1_9_E2E_MANIFEST_PATH?.trim());
  const hasState = Boolean(env.V1_9_E2E_STATE_PATH?.trim());
  if (hasManifest !== hasState) throw new Error("v1_9_startup_recovery_paths_incomplete");
  return hasManifest && hasState;
}

export function resolveV1_9RepositoryRoot(env: Pick<RecoveryEnv, "SHANHAI_V1_9_REPOSITORY_ROOT">) {
  const configured = env.SHANHAI_V1_9_REPOSITORY_ROOT?.trim();
  if (!configured) return process.cwd();
  if (!path.isAbsolute(configured)) throw new Error("v1_9_repository_root_invalid");
  return path.resolve(configured);
}

function validateStartupRecoveryEvidence(input: {
  cwd: string;
  env: RecoveryEnv;
  context: V1_9StartupRecoveryRunContext;
  disposition: V1_9StartupRecoveryDisposition;
}): V1_9StartupRecoveryEvidence {
  if (input.disposition.kind === "none" || input.disposition.kind === "interrupted_running" ||
      input.disposition.kind === "checkpoint") return { kind: input.disposition.kind };
  if (input.disposition.kind === "contract_repair") {
    const contractRepair = verifyContractRepairRecoveryEvidence({
      cwd: input.cwd,
      env: input.env,
      manifestPath: input.context.manifestPath,
      statePath: input.context.statePath,
      manifest: input.context.manifest,
      runState: input.context.runState,
    });
    if (!contractRepair) throw new Error("v1_9_startup_recovery_evidence_missing");
    assertRecoveryIdentity(input.disposition.identity, contractRepair);
    return { kind: "contract_repair", contractRepair };
  }
  if (input.disposition.kind === "external_audit") {
    const authority = resolveV1_9ExternalAuditRecoveryAuthority({ cwd: input.cwd, env: input.env });
    if (!authority) throw new Error("v1_9_startup_recovery_evidence_missing");
    assertRecoveryIdentity(input.disposition.identity, authority);
    return { kind: "external_audit", authority };
  }
  if (!input.env.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID?.trim()) {
    throw new Error("v1_9_startup_recovery_evidence_missing");
  }
  const authority = resolveV1_9ProviderHealthRecoveryAuthority({ cwd: input.cwd, env: input.env });
  assertRecoveryIdentity(input.disposition.identity, authority);
  return { kind: "provider_health", authority };
}

async function executeStartupRecovery(input: {
  env: RecoveryEnv;
  disposition: V1_9StartupRecoveryDisposition;
  evidence: V1_9StartupRecoveryEvidence;
}) {
  if (input.disposition.kind !== input.evidence.kind) throw new Error("v1_9_startup_recovery_evidence_mismatch");
  if (input.disposition.kind === "none") return;
  if (input.disposition.kind === "contract_repair" && input.evidence.kind === "contract_repair") {
    await recoverContractRepairTurn(input.evidence.contractRepair, input.disposition.identity, input.env);
    return;
  }
  if (input.disposition.kind === "external_audit" && input.evidence.kind === "external_audit") {
    const expectedJobId = input.disposition.identity.turnJobId;
    await recoverV1_9ExternalAuditTurn({
      client: prisma,
      authority: input.evidence.authority,
      expectedAuthSessionId: input.disposition.identity.authSessionId,
      drainProject: async (identity) => {
        const service = serviceForJob(identity);
        await drainRecoveredProject(identity.projectId, expectedJobId, service, input.env);
      },
    });
    return;
  }
  if (input.disposition.kind === "provider_health" && input.evidence.kind === "provider_health") {
    await recoverProviderHealthTurn(input.evidence.authority, input.disposition.identity, input.env);
    return;
  }
  const identity = input.disposition.identity;
  const service = serviceForJob(identity);
  if (input.disposition.kind === "checkpoint") {
    const recovered = await requeueV1_9CheckpointRecoveryTurn({
      client: prisma,
      identity,
      reasonCode: input.disposition.reasonCode,
    });
    if (!recovered) throw new Error("v1_9_startup_recovery_requeue_failed");
  }
  await drainRecoveredProject(identity.projectId, identity.turnJobId, service, input.env);
}

async function recoverContractRepairTurn(
  contractRepair: ContractRepairRecoveryConfig,
  expected: V1_9StartupRecoveryIdentity,
  env: RecoveryEnv,
) {
  const job = await prisma.conversationTurnJob.findUnique({ where: { id: contractRepair.jobId } });
  const recoveryDigestMatches = job?.recoveryEvidenceDigest === contractRepair.repairEvidenceDigest;
  const resumable = job?.status === "queued" || job?.status === "running";
  if (!job || job.projectId !== contractRepair.projectId || job.teacherMessageId !== contractRepair.teacherMessageId ||
      job.actorUserId !== expected.actorUserId || job.actorAuthMode !== expected.actorAuthMode ||
      job.authSessionId !== expected.authSessionId || !isAuthMode(job.actorAuthMode) ||
      (resumable && !recoveryDigestMatches)) {
    throw new Error("v1_9_startup_recovery_identity_changed");
  }
  const service = serviceForJob({
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
  });
  if (!resumable) {
    const recovered = await service.requeueConversationTurnJobAfterContractRepair(job.projectId, job.id, contractRepair);
    if (!recovered) throw new Error("v1_9_startup_recovery_requeue_failed");
  }
  await drainRecoveredProject(job.projectId, job.id, service, env);
}

async function recoverProviderHealthTurn(
  authority: V1_9ProviderHealthRecoveryAuthority,
  expected: V1_9StartupRecoveryIdentity,
  env: RecoveryEnv,
) {
  const job = await prisma.conversationTurnJob.findUnique({ where: { id: authority.turnJobId } });
  const recoveryDigestMatches = job?.recoveryEvidenceDigest === authority.recoveryEvidenceDigest;
  const resumable = job?.status === "queued" || job?.status === "running";
  if (!job || job.projectId !== authority.projectId || job.teacherMessageId !== authority.teacherMessageId ||
      (!resumable && (job.status !== "failed" || job.failureRetryability !== "after_provider_health_change" ||
        job.errorCode !== authority.reasonCode)) || (resumable && !recoveryDigestMatches) ||
      job.actorUserId !== expected.actorUserId ||
      job.actorAuthMode !== expected.actorAuthMode || job.authSessionId !== expected.authSessionId ||
      !isAuthMode(job.actorAuthMode)) throw new Error("v1_9_startup_recovery_identity_changed");
  const service = serviceForJob({
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
  });
  if (!resumable) {
    const recovered = await service.requeueConversationTurnJobAfterProviderHealth(job.projectId, job.id, {
      projectId: authority.projectId,
      jobId: authority.turnJobId,
      teacherMessageId: authority.teacherMessageId,
      taskId: authority.taskId,
      intentEpoch: authority.intentEpoch,
      expectedErrorCode: authority.reasonCode,
      recoveryEvidenceDigest: authority.recoveryEvidenceDigest,
    });
    if (!recovered) throw new Error("v1_9_startup_recovery_requeue_failed");
  }
  await drainRecoveredProject(job.projectId, job.id, service, env);
}

function assertRecoveryIdentity(
  expected: V1_9StartupRecoveryIdentity,
  actual: {
    projectId: string;
    taskId: string;
    intentEpoch: number;
    teacherMessageId: string;
    turnJobId?: string;
    jobId?: string;
    actorUserId?: string;
    actorAuthMode?: string;
    recoveryEvidenceDigest?: string;
    repairEvidenceDigest?: string;
    handoffDigest?: string;
  },
) {
  if (actual.projectId !== expected.projectId || actual.taskId !== expected.taskId ||
      actual.intentEpoch !== expected.intentEpoch || actual.teacherMessageId !== expected.teacherMessageId ||
      (actual.turnJobId ?? actual.jobId) !== expected.turnJobId ||
      (actual.actorUserId !== undefined && actual.actorUserId !== expected.actorUserId) ||
      (actual.actorAuthMode !== undefined && actual.actorAuthMode !== expected.actorAuthMode)) {
    throw new Error("v1_9_startup_recovery_evidence_mismatch");
  }
  const evidenceDigest = actual.recoveryEvidenceDigest ?? actual.repairEvidenceDigest ?? actual.handoffDigest;
  if (expected.recoveryEvidenceDigest && evidenceDigest !== expected.recoveryEvidenceDigest) {
    throw new Error("v1_9_startup_recovery_evidence_mismatch");
  }
}

const defaultStartupDependencies: V1_9StartupRecoveryDependencies = {
  readRunContext: readV1_9StartupRecoveryRunContext,
  resolveDisposition: resolveV1_9StartupRecoveryDisposition,
  validateEvidence: validateStartupRecoveryEvidence,
  execute: executeStartupRecovery,
};

function serviceForJob(job: {
  actorUserId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  authSessionId: string | null;
}) {
  const actor = createWorkbenchActor({
    userId: job.actorUserId,
    displayName: "恢复中的教师任务",
    authMode: job.actorAuthMode,
  });
  return createWorkbenchService(undefined, actor, {
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
  });
}

async function drainRecoveredProject(
  projectId: string,
  expectedJobId: string,
  service: ReturnType<typeof createWorkbenchService>,
  env: RecoveryEnv,
) {
  const runtime = createAgentRuntimeFromEnv(env);
  const agent = createMainConversationAgentFromEnv(env);
  const agentToolExecutor = createAgentToolExecutorFromEnv(env);
  const controlPlane = resolveMainAgentToolControlPlane(env);
  const result = await drainProjectConversationQueue(projectId, {
    service,
    expectedJobId,
    runtime,
    agent,
    agentToolExecutor,
    enableTaskGrantAutonomy: true,
    enableNativeToolControlPlane: controlPlane === "native",
  });
  if (result.started !== 1) throw new Error("v1_9_startup_recovery_claim_failed");
}

function isAuthMode(value: string | null): value is "local" | "password" | "oauth" | "sso" {
  return value === "local" || value === "password" || value === "oauth" || value === "sso";
}

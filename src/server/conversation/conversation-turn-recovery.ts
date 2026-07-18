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

export { resolveContractRepairRecoveryConfig } from "./v1-9-contract-repair-evidence";
export { resolveV1_9ProviderHealthRecoveryAuthority };
export type {
  V1_9ProviderHealthRecoveryAuthority,
  V1_9ProviderHealthRecoveryAuthorityDependencies,
};

const globalRecovery = globalThis as typeof globalThis & { __shanhaiTurnRecoveryScheduled?: boolean };

export function scheduleRetryableConversationTurnRecovery(env: RecoveryEnv = process.env) {
  if (globalRecovery.__shanhaiTurnRecoveryScheduled || !shouldInspectV1_9StartupRecovery(env)) return;

  let authority: V1_9ProviderHealthRecoveryAuthority | null = null;
  let externalAuditAuthority: V1_9ExternalAuditRecoveryAuthority | null = null;
  let contractRepair: ContractRepairRecoveryConfig | null;
  try {
    const repositoryRoot = resolveV1_9RepositoryRoot(env);
    contractRepair = verifyContractRepairRecoveryEvidence({
      cwd: repositoryRoot,
      env,
      manifestPath: env.V1_9_E2E_MANIFEST_PATH,
      statePath: env.V1_9_E2E_STATE_PATH,
    });
    if (!contractRepair) {
      externalAuditAuthority = resolveV1_9ExternalAuditRecoveryAuthority({ cwd: repositoryRoot, env });
      if (!externalAuditAuthority) {
        if (!env.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID?.trim()) return;
        authority = resolveV1_9ProviderHealthRecoveryAuthority({ cwd: repositoryRoot, env });
      }
    }
  } catch {
    console.error("[conversation-turn-recovery] v1_9_startup_recovery_invalid");
    return;
  }

  globalRecovery.__shanhaiTurnRecoveryScheduled = true;
  setTimeout(() => {
    void recoverStartupConversationTurns({ env, authority, externalAuditAuthority, contractRepair }).catch((error) => {
      console.error("[conversation-turn-recovery]", error instanceof Error ? error.message : "recovery_failed");
    });
  }, 0);
}

export function shouldInspectV1_9StartupRecovery(
  env: RecoveryEnv,
): env is RecoveryEnv & Required<Pick<RecoveryEnv, "V1_9_E2E_MANIFEST_PATH" | "V1_9_E2E_STATE_PATH">> {
  return Boolean(env.V1_9_E2E_MANIFEST_PATH?.trim() && env.V1_9_E2E_STATE_PATH?.trim());
}

export function resolveV1_9RepositoryRoot(env: Pick<RecoveryEnv, "SHANHAI_V1_9_REPOSITORY_ROOT">) {
  const configured = env.SHANHAI_V1_9_REPOSITORY_ROOT?.trim();
  if (!configured) return process.cwd();
  if (!path.isAbsolute(configured)) throw new Error("v1_9_repository_root_invalid");
  return path.resolve(configured);
}

async function recoverStartupConversationTurns(input: {
  env: RecoveryEnv;
  authority: V1_9ProviderHealthRecoveryAuthority | null;
  externalAuditAuthority: V1_9ExternalAuditRecoveryAuthority | null;
  contractRepair: ContractRepairRecoveryConfig | null;
}) {
  if (input.contractRepair) {
    await recoverContractRepairTurn(input.contractRepair, input.env);
  }
  if (input.externalAuditAuthority) {
    await recoverV1_9ExternalAuditTurn({
      client: prisma,
      authority: input.externalAuditAuthority,
      drainProject: async (identity) => {
        const service = serviceForJob(identity);
        await drainRecoveredProject(identity.projectId, service, input.env);
      },
    });
  }
  if (input.authority && (!input.contractRepair || input.contractRepair.jobId !== input.authority.turnJobId)) {
    await recoverProviderHealthTurn(input.authority, input.env);
  }
}

async function recoverContractRepairTurn(contractRepair: ContractRepairRecoveryConfig, env: RecoveryEnv) {
  const job = await prisma.conversationTurnJob.findUnique({ where: { id: contractRepair.jobId } });
  if (!job || job.projectId !== contractRepair.projectId || job.teacherMessageId !== contractRepair.teacherMessageId ||
      !job.actorUserId || !isAuthMode(job.actorAuthMode)) return;
  const service = serviceForJob({
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
  });
  const recovered = await service.requeueConversationTurnJobAfterContractRepair(job.projectId, job.id, contractRepair);
  if (!recovered) return;
  await drainRecoveredProject(job.projectId, service, env);
}

async function recoverProviderHealthTurn(authority: V1_9ProviderHealthRecoveryAuthority, env: RecoveryEnv) {
  const job = await prisma.conversationTurnJob.findUnique({ where: { id: authority.turnJobId } });
  if (!job || job.projectId !== authority.projectId || job.teacherMessageId !== authority.teacherMessageId ||
      job.status !== "failed" || job.failureRetryability !== "after_provider_health_change" ||
      job.errorCode !== authority.reasonCode || !job.actorUserId || !isAuthMode(job.actorAuthMode)) return;
  const service = serviceForJob({
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
  });
  const recovered = await service.requeueConversationTurnJobAfterProviderHealth(job.projectId, job.id, {
    projectId: authority.projectId,
    jobId: authority.turnJobId,
    teacherMessageId: authority.teacherMessageId,
    taskId: authority.taskId,
    intentEpoch: authority.intentEpoch,
    expectedErrorCode: authority.reasonCode,
    recoveryEvidenceDigest: authority.recoveryEvidenceDigest,
  });
  if (!recovered) return;
  await drainRecoveredProject(job.projectId, service, env);
}

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
  service: ReturnType<typeof createWorkbenchService>,
  env: RecoveryEnv,
) {
  const runtime = createAgentRuntimeFromEnv(env);
  const agent = createMainConversationAgentFromEnv(env);
  const agentToolExecutor = createAgentToolExecutorFromEnv(env);
  const controlPlane = resolveMainAgentToolControlPlane(env);
  await drainProjectConversationQueue(projectId, {
    service,
    runtime,
    agent,
    agentToolExecutor,
    enableTaskGrantAutonomy: true,
    enableNativeToolControlPlane: controlPlane === "native",
  });
}

function isAuthMode(value: string | null): value is "local" | "password" | "oauth" | "sso" {
  return value === "local" || value === "password" || value === "oauth" || value === "sso";
}

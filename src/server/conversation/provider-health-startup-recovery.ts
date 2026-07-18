import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createOpenAICompatibleConfigDigest,
  normalizeDigestCredentialSource,
  pickOpenAICompatibleConfig,
  type OpenAICompatibleConfig,
  type OpenAICompatibleEnv,
} from "@/server/openai-compatible-config";
import {
  readV1_9AgentBrainHealthEvidence,
  validateV1_9AgentBrainHealthEvidence,
  type V1_9AgentBrainProviderLock,
} from "@/server/provider-ledger/v1-9-agent-brain-health-evidence";
import { resolveProviderLedgerRuntimeContract } from "@/server/provider-ledger/provider-ledger-adapter";
import type { AgentBrainRuntimeContract } from "@/server/provider-ledger/provider-ledger-contract.mjs";

import {
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
} from "../../../scripts/lib/v1-9-e2e-contract.mjs";

export type RecoveryEnv = OpenAICompatibleEnv & {
  SHANHAI_V1_9_REPOSITORY_ROOT?: string;
  V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID?: string;
  V1_9_E2E_MANIFEST_PATH?: string;
  V1_9_E2E_STATE_PATH?: string;
  V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST?: string;
  // Legacy v1 fields are retained only so partial old recovery input fails closed.
  V1_9_CONTRACT_REPAIR_FAILURE_EVIDENCE_DIGEST?: string;
  V1_9_CONTRACT_REPAIR_TASK_ID?: string;
  V1_9_CONTRACT_REPAIR_INTENT_EPOCH?: string;
};

type RecoveryJsonReader = (filePath: string) => unknown;

export type V1_9ProviderHealthRecoveryAuthorityDependencies = {
  readJson: RecoveryJsonReader;
  readHealthEvidence(input: { evidenceId: string; env: RecoveryEnv }): unknown;
  resolveConfig(env: RecoveryEnv): OpenAICompatibleConfig | null;
  resolveRuntimeContract(env: RecoveryEnv): AgentBrainRuntimeContract;
  createConfigDigest(config: OpenAICompatibleConfig): string;
};

export type V1_9ProviderHealthRecoveryAuthority = {
  manifestPath: string;
  runId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  turnJobId: string;
  teacherMessageId: string;
  reasonCode: string;
  healthEvidenceNotBefore: string;
  evidenceId: string;
  recoveryEvidenceDigest: string;
};

const providerHealthRecoveryReasons = new Set([
  "main_agent_provider_policy_blocked",
  "main_agent_provider_authorization_failed",
  "main_agent_provider_unavailable",
]);

export function resolveV1_9ProviderHealthRecoveryAuthority(input: {
  cwd?: string;
  env?: RecoveryEnv;
  dependencies?: Partial<V1_9ProviderHealthRecoveryAuthorityDependencies>;
}): V1_9ProviderHealthRecoveryAuthority {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaultAuthorityDependencies, ...input.dependencies };
  try {
    const activePointerPath = path.resolve(cwd, "test-results", "v1-9-product-e2e-active.json");
    const pointer = recordValue(dependencies.readJson(activePointerPath));
    if (pointer.schemaVersion === "v1-9-active-run.v2") {
      return resolveV2ProviderHealthRecoveryAuthority({ cwd, env, dependencies, pointer });
    }
    const relativeRunRoot = normalizeRelativeRunRoot(pointer.relativeRunRoot);
    const expectedManifestPath = path.resolve(cwd, ...relativeRunRoot.split("/"), "run-manifest.json");
    const configuredManifestPath = path.resolve(cwd, requiredText(env.V1_9_E2E_MANIFEST_PATH));
    if (configuredManifestPath !== expectedManifestPath || pointer.schemaVersion !== "v1-9-active-run.v1" || pointer.status !== "active") {
      throw invalidProviderHealthRecovery();
    }

    const manifest = recordValue(dependencies.readJson(expectedManifestPath));
    const recovery = recordValue(manifest.recovery);
    const runId = requiredText(manifest.runId);
    const projectId = requiredText(manifest.projectId);
    const taskId = requiredText(manifest.taskId);
    const intentEpoch = nonNegativeInteger(manifest.intentEpoch);
    const turnJobId = requiredText(recovery.turnJobId);
    const teacherMessageId = requiredText(recovery.teacherMessageId);
    const reasonCode = requiredText(recovery.reasonCode);
    const healthEvidenceNotBefore = requiredTimestamp(recovery.healthEvidenceNotBefore);
    if (
      manifest.schemaVersion !== "v1-9-run-manifest.v1" || manifest.status !== "paused_recovery" ||
      pointer.runId !== runId || path.posix.basename(relativeRunRoot) !== runId || manifest.relativeRunRoot !== relativeRunRoot ||
      manifest.taskSubmissionCount !== 1 || manifest.externalCodexOrchestrationCount !== 0 ||
      !Array.isArray(manifest.violations) || manifest.violations.length !== 0 || !providerHealthRecoveryReasons.has(reasonCode)
    ) throw invalidProviderHealthRecovery();

    const providerLock = parseProviderLock(manifest.providerLock);
    const config = dependencies.resolveConfig(env);
    if (!config) throw invalidProviderHealthRecovery();
    const currentLock: V1_9AgentBrainProviderLock = {
      channel: config.channel,
      model: config.model,
      endpointCategory: config.endpointCategory,
      reasoningEffort: config.reasoningEffort,
      credentialSource: normalizeDigestCredentialSource(config.credentialSource),
      configDigest: dependencies.createConfigDigest(config),
    };
    assertProviderLockEqual(providerLock, currentLock);

    const evidenceId = requiredText(env.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID);
    const evidence = dependencies.readHealthEvidence({ evidenceId, env });
    validateV1_9AgentBrainHealthEvidence({
      value: evidence,
      evidenceId,
      providerLock,
      runtimeContract: dependencies.resolveRuntimeContract(env),
      notBefore: healthEvidenceNotBefore,
    });
    const recoveryEvidenceDigest = createRecoveryEvidenceDigest({
      runId,
      projectId,
      taskId,
      intentEpoch,
      turnJobId,
      teacherMessageId,
      reasonCode,
      healthEvidenceNotBefore,
      evidenceId,
      configDigest: providerLock.configDigest,
    });
    return {
      manifestPath: expectedManifestPath,
      runId,
      projectId,
      taskId,
      intentEpoch,
      turnJobId,
      teacherMessageId,
      reasonCode,
      healthEvidenceNotBefore,
      evidenceId,
      recoveryEvidenceDigest,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "v1_9_provider_health_recovery_invalid") throw error;
    throw invalidProviderHealthRecovery();
  }
}

function resolveV2ProviderHealthRecoveryAuthority(input: {
  cwd: string;
  env: RecoveryEnv;
  dependencies: V1_9ProviderHealthRecoveryAuthorityDependencies;
  pointer: Record<string, unknown>;
}): V1_9ProviderHealthRecoveryAuthority {
  const { cwd, env, dependencies, pointer } = input;
  assertExactFields(pointer, [
    "schemaVersion", "runId", "relativeRunRoot", "manifestPath", "manifestSha256", "statePath",
  ]);
  const relativeRunRoot = normalizeRelativeRunRoot(pointer.relativeRunRoot);
  const runId = requiredText(pointer.runId);
  if (path.posix.basename(relativeRunRoot) !== runId) throw invalidProviderHealthRecovery();
  const expectedManifestPath = path.resolve(cwd, ...relativeRunRoot.split("/"), "run-manifest.json");
  const expectedStatePath = path.resolve(cwd, ...relativeRunRoot.split("/"), "run-state.json");
  const configuredManifestPath = path.resolve(cwd, requiredText(env.V1_9_E2E_MANIFEST_PATH));
  const configuredStatePath = path.resolve(cwd, requiredText(env.V1_9_E2E_STATE_PATH));
  if (configuredManifestPath !== expectedManifestPath || configuredStatePath !== expectedStatePath ||
      requiredText(pointer.manifestPath).replaceAll("\\", "/") !== `${relativeRunRoot}/run-manifest.json` ||
      requiredText(pointer.statePath).replaceAll("\\", "/") !== `${relativeRunRoot}/run-state.json`) {
    throw invalidProviderHealthRecovery();
  }

  const manifest = normalizeV1_9RunManifestV2(dependencies.readJson(expectedManifestPath));
  const state = normalizeV1_9RunState(dependencies.readJson(expectedStatePath));
  const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
  if (manifest.runId !== runId || manifest.relativeRunRoot.replaceAll("\\", "/") !== relativeRunRoot ||
      state.runId !== runId || state.manifestSha256 !== manifestSha256 ||
      sha256Text(pointer.manifestSha256) !== manifestSha256 ||
      !["paused_recovery", "failed"].includes(state.status) || !state.recovery || !state.taskContractLock ||
      !state.identity.actorUserId || !state.identity.projectId || !state.identity.taskId || state.identity.intentEpoch === null ||
      state.ledger.taskSubmissionCount !== 1 || state.ledger.externalCodexOrchestrationCount !== 0 ||
      state.ledger.violations.length !== 0) {
    throw invalidProviderHealthRecovery();
  }

  const recovery = state.recovery;
  const lock = state.taskContractLock;
  const projectId = state.identity.projectId;
  const taskId = state.identity.taskId;
  const intentEpoch = state.identity.intentEpoch;
  const turnJobId = requiredText(recovery.turnJobId);
  const teacherMessageId = requiredText(recovery.teacherMessageId);
  const reasonCode = requiredText(recovery.reasonCode);
  const healthEvidenceNotBefore = requiredTimestamp(recovery.healthEvidenceNotBefore);
  if (!providerHealthRecoveryReasons.has(reasonCode) || turnJobId !== lock.turnJobId ||
      teacherMessageId !== lock.teacherMessageId || intentEpoch !== lock.intentEpoch) {
    throw invalidProviderHealthRecovery();
  }

  const providerLock = parseProviderLock(manifest.agentBrain.providerLock);
  const agentBrainRuntimeLock = manifest.providerRuntimeLocks.find((item) => item.capability === "agent_brain");
  if (!agentBrainRuntimeLock || agentBrainRuntimeLock.configDigest !== providerLock.configDigest) {
    throw invalidProviderHealthRecovery();
  }
  const config = dependencies.resolveConfig(env);
  if (!config) throw invalidProviderHealthRecovery();
  assertProviderLockEqual(providerLock, {
    channel: config.channel,
    model: config.model,
    endpointCategory: config.endpointCategory,
    reasoningEffort: config.reasoningEffort,
    credentialSource: normalizeDigestCredentialSource(config.credentialSource),
    configDigest: dependencies.createConfigDigest(config),
  });

  const evidenceId = requiredText(env.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID);
  validateV1_9AgentBrainHealthEvidence({
    value: dependencies.readHealthEvidence({ evidenceId, env }),
    evidenceId,
    providerLock,
    runtimeContract: dependencies.resolveRuntimeContract(env),
    notBefore: healthEvidenceNotBefore,
  });
  const recoveryEvidenceDigest = createRecoveryEvidenceDigest({
    runId,
    projectId,
    taskId,
    intentEpoch,
    turnJobId,
    teacherMessageId,
    reasonCode,
    healthEvidenceNotBefore,
    evidenceId,
    configDigest: providerLock.configDigest,
  });
  return {
    manifestPath: expectedManifestPath,
    runId,
    projectId,
    taskId,
    intentEpoch,
    turnJobId,
    teacherMessageId,
    reasonCode,
    healthEvidenceNotBefore,
    evidenceId,
    recoveryEvidenceDigest,
  };
}

function createRecoveryEvidenceDigest(input: {
  runId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  turnJobId: string;
  teacherMessageId: string;
  reasonCode: string;
  healthEvidenceNotBefore: string;
  evidenceId: string;
  configDigest: string;
}) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function parseProviderLock(value: unknown): V1_9AgentBrainProviderLock {
  const lock = recordValue(value);
  const channel = requiredText(lock.channel);
  const reasoningEffort = requiredText(lock.reasoningEffort);
  const credentialSource = requiredText(lock.credentialSource);
  if (!isChannel(channel) || !isReasoningEffort(reasoningEffort) || !isCredentialSource(credentialSource) ||
      lock.schemaVersion !== "v1-9-provider-lock.v1" || lock.endpointCategory !== "openai_compatible_responses") {
    throw invalidProviderHealthRecovery();
  }
  return {
    channel,
    model: requiredText(lock.model),
    endpointCategory: "openai_compatible_responses",
    reasoningEffort,
    credentialSource,
    configDigest: sha256Text(lock.configDigest),
  };
}

function assertProviderLockEqual(left: V1_9AgentBrainProviderLock, right: V1_9AgentBrainProviderLock) {
  for (const field of ["channel", "model", "endpointCategory", "reasoningEffort", "credentialSource", "configDigest"] as const) {
    if (left[field] !== right[field]) throw invalidProviderHealthRecovery();
  }
}

function normalizeRelativeRunRoot(value: unknown) {
  const normalized = requiredText(value).replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) {
    throw invalidProviderHealthRecovery();
  }
  return normalized;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidProviderHealthRecovery();
  return value as Record<string, unknown>;
}

function assertExactFields(value: Record<string, unknown>, fields: string[]) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw invalidProviderHealthRecovery();
  }
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw invalidProviderHealthRecovery();
  return value.trim();
}

function requiredTimestamp(value: unknown) {
  const timestamp = requiredText(value);
  if (!Number.isFinite(Date.parse(timestamp))) throw invalidProviderHealthRecovery();
  return new Date(timestamp).toISOString();
}

function nonNegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalidProviderHealthRecovery();
  return Number(value);
}

function sha256Text(value: unknown) {
  const digest = requiredText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw invalidProviderHealthRecovery();
  return digest;
}

function invalidProviderHealthRecovery() {
  return new Error("v1_9_provider_health_recovery_invalid");
}

function isChannel(value: string): value is V1_9AgentBrainProviderLock["channel"] {
  return value === "primary" || value === "third" || value === "fallback";
}

function isReasoningEffort(value: string): value is V1_9AgentBrainProviderLock["reasoningEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isCredentialSource(value: string): value is V1_9AgentBrainProviderLock["credentialSource"] {
  return value === "ledger_private_env" || value === "deployment_secret";
}

const defaultAuthorityDependencies: V1_9ProviderHealthRecoveryAuthorityDependencies = {
  readJson,
  readHealthEvidence: ({ evidenceId, env }) => readV1_9AgentBrainHealthEvidence({ evidenceId, env }),
  resolveConfig: (env) => pickOpenAICompatibleConfig(env),
  resolveRuntimeContract: (env) => {
    const contract = resolveProviderLedgerRuntimeContract({ capability: "agent_brain", ambientEnv: env });
    if (contract.kind !== "agent_brain_responses") throw invalidProviderHealthRecovery();
    return contract;
  },
  createConfigDigest: createOpenAICompatibleConfigDigest,
};

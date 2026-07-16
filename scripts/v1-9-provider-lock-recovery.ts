import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createOpenAICompatibleConfigDigest,
  normalizeDigestCredentialSource,
  pickOpenAICompatibleConfig,
  type OpenAICompatibleEnv,
} from "../src/server/openai-compatible-config";
import {
  readV1_9AgentBrainHealthEvidence,
  validateV1_9AgentBrainAuthorizationFailureEvidence,
} from "../src/server/provider-ledger/v1-9-agent-brain-health-evidence";
import {
  resolveProviderLedgerRuntimeContract,
} from "../src/server/provider-ledger/provider-ledger-adapter";
import type { AgentBrainRuntimeContract } from "../src/server/provider-ledger/provider-ledger-contract.mjs";
import {
  rotateV1_9ProviderLockForRecovery,
  type V1_9ProviderLock,
  type V1_9RunManifest,
} from "./lib/v1-9-e2e-contract.mjs";

type RecoveryEnv = OpenAICompatibleEnv & { V1_9_E2E_MANIFEST_PATH?: string };

export type V1_9ProviderLockRecoveryDependencies = {
  readActiveRun(input: { cwd: string; env: RecoveryEnv }): Promise<{ manifestPath: string; manifest: V1_9RunManifest }>;
  readFailureEvidence(input: { evidenceId: string; env: RecoveryEnv }): unknown | Promise<unknown>;
  resolveNextProviderLock(env: RecoveryEnv): V1_9ProviderLock | null;
  resolveRuntimeContract(env: RecoveryEnv): AgentBrainRuntimeContract;
  writeManifest(filePath: string, manifest: V1_9RunManifest): void | Promise<void>;
  now(): Date;
};

export async function runV1_9ProviderLockRecovery(input: {
  cwd?: string;
  env?: RecoveryEnv;
  failureEvidenceId: string;
  dependencies?: Partial<V1_9ProviderLockRecoveryDependencies>;
}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const active = await dependencies.readActiveRun({ cwd, env });
  const currentLock = active.manifest.providerLock;
  if (!currentLock) return report(false, "v1_9_provider_lock_recovery_state_invalid", 0);

  try {
    const evidence = await dependencies.readFailureEvidence({ evidenceId: input.failureEvidenceId, env });
    validateV1_9AgentBrainAuthorizationFailureEvidence({
      value: evidence,
      evidenceId: input.failureEvidenceId,
      providerLock: currentLock,
      runtimeContract: dependencies.resolveRuntimeContract(env),
      notBefore: active.manifest.createdAt,
    });
  } catch {
    return report(false, "v1_9_provider_lock_recovery_evidence_invalid", 0);
  }

  const nextProviderLock = dependencies.resolveNextProviderLock(env);
  if (!nextProviderLock) return report(false, "v1_9_provider_lock_recovery_config_invalid", 0);
  try {
    const rotated = rotateV1_9ProviderLockForRecovery(active.manifest, {
      nextProviderLock,
      failureEvidenceId: input.failureEvidenceId,
      rotatedAt: dependencies.now().toISOString(),
    });
    await dependencies.writeManifest(active.manifestPath, rotated);
    return report(true, "none", rotated.providerLockHistory?.length ?? 0);
  } catch {
    return report(false, "v1_9_provider_lock_recovery_state_invalid", 0);
  }
}

function resolveNextProviderLock(env: RecoveryEnv): V1_9ProviderLock | null {
  const config = pickOpenAICompatibleConfig(env);
  if (!config) return null;
  return {
    schemaVersion: "v1-9-provider-lock.v1",
    channel: config.channel,
    model: config.model,
    endpointCategory: config.endpointCategory,
    reasoningEffort: config.reasoningEffort,
    credentialSource: normalizeDigestCredentialSource(config.credentialSource),
    configDigest: createOpenAICompatibleConfigDigest(config),
  };
}

async function defaultReadActiveRun(input: { cwd: string; env: RecoveryEnv }) {
  const pointerPath = path.resolve(input.cwd, "test-results", "v1-9-product-e2e-active.json");
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
  const relativeRunRoot = String(pointer.relativeRunRoot ?? "").replaceAll("\\", "/");
  if (pointer.schemaVersion !== "v1-9-active-run.v1" || pointer.status !== "active" || !/^test-results\/v1-9-[a-z0-9._-]+$/i.test(relativeRunRoot) || relativeRunRoot.includes("..")) {
    throw new Error("v1_9_active_run_invalid");
  }
  const expected = path.resolve(input.cwd, ...relativeRunRoot.split("/"), "run-manifest.json");
  const configured = input.env.V1_9_E2E_MANIFEST_PATH?.trim();
  const manifestPath = configured ? path.resolve(input.cwd, configured) : expected;
  if (manifestPath !== expected || !existsSync(manifestPath)) throw new Error("v1_9_active_run_manifest_invalid");
  return { manifestPath, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as V1_9RunManifest };
}

function defaultWriteManifest(filePath: string, manifest: V1_9RunManifest) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporaryPath, filePath);
}

function report(ok: boolean, reasonCode: string, providerLockRevision: number) {
  return {
    schemaVersion: "v1-9-provider-lock-recovery-report.v1",
    ok,
    reasonCode,
    providerRequestCount: 0,
    providerLockRevision,
  };
}

const defaultDependencies: V1_9ProviderLockRecoveryDependencies = {
  readActiveRun: defaultReadActiveRun,
  readFailureEvidence: ({ evidenceId, env }) => readV1_9AgentBrainHealthEvidence({ evidenceId, env }),
  resolveNextProviderLock,
  resolveRuntimeContract: (env) => {
    const contract = resolveProviderLedgerRuntimeContract({ capability: "agent_brain", ambientEnv: env });
    if (contract.kind !== "agent_brain_responses") throw new Error("v1_9_provider_lock_recovery_config_invalid");
    return contract;
  },
  writeManifest: defaultWriteManifest,
  now: () => new Date(),
};

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  void runMain();
}

async function runMain() {
  await import("dotenv/config");
  const failureEvidenceId = process.argv.find((argument) => argument.startsWith("--failure-evidence-id="))?.slice("--failure-evidence-id=".length);
  if (!failureEvidenceId) throw new Error("v1_9_provider_lock_failure_evidence_required");
  const result = await runV1_9ProviderLockRecovery({ failureEvidenceId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

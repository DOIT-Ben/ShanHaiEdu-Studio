import { describe, expect, it, vi } from "vitest";

import { runV1_9ProviderLockRecovery } from "../scripts/v1-9-provider-lock-recovery";
import type { V1_9ProviderLock, V1_9RunManifest } from "../scripts/lib/v1-9-e2e-contract.mjs";

describe("V1-9 Provider lock recovery", () => {
  it("rejects arbitrary failure evidence without rewriting the manifest", async () => {
    const dependencies = recoveryDependencies({ evidence: { schemaVersion: "wrong" } });

    const report = await runV1_9ProviderLockRecovery({
      cwd: "E:\\fixture",
      failureEvidenceId: "agent-brain-health-old-failure",
      dependencies,
    });

    expect(report).toMatchObject({ ok: false, reasonCode: "v1_9_provider_lock_recovery_evidence_invalid" });
    expect(dependencies.writeManifest).not.toHaveBeenCalled();
  });

  it("appends the old lock history and preserves the unique task identity when the ledger config changed", async () => {
    const dependencies = recoveryDependencies();

    const report = await runV1_9ProviderLockRecovery({
      cwd: "E:\\fixture",
      failureEvidenceId: "agent-brain-health-old-failure",
      dependencies,
    });

    expect(report).toMatchObject({ ok: true, reasonCode: "none", providerLockRevision: 1 });
    expect(dependencies.writeManifest).toHaveBeenCalledWith(
      "E:\\fixture\\test-results\\v1-9-run\\run-manifest.json",
      expect.objectContaining({
        projectId: "project-1",
        taskId: "task-1",
        intentEpoch: 0,
        taskSubmissionCount: 1,
        externalCodexOrchestrationCount: 0,
        providerLock: expect.objectContaining({ model: "gpt-new", configDigest: "b".repeat(64) }),
        providerLockHistory: [expect.objectContaining({
          failureEvidenceId: "agent-brain-health-old-failure",
          reasonCode: "authorization_config_repair",
          providerLock: expect.objectContaining({ model: "gpt-old", configDigest: "a".repeat(64) }),
        })],
      }),
    );
  });
});

function recoveryDependencies(overrides: { evidence?: unknown } = {}) {
  const oldLock = providerLock("gpt-old", "a");
  const manifest: V1_9RunManifest = {
    schemaVersion: "v1-9-run-manifest.v1",
    runId: "v1-9-run",
    status: "paused_recovery",
    relativeRunRoot: "test-results/v1-9-run",
    promptDigest: "c".repeat(64),
    skillLock: { schemaVersion: "v1-9-skill-lock.v1", projectionLockDigest: "d".repeat(64), bindingPolicyDigest: "e".repeat(64), activeSkills: [{ name: "shanhai-jiaoan", version: "1.1" }] },
    providerLock: oldLock,
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 0,
    checkpointId: null,
    taskSubmissionCount: 1,
    finalDownloadCount: 0,
    externalCodexOrchestrationCount: 0,
    pendingDecision: null,
    recovery: { reasonCode: "turn_failed", checkpointId: null, observationRefs: [] },
    mutations: [{ method: "POST", pathname: "/api/workbench/projects/project-1/messages", source: "ui" }],
    violations: [],
    createdAt: "2026-07-14T21:00:00.000Z",
    updatedAt: "2026-07-14T22:00:00.000Z",
  };
  const evidence = overrides.evidence ?? {
    schemaVersion: "v1-9-agent-brain-health.v2",
    evidenceId: "agent-brain-health-old-failure",
    providerId: "agent_brain",
    capability: "agent_brain",
    purpose: "main_agent_responses",
    channel: "primary",
    model: "gpt-old",
    endpointCategory: "openai_compatible_responses",
    reasoningEffort: "high",
    credentialSource: "ledger_private_env",
    configDigest: "a".repeat(64),
    probe: "single_strict_structured_text",
    result: "failed",
    testedAt: "2026-07-14T23:00:00.000Z",
    providerRequestCount: 1,
    maxRetries: 0,
    retryCount: 0,
    errorCategory: "authorization",
  };
  return {
    readActiveRun: vi.fn(async () => ({ manifestPath: "E:\\fixture\\test-results\\v1-9-run\\run-manifest.json", manifest })),
    readFailureEvidence: vi.fn(async () => evidence),
    resolveNextProviderLock: vi.fn(() => providerLock("gpt-new", "b")),
    resolveRuntimeContract: vi.fn(() => agentBrainRuntimeContract()),
    writeManifest: vi.fn(async () => undefined),
    now: vi.fn(() => new Date("2026-07-15T00:00:00.000Z")),
  };
}

function agentBrainRuntimeContract() {
  return {
    schemaVersion: "provider-runtime-contract.v1" as const,
    kind: "agent_brain_responses" as const,
    endpointCategory: "openai_compatible_responses" as const,
    selectedChannelEnv: "AGENT_BRAIN_CHANNEL",
    purposeChannels: {
      main_agent_responses: { channel: "primary" as const, credentialEnv: "PRIMARY_KEY", baseUrlEnv: "PRIMARY_BASE", modelEnv: "PRIMARY_MODEL" },
      critic_responses: { channel: "third" as const, credentialEnv: "THIRD_KEY", baseUrlEnv: "THIRD_BASE", modelEnv: "THIRD_MODEL" },
      fallback_responses: { channel: "fallback" as const, credentialEnv: "FALLBACK_KEY", baseUrlEnv: "FALLBACK_BASE", modelEnv: "FALLBACK_MODEL" },
    },
    reasoning: { env: "REASONING", default: "high" as const, allowed: ["low", "medium", "high", "xhigh"] as const },
  };
}

function providerLock(model: string, digestPrefix: string): V1_9ProviderLock {
  return {
    schemaVersion: "v1-9-provider-lock.v1",
    channel: "primary",
    model,
    endpointCategory: "openai_compatible_responses",
    reasoningEffort: "high",
    credentialSource: "ledger_private_env",
    configDigest: digestPrefix.repeat(64),
  };
}

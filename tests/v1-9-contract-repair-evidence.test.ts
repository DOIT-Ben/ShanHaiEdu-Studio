import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  V1_9_CONTRACT_REPAIR_REQUIRED_FILES,
  contractRepairEvidencePath,
  createV1_9ContractRepairEvidence,
  validateV1_9ContractRepairEvidence,
  verifyContractRepairRecoveryEvidence,
} from "@/server/conversation/v1-9-contract-repair-evidence";
import {
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunState,
  markV1_9RunStateRecoveryStop,
} from "../scripts/lib/v1-9-e2e-contract.mjs";

describe("V1-9 contract repair evidence", () => {
  it("binds every decomposed Main Agent Tool Loop responsibility into the repair evidence closure", () => {
    expect(V1_9_CONTRACT_REPAIR_REQUIRED_FILES).toEqual(expect.arrayContaining([
      "src/server/conversation/main-agent-tool-description.ts",
      "src/server/conversation/main-agent-tool-input-projection.ts",
      "src/server/conversation/main-agent-tool-loop-agent-result.ts",
      "src/server/conversation/main-agent-tool-loop-business-result.ts",
      "src/server/conversation/main-agent-tool-loop-checkpoints.ts",
      "src/server/conversation/main-agent-tool-loop-config.ts",
      "src/server/conversation/main-agent-tool-loop-dialogue.ts",
      "src/server/conversation/main-agent-tool-loop-dispatch.ts",
      "src/server/conversation/main-agent-tool-loop-execution.ts",
      "src/server/conversation/main-agent-tool-loop-human-gate.ts",
      "src/server/conversation/main-agent-tool-loop-metadata.ts",
      "src/server/conversation/main-agent-tool-loop-observations.ts",
      "src/server/conversation/main-agent-tool-loop-ppt-assets.ts",
      "src/server/conversation/main-agent-tool-loop-types.ts",
      "src/server/conversation/main-agent-tool-qualification.ts",
    ]));
  });

  it("binds every decomposed workbench repository responsibility into the repair evidence closure", () => {
    expect(V1_9_CONTRACT_REPAIR_REQUIRED_FILES).toEqual(expect.arrayContaining([
      "src/server/workbench/artifact-repository.ts",
      "src/server/workbench/conversation-turn-completion-repository.ts",
      "src/server/workbench/conversation-turn-enqueue-repository.ts",
      "src/server/workbench/conversation-turn-recovery-repository.ts",
      "src/server/workbench/conversation-turn-repository-guards.ts",
      "src/server/workbench/conversation-turn-repository-shared.ts",
      "src/server/workbench/execution-guard-repository.ts",
      "src/server/workbench/generation-job-repository.ts",
      "src/server/workbench/generation-repository-guards.ts",
      "src/server/workbench/generation-repository-input.ts",
      "src/server/workbench/generation-repository-unit-result.ts",
      "src/server/workbench/message-repository.ts",
      "src/server/workbench/project-repository.ts",
      "src/server/workbench/repository.ts",
      "src/server/workbench/validation-report-repository-helpers.ts",
      "src/server/workbench/video-shot-repository.ts",
    ]));
  });

  it("binds every decomposed workbench service responsibility into the repair evidence closure", () => {
    expect(V1_9_CONTRACT_REPAIR_REQUIRED_FILES).toEqual(expect.arrayContaining([
      "src/server/workbench/service.ts",
      "src/server/workbench/workbench-artifact-service.ts",
      "src/server/workbench/workbench-generation-service.ts",
      "src/server/workbench/workbench-message-service.ts",
      "src/server/workbench/workbench-project-service.ts",
      "src/server/workbench/workbench-service-context.ts",
      "src/server/workbench/workbench-service-mappers.ts",
      "src/server/workbench/workbench-snapshot-service.ts",
      "src/server/workbench/workbench-turn-job-service.ts",
      "src/server/workbench/workbench-video-shot-service.ts",
      "tests/workbench-service-facade.test.ts",
    ]));
  });

  it("binds the exact Job, teacher message, TaskBrief, idempotency key, failure signature and required repair closure", () => {
    const cwd = path.resolve(".tmp", "v1-9-contract-repair-evidence");
    const repairFile = "repair/recovery.ts";
    const evidenceFile = "repair/evidence.ts";
    mkdirSync(path.join(cwd, "repair"), { recursive: true });
    writeFileSync(path.join(cwd, repairFile), "export const repaired = true;\n", "utf8");
    writeFileSync(path.join(cwd, evidenceFile), "export const evidence = true;\n", "utf8");
    const requiredRepairFiles = [repairFile, evidenceFile];

    const evidence = createV1_9ContractRepairEvidence({
      cwd,
      runId: "v1-9-run",
      projectId: "project-1",
      jobId: "job-1",
      teacherMessageId: "message-1",
      taskId: "task:one",
      intentEpoch: 0,
      taskBriefDigest: "a".repeat(64),
      idempotencyKey: "turn:one",
      failureObservationId: "observation-1",
      failureSignature: "b".repeat(64),
      repairFiles: requiredRepairFiles,
      requiredRepairFiles,
      createdAt: "2026-07-15T08:00:00.000Z",
    });

    expect(evidence).toMatchObject({
      schemaVersion: "v1-9-contract-repair-evidence.v2",
      jobId: "job-1",
      teacherMessageId: "message-1",
      taskBriefDigest: "a".repeat(64),
      idempotencyKey: "turn:one",
      failureObservationId: "observation-1",
      failureSignature: "b".repeat(64),
    });

    expect(() => validateV1_9ContractRepairEvidence({
      cwd,
      evidence,
      expectedEvidenceDigest: evidence.evidenceDigest,
      expectedRunId: "v1-9-run",
      expectedProjectId: "project-1",
      expectedJobId: "job-1",
      expectedTeacherMessageId: "message-1",
      expectedTaskId: "task:one",
      expectedIntentEpoch: 0,
      expectedTaskBriefDigest: "a".repeat(64),
      expectedIdempotencyKey: "turn:one",
      expectedFailureObservationId: "observation-1",
      expectedFailureSignature: "b".repeat(64),
      requiredRepairFiles,
    })).not.toThrow();

    const manifestPath = path.join(cwd, "test-results", "v1-9-run", "run-manifest.json");
    const evidencePath = contractRepairEvidencePath(manifestPath, evidence.evidenceDigest);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, JSON.stringify(evidence), "utf8");
    const manifest = createManifest();
    let runState = createV1_9RunState({ manifest, createdAt: "2026-07-15T08:00:01.000Z" });
    runState = bindV1_9RunStateProjectIdentity(runState, {
      actorUserId: "teacher-1", projectId: "project-1", boundAt: "2026-07-15T08:00:02.000Z",
    });
    runState = bindV1_9TaskContractLock(runState, {
      actorUserId: "teacher-1", actorAuthMode: "local", projectId: "project-1", taskId: "task:one",
      teacherMessageId: "message-1", turnJobId: "job-1", taskBriefDigest: "a".repeat(64),
      intentEpoch: 0, intensity: "standard", intentGrantDigest: "c".repeat(64),
      budgetDigest: "d".repeat(64), initialPlanRevision: 0, boundAt: "2026-07-15T08:00:03.000Z",
    });
    runState = markV1_9RunStateRecoveryStop(runState, {
      reasonCode: "main_agent_retry_budget_exhausted", checkpointId: "checkpoint-1", observationRefs: [],
      turnJobId: "job-1", teacherMessageId: "message-1", stoppedAt: "2026-07-15T08:00:04.000Z",
    });
    expect(verifyContractRepairRecoveryEvidence({
      cwd,
      env: { V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST: evidence.evidenceDigest },
      manifestPath,
      manifest,
      runState,
      requiredRepairFiles,
    })).toEqual({
      repairEvidenceDigest: evidence.evidenceDigest,
      projectId: "project-1",
      jobId: "job-1",
      teacherMessageId: "message-1",
      taskId: "task:one",
      intentEpoch: 0,
      taskBriefDigest: "a".repeat(64),
      idempotencyKey: "turn:one",
      failureObservationId: "observation-1",
      expectedFailureSignature: "b".repeat(64),
    });

    expect(() => verifyContractRepairRecoveryEvidence({
      cwd,
      env: { V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST: evidence.evidenceDigest },
      manifestPath,
      manifest: { schemaVersion: "v1-9-run-manifest.v1", runId: "v1-9-run" },
      runState,
      requiredRepairFiles,
    })).toThrow("v1_9_contract_repair_evidence_invalid");

    expect(() => createV1_9ContractRepairEvidence({
      cwd,
      runId: "v1-9-run",
      projectId: "project-1",
      jobId: "job-1",
      teacherMessageId: "message-1",
      taskId: "task:one",
      intentEpoch: 0,
      taskBriefDigest: "a".repeat(64),
      idempotencyKey: "turn:one",
      failureObservationId: "observation-1",
      failureSignature: "b".repeat(64),
      repairFiles: [repairFile],
      requiredRepairFiles,
    })).toThrow("v1_9_contract_repair_evidence_invalid");

    writeFileSync(path.join(cwd, repairFile), "export const repaired = false;\n", "utf8");

    expect(() => validateV1_9ContractRepairEvidence({
      cwd,
      evidence,
      expectedEvidenceDigest: evidence.evidenceDigest,
      expectedRunId: "v1-9-run",
      expectedProjectId: "project-1",
      expectedJobId: "job-1",
      expectedTeacherMessageId: "message-1",
      expectedTaskId: "task:one",
      expectedIntentEpoch: 0,
      expectedTaskBriefDigest: "a".repeat(64),
      expectedIdempotencyKey: "turn:one",
      expectedFailureObservationId: "observation-1",
      expectedFailureSignature: "b".repeat(64),
      requiredRepairFiles,
    })).toThrow("v1_9_contract_repair_evidence_invalid");
  });
});

function createManifest() {
  return createV1_9RunManifestV2({
    runId: "v1-9-run",
    relativeRunRoot: "test-results/v1-9-run",
    createdAt: "2026-07-15T08:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v2", branch: "main", gitHead: "a".repeat(40),
      generationIntensity: "standard", runtimeSourceDigest: "4".repeat(64),
      requirementsBaselineDigest: "5".repeat(64), registryDigest: "6".repeat(64),
      projectionRegistryDigest: "6".repeat(64), providerLedgerManifestDigest: "7".repeat(64),
      projectionId: "runtime-projection-a23", verificationManifestSha256: "1".repeat(64),
      workingTreeDigest: "2".repeat(64), policySha256: "3".repeat(64), stageSha256: "4".repeat(64),
      providerContinuityManifestSha256: "4".repeat(64), providerContinuityReceiptSha256: "5".repeat(64),
      providerContinuityEvidenceRootDigest: "e".repeat(64), providerContinuitySubjectDigest: "f".repeat(64),
    },
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1", projectionLockDigest: "8".repeat(64),
      bindingPolicyDigest: "9".repeat(64), activeSkills: [{ name: "shanhai-suite", version: "1.1" }],
    },
    agentBrain: { providerLock: {
      schemaVersion: "v1-9-provider-lock.v1", channel: "primary", model: "gpt-5.6-terra",
      endpointCategory: "openai_compatible_responses", reasoningEffort: "medium",
      credentialSource: "ledger_private_env", configDigest: "a".repeat(64),
    } },
    providerRuntimeLocks: ["agent_brain", "coze_ppt", "image_generation", "tts_minimax", "video_generation"]
      .map((capability, index) => ({
        capability: capability as "agent_brain" | "coze_ppt" | "image_generation" | "tts_minimax" | "video_generation",
        credentialSource: "ledger_private_env" as const,
        configDigest: String.fromCharCode(97 + index).repeat(64),
      })),
    predecessor: null,
  });
}

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  contractRepairEvidencePath,
  createV1_9ContractRepairEvidence,
  validateV1_9ContractRepairEvidence,
  verifyContractRepairRecoveryEvidence,
} from "@/server/conversation/v1-9-contract-repair-evidence";

describe("V1-9 contract repair evidence", () => {
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
    expect(verifyContractRepairRecoveryEvidence({
      cwd,
      env: { V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST: evidence.evidenceDigest },
      manifestPath,
      manifest: {
        schemaVersion: "v1-9-run-manifest.v1",
        status: "paused_recovery",
        runId: "v1-9-run",
        projectId: "project-1",
        taskId: "task:one",
        intentEpoch: 0,
      },
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

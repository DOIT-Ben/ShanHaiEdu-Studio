import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = "v1-9-contract-repair-evidence.v2" as const;
const REPAIR_SCOPE = "v1_9_incomplete_task_recovery_contract" as const;
const INVALID = "v1_9_contract_repair_evidence_invalid";

export const V1_9_CONTRACT_REPAIR_REQUIRED_FILES = Object.freeze([
  "scripts/create-v1-9-contract-repair-evidence.ts",
  "scripts/lib/v1-9-e2e-contract.mjs",
  "scripts/repair-v1-9-control-plane-lifecycle.ts",
  "scripts/v1-9-product-preflight.ts",
  "src/server/capabilities/capability-availability.ts",
  "src/server/conversation/control-plane-lifecycle-repair.ts",
  "src/server/conversation/control-plane-store.ts",
  "src/server/conversation/conversation-turn-recovery.ts",
  "src/server/conversation/main-agent-controlled-react-loop.ts",
  "src/server/conversation/main-agent-react-checkpoint.ts",
  "src/server/conversation/main-agent-failure.ts",
  "src/server/conversation/main-agent-tool-loop-config.ts",
  "src/server/conversation/model-main-conversation-agent.ts",
  "src/server/conversation/react-control.ts",
  "src/server/conversation/v1-9-contract-repair-evidence.ts",
  "src/server/image-generation/image-generation-run.ts",
  "src/server/tools/provider-tool-adapter.ts",
  "src/server/tools/main-agent-tool-registry.ts",
  "src/server/workbench/repository.ts",
  "src/server/workbench/service.ts",
  "src/server/workbench/types.ts",
  "tests/capability-availability.test.ts",
  "tests/control-plane-lifecycle-repair.test.ts",
  "tests/control-plane-persistence.test.ts",
  "tests/conversation-contract-repair-recovery.test.ts",
  "tests/agent-runtime/main-agent-controlled-react-loop.test.ts",
  "tests/model-main-conversation-agent.test.ts",
  "tests/agent-tools/main-agent-tool-registry.test.ts",
  "tests/agent-runtime/main-agent-tool-loop-config.test.ts",
  "tests/ppt-asset-image-generation-run.test.ts",
  "tests/provider-tool-adapter.test.ts",
  "tests/v1-9-contract-repair-evidence.test.ts",
  "tests/v1-9-e2e-runner.test.mjs",
  "tests/v1-9-product-preflight.test.ts",
]);

export type V1_9ContractRepairEvidence = {
  schemaVersion: typeof SCHEMA_VERSION;
  evidenceKind: "contract_repair";
  repairScope: typeof REPAIR_SCOPE;
  runId: string;
  projectId: string;
  jobId: string;
  teacherMessageId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  idempotencyKey: string;
  failureObservationId: string;
  failureSignature: string;
  repairFiles: Array<{ path: string; sha256: string }>;
  createdAt: string;
  evidenceDigest: string;
};

export type ContractRepairRecoveryRequest = {
  repairEvidenceDigest: string;
};

export type ContractRepairRecoveryConfig = ContractRepairRecoveryRequest & {
  projectId: string;
  jobId: string;
  teacherMessageId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  idempotencyKey: string;
  failureObservationId: string;
  expectedFailureSignature: string;
};

export type ContractRepairRecoveryEnv = {
  [key: string]: string | undefined;
  V1_9_E2E_MANIFEST_PATH?: string;
  V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST?: string;
  V1_9_CONTRACT_REPAIR_FAILURE_EVIDENCE_DIGEST?: string;
  V1_9_CONTRACT_REPAIR_TASK_ID?: string;
  V1_9_CONTRACT_REPAIR_INTENT_EPOCH?: string;
};

const legacyRecoveryEnvKeys = [
  "V1_9_CONTRACT_REPAIR_FAILURE_EVIDENCE_DIGEST",
  "V1_9_CONTRACT_REPAIR_TASK_ID",
  "V1_9_CONTRACT_REPAIR_INTENT_EPOCH",
] as const;

export function createV1_9ContractRepairEvidence(input: {
  cwd: string;
  runId: string;
  projectId: string;
  jobId: string;
  teacherMessageId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  idempotencyKey: string;
  failureObservationId: string;
  failureSignature: string;
  repairFiles?: string[];
  requiredRepairFiles?: readonly string[];
  createdAt?: string;
}): V1_9ContractRepairEvidence {
  const requiredRepairFiles = normalizeRequiredRepairFiles(input.requiredRepairFiles);
  const repairPaths = normalizeRepairFileClosure(input.repairFiles ?? [...requiredRepairFiles], requiredRepairFiles);
  const unsigned = {
    schemaVersion: SCHEMA_VERSION,
    evidenceKind: "contract_repair" as const,
    repairScope: REPAIR_SCOPE,
    runId: requiredText(input.runId),
    projectId: requiredText(input.projectId),
    jobId: requiredText(input.jobId),
    teacherMessageId: requiredText(input.teacherMessageId),
    taskId: requiredText(input.taskId),
    intentEpoch: nonNegativeInteger(input.intentEpoch),
    taskBriefDigest: sha256Text(input.taskBriefDigest),
    idempotencyKey: requiredText(input.idempotencyKey),
    failureObservationId: requiredText(input.failureObservationId),
    failureSignature: sha256Text(input.failureSignature),
    repairFiles: repairPaths.map((relativePath) => ({
      path: relativePath,
      sha256: hashFile(input.cwd, relativePath),
    })),
    createdAt: validTimestamp(input.createdAt ?? new Date().toISOString()),
  };
  return { ...unsigned, evidenceDigest: digest(unsigned) };
}

export function validateV1_9ContractRepairEvidence(input: {
  cwd: string;
  evidence: unknown;
  expectedEvidenceDigest: string;
  expectedRunId: string;
  expectedProjectId: string;
  expectedJobId?: string;
  expectedTeacherMessageId?: string;
  expectedTaskId: string;
  expectedIntentEpoch: number;
  expectedTaskBriefDigest?: string;
  expectedIdempotencyKey?: string;
  expectedFailureObservationId?: string;
  expectedFailureSignature?: string;
  requiredRepairFiles?: readonly string[];
}): V1_9ContractRepairEvidence {
  try {
    if (!isRecord(input.evidence)) throw invalid();
    const evidence = input.evidence;
    if (
      evidence.schemaVersion !== SCHEMA_VERSION ||
      evidence.evidenceKind !== "contract_repair" ||
      evidence.repairScope !== REPAIR_SCOPE ||
      evidence.runId !== requiredText(input.expectedRunId) ||
      evidence.projectId !== requiredText(input.expectedProjectId) ||
      evidence.taskId !== requiredText(input.expectedTaskId) ||
      evidence.intentEpoch !== nonNegativeInteger(input.expectedIntentEpoch) ||
      evidence.evidenceDigest !== sha256Text(input.expectedEvidenceDigest) ||
      typeof evidence.createdAt !== "string" || !Number.isFinite(Date.parse(evidence.createdAt))
    ) throw invalid();

    const identity = {
      jobId: requiredText(evidence.jobId),
      teacherMessageId: requiredText(evidence.teacherMessageId),
      taskBriefDigest: sha256Text(evidence.taskBriefDigest),
      idempotencyKey: requiredText(evidence.idempotencyKey),
      failureObservationId: requiredText(evidence.failureObservationId),
      failureSignature: sha256Text(evidence.failureSignature),
    };
    if (
      (input.expectedJobId !== undefined && identity.jobId !== requiredText(input.expectedJobId)) ||
      (input.expectedTeacherMessageId !== undefined && identity.teacherMessageId !== requiredText(input.expectedTeacherMessageId)) ||
      (input.expectedTaskBriefDigest !== undefined && identity.taskBriefDigest !== sha256Text(input.expectedTaskBriefDigest)) ||
      (input.expectedIdempotencyKey !== undefined && identity.idempotencyKey !== requiredText(input.expectedIdempotencyKey)) ||
      (input.expectedFailureObservationId !== undefined && identity.failureObservationId !== requiredText(input.expectedFailureObservationId)) ||
      (input.expectedFailureSignature !== undefined && identity.failureSignature !== sha256Text(input.expectedFailureSignature))
    ) throw invalid();

    const requiredRepairFiles = normalizeRequiredRepairFiles(input.requiredRepairFiles);
    if (!Array.isArray(evidence.repairFiles)) throw invalid();
    const repairFiles = evidence.repairFiles.map((item) => {
      if (!isRecord(item) || typeof item.path !== "string" || typeof item.sha256 !== "string") throw invalid();
      const relativePath = normalizeRelativePath(item.path);
      const expectedHash = sha256Text(item.sha256);
      if (hashFile(input.cwd, relativePath) !== expectedHash) throw invalid();
      return { path: relativePath, sha256: expectedHash };
    });
    normalizeRepairFileClosure(repairFiles.map((item) => item.path), requiredRepairFiles);
    if (repairFiles.some((item, index) => item.path !== [...repairFiles].sort((left, right) => left.path.localeCompare(right.path))[index].path)) {
      throw invalid();
    }

    const unsigned = {
      schemaVersion: SCHEMA_VERSION,
      evidenceKind: "contract_repair" as const,
      repairScope: REPAIR_SCOPE,
      runId: evidence.runId,
      projectId: evidence.projectId,
      jobId: identity.jobId,
      teacherMessageId: identity.teacherMessageId,
      taskId: evidence.taskId,
      intentEpoch: evidence.intentEpoch,
      taskBriefDigest: identity.taskBriefDigest,
      idempotencyKey: identity.idempotencyKey,
      failureObservationId: identity.failureObservationId,
      failureSignature: identity.failureSignature,
      repairFiles,
      createdAt: evidence.createdAt,
    };
    if (digest(unsigned) !== evidence.evidenceDigest) throw invalid();
    return { ...unsigned, evidenceDigest: evidence.evidenceDigest };
  } catch (error) {
    if (error instanceof Error && error.message === INVALID) throw error;
    throw invalid();
  }
}

export function readV1_9ContractRepairEvidence(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

export function hasContractRepairRecoveryInput(env: Partial<ContractRepairRecoveryEnv>) {
  return Boolean(env.V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST?.trim()) ||
    legacyRecoveryEnvKeys.some((key) => Boolean(env[key]?.trim()));
}

export function resolveContractRepairRecoveryConfig(
  env: Partial<ContractRepairRecoveryEnv>,
): ContractRepairRecoveryRequest | null {
  if (!hasContractRepairRecoveryInput(env)) return null;
  if (legacyRecoveryEnvKeys.some((key) => Boolean(env[key]?.trim()))) return null;
  try {
    return { repairEvidenceDigest: sha256Text(env.V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST) };
  } catch {
    return null;
  }
}

export function verifyContractRepairRecoveryEvidence(input: {
  cwd: string;
  env: Partial<ContractRepairRecoveryEnv>;
  manifestPath: string;
  manifest?: unknown;
  requiredRepairFiles?: readonly string[];
}): ContractRepairRecoveryConfig | null {
  const request = resolveContractRepairRecoveryConfig(input.env);
  if (!hasContractRepairRecoveryInput(input.env)) return null;
  if (!request) throw invalid();
  const manifest = input.manifest ?? readV1_9ContractRepairEvidence(input.manifestPath);
  if (!isRecord(manifest)) throw invalid();
  const runId = requiredText(manifest.runId);
  const projectId = requiredText(manifest.projectId);
  const taskId = requiredText(manifest.taskId);
  const intentEpoch = nonNegativeInteger(manifest.intentEpoch);
  if (manifest.schemaVersion !== "v1-9-run-manifest.v1" || manifest.status !== "paused_recovery") throw invalid();
  const evidencePath = contractRepairEvidencePath(input.manifestPath, request.repairEvidenceDigest);
  const evidence = validateV1_9ContractRepairEvidence({
    cwd: input.cwd,
    evidence: readV1_9ContractRepairEvidence(evidencePath),
    expectedEvidenceDigest: request.repairEvidenceDigest,
    expectedRunId: runId,
    expectedProjectId: projectId,
    expectedTaskId: taskId,
    expectedIntentEpoch: intentEpoch,
    requiredRepairFiles: input.requiredRepairFiles,
  });
  return {
    repairEvidenceDigest: evidence.evidenceDigest,
    projectId: evidence.projectId,
    jobId: evidence.jobId,
    teacherMessageId: evidence.teacherMessageId,
    taskId: evidence.taskId,
    intentEpoch: evidence.intentEpoch,
    taskBriefDigest: evidence.taskBriefDigest,
    idempotencyKey: evidence.idempotencyKey,
    failureObservationId: evidence.failureObservationId,
    expectedFailureSignature: evidence.failureSignature,
  };
}

export function contractRepairEvidencePath(manifestPath: string, evidenceDigest: string) {
  return path.join(path.dirname(path.resolve(manifestPath)), "evidence", `contract-repair-${sha256Text(evidenceDigest)}.json`);
}

function normalizeRequiredRepairFiles(value?: readonly string[]) {
  const files = value ?? V1_9_CONTRACT_REPAIR_REQUIRED_FILES;
  const normalized = [...new Set(files.map(normalizeRelativePath))].sort();
  if (normalized.length === 0) throw invalid();
  return normalized;
}

function normalizeRepairFileClosure(value: readonly string[], required: readonly string[]) {
  const normalized = [...new Set(value.map(normalizeRelativePath))].sort();
  if (normalized.length !== value.length || required.some((item) => !normalized.includes(item))) throw invalid();
  return normalized;
}

function hashFile(cwd: string, relativePath: string) {
  const root = path.resolve(cwd);
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw invalid();
  return createHash("sha256").update(readFileSync(candidate)).digest("hex");
}

function normalizeRelativePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").includes("..")) {
    throw invalid();
  }
  return normalized;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Text(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value.trim())) throw invalid();
  return value.trim().toLowerCase();
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw invalid();
  return value.trim();
}

function nonNegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid();
  return Number(value);
}

function validTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid() {
  return new Error(INVALID);
}

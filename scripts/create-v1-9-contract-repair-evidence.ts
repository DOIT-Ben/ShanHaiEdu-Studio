import "dotenv/config";

import Database from "better-sqlite3";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  contractRepairEvidencePath,
  createV1_9ContractRepairEvidence,
} from "../src/server/conversation/v1-9-contract-repair-evidence";

const root = path.resolve(process.cwd());
const activePointerPath = path.join(root, "test-results", "v1-9-product-e2e-active.json");
const pointer = readJson(activePointerPath);
const relativeRunRoot = requiredRelativeRunRoot(pointer.relativeRunRoot);
const runRoot = path.join(root, ...relativeRunRoot.split("/"));
const manifestPath = path.join(runRoot, "run-manifest.json");
const manifest = readJson(manifestPath);

if (
  manifest.schemaVersion !== "v1-9-run-manifest.v1" ||
  manifest.status !== "paused_recovery" ||
  manifest.runId !== pointer.runId ||
  typeof manifest.projectId !== "string" ||
  typeof manifest.taskId !== "string" ||
  !Number.isSafeInteger(manifest.intentEpoch)
) throw new Error("v1_9_contract_repair_manifest_invalid");
const runId = manifest.runId as string;
const projectId = manifest.projectId as string;
const taskId = manifest.taskId as string;
const intentEpoch = Number(manifest.intentEpoch);

const database = new Database(path.join(runRoot, "m67.sqlite"), { readonly: true });
const aggregates = database.prepare(`
  SELECT taskBriefJson, status
  FROM TaskAggregate
  WHERE projectId = ? AND taskId = ? AND intentEpoch = ?
`).all(projectId, taskId, intentEpoch) as Array<Record<string, unknown>>;
if (aggregates.length !== 1) throw new Error("v1_9_contract_repair_task_aggregate_ambiguous");
const taskBrief = readRecordJson(aggregates[0].taskBriefJson);
const teacherMessageId = requiredText(taskBrief.sourceMessageId, "taskBrief.sourceMessageId");
const taskBriefDigest = requiredDigest(taskBrief.digest, "taskBrief.digest");
if (taskBrief.taskId !== taskId || taskBrief.projectId !== projectId || taskBrief.intentEpoch !== intentEpoch ||
    !["active", "paused_recovery"].includes(String(aggregates[0].status))) {
  throw new Error("v1_9_contract_repair_task_aggregate_invalid");
}
const jobs = database.prepare(`
  SELECT id, teacherMessageId, idempotencyKey, status, attempts, maxAttempts, errorCode, failureRetryability, updatedAt
  FROM ConversationTurnJob
  WHERE projectId = ? AND teacherMessageId = ?
`).all(projectId, teacherMessageId) as Array<Record<string, unknown>>;
if (jobs.length !== 1) throw new Error("v1_9_contract_repair_job_ambiguous");
const job = jobs[0];
const jobId = requiredText(job.id, "job.id");
const idempotencyKey = requiredText(job.idempotencyKey, "job.idempotencyKey");
const failedAfterContractDefect = job.status === "failed" &&
  ["main_agent_execution_failed", "control_plane_lifecycle_conflict", "main_agent_retry_budget_exhausted"].includes(String(job.errorCode)) &&
  job.failureRetryability === "not_retryable";
const legacyControlledPause = job.status === "failed" && job.errorCode === "turn_failed" &&
  (job.failureRetryability === null || job.failureRetryability === undefined) &&
  aggregates[0].status === "paused_recovery" && isRecord(manifest.recovery) && manifest.recovery.reasonCode === "repeated_failure";
const wronglySucceededIncompleteTask = job.status === "succeeded" && aggregates[0].status === "active";
if (Number(job.attempts) < Number(job.maxAttempts) || (!failedAfterContractDefect && !legacyControlledPause && !wronglySucceededIncompleteTask)) {
  throw new Error("v1_9_contract_repair_job_invalid");
}
const activeJobCount = Number((database.prepare(`
  SELECT COUNT(*) AS count
  FROM ConversationTurnJob
  WHERE projectId = ? AND status IN ('queued', 'running') AND id <> ?
`).get(projectId, jobId) as { count: number }).count);
if (activeJobCount !== 0) throw new Error("v1_9_contract_repair_active_job_exists");
const teacherMessage = database.prepare(`
  SELECT metadataJson FROM ConversationMessage WHERE id = ? AND projectId = ? AND role = 'teacher'
`).get(teacherMessageId, projectId) as Record<string, unknown> | undefined;
const messageTaskBrief = readRecordJson(readRecordJson(teacherMessage?.metadataJson).taskBrief);
if (messageTaskBrief.digest !== taskBriefDigest || messageTaskBrief.taskId !== taskId ||
    messageTaskBrief.projectId !== projectId || messageTaskBrief.intentEpoch !== intentEpoch) {
  throw new Error("v1_9_contract_repair_teacher_message_invalid");
}
const observations = database.prepare(`
  SELECT observationId, payloadJson, status, createdAt
  FROM ObservationRecord
  WHERE projectId = ? AND taskId = ? AND intentEpoch = ? AND status IN ('failed', 'blocked', 'inconclusive')
  ORDER BY createdAt DESC
  LIMIT 64
`).all(projectId, taskId, intentEpoch) as Array<Record<string, unknown>>;
const failureObservation = observations.find((candidate) =>
  /^[a-f0-9]{64}$/i.test(String(readRecordJson(candidate.payloadJson).failureSignature ?? "")),
);
if (!failureObservation) throw new Error("v1_9_contract_repair_failure_signature_missing");
if (Date.parse(String(failureObservation.createdAt)) > Date.parse(String(job.updatedAt))) {
  throw new Error("v1_9_contract_repair_failure_observation_newer_than_job");
}
const failureObservationId = requiredText(failureObservation.observationId, "failureObservation.observationId");
const failureSignature = requiredDigest(readRecordJson(failureObservation.payloadJson).failureSignature, "failureObservation.failureSignature");
database.close();

const evidence = createV1_9ContractRepairEvidence({
  cwd: root,
  runId,
  projectId,
  jobId,
  teacherMessageId,
  taskId,
  intentEpoch,
  taskBriefDigest,
  idempotencyKey,
  failureObservationId,
  failureSignature,
});
const outputPath = contractRepairEvidencePath(manifestPath, evidence.evidenceDigest);
if (path.dirname(outputPath) !== path.join(runRoot, "evidence")) throw new Error("v1_9_contract_repair_path_invalid");
mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
renameSync(temporaryPath, outputPath);

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidenceDigest: evidence.evidenceDigest,
  failureSignature: evidence.failureSignature,
  jobId: evidence.jobId,
  teacherMessageId: evidence.teacherMessageId,
  taskId: evidence.taskId,
  intentEpoch: evidence.intentEpoch,
  repairFileCount: evidence.repairFiles.length,
  relativeEvidencePath: path.relative(root, outputPath).replaceAll("\\", "/"),
})}\n`);

function readJson(filePath: string): Record<string, unknown> {
  const value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("v1_9_contract_repair_json_invalid");
  return value as Record<string, unknown>;
}

function requiredRelativeRunRoot(value: unknown) {
  const normalized = typeof value === "string" ? value.replaceAll("\\", "/") : "";
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) {
    throw new Error("v1_9_contract_repair_run_root_invalid");
  }
  return normalized;
}

function readRecordJson(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`v1_9_contract_repair_${name}_invalid`);
  return value.trim();
}

function requiredDigest(value: unknown, name: string) {
  const digest = requiredText(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`v1_9_contract_repair_${name}_invalid`);
  return digest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

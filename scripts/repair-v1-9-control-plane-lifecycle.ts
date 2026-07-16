import "dotenv/config";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { repairControlPlaneLifecycleConflict } from "../src/server/conversation/control-plane-lifecycle-repair";

void runMain();

async function runMain() {
const root = path.resolve(process.cwd());
const activePointer = readRecord(path.join(root, "test-results", "v1-9-product-e2e-active.json"));
const relativeRunRoot = requiredRelativeRunRoot(activePointer.relativeRunRoot);
const runRoot = path.resolve(root, ...relativeRunRoot.split("/"));
const manifest = readRecord(path.join(runRoot, "run-manifest.json"));
const summary = readRecord(path.join(runRoot, "v1-9-summary.json"));

if (manifest.schemaVersion !== "v1-9-run-manifest.v1" || manifest.status !== "paused_recovery" ||
    manifest.runId !== activePointer.runId || manifest.taskSubmissionCount !== 1 ||
    manifest.externalCodexOrchestrationCount !== 0 || summary.status !== "failed") {
  throw new Error("v1_9_control_plane_lifecycle_manifest_invalid");
}
const diagnostics = Array.isArray(summary.failureDiagnostics) ? summary.failureDiagnostics.filter(isRecord) : [];
const lifecycleDiagnostic = diagnostics.find((item) =>
  item.phase === "output_parse" && item.reason === "unexpected_error" &&
  item.summary === "Tool invocation is not active.",
);
if (!lifecycleDiagnostic) throw new Error("v1_9_control_plane_lifecycle_diagnostic_missing");

const databasePath = path.join(runRoot, "m67.sqlite");
const evidenceDirectory = path.join(runRoot, "evidence");
mkdirSync(evidenceDirectory, { recursive: true });
const backupPath = path.join(evidenceDirectory, `pre-control-plane-lifecycle-repair-${Date.now()}.sqlite`);
const backupDatabase = new Database(databasePath, { readonly: true });
try {
  await backupDatabase.backup(backupPath);
} finally {
  backupDatabase.close();
}
const backupSha256 = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
const client = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: `file:${databasePath.replaceAll("\\", "/")}` }),
});
try {
  const projectId = requiredText(manifest.projectId);
  const taskId = requiredText(manifest.taskId);
  const intentEpoch = requiredInteger(manifest.intentEpoch);
  const aggregate = await client.taskAggregate.findUnique({
    where: { projectId_intentEpoch: { projectId, intentEpoch } },
  });
  const taskBrief = aggregate ? JSON.parse(aggregate.taskBriefJson) as Record<string, unknown> : {};
  const teacherMessageId = requiredText(taskBrief.sourceMessageId);
  const jobs = await client.conversationTurnJob.findMany({
    where: { projectId, teacherMessageId },
  });
  if (aggregate?.taskId !== taskId || jobs.length !== 1) {
    throw new Error("v1_9_control_plane_lifecycle_identity_invalid");
  }
  const repaired = await repairControlPlaneLifecycleConflict({
    client,
    projectId,
    taskId,
    intentEpoch,
    jobId: jobs[0].id,
    teacherMessageId,
  });
  const unsigned = {
    schemaVersion: "v1-9-control-plane-lifecycle-repair.v1",
    runId: requiredText(manifest.runId),
    ...repaired,
    diagnosticDigest: digest(lifecycleDiagnostic),
    taskSubmissionCount: manifest.taskSubmissionCount,
    externalCodexOrchestrationCount: manifest.externalCodexOrchestrationCount,
    backupRelativePath: path.relative(root, backupPath).replaceAll("\\", "/"),
    backupSha256,
    createdAt: new Date().toISOString(),
  };
  const evidence = { ...unsigned, evidenceDigest: digest(unsigned) };
  const evidencePath = path.join(evidenceDirectory, `control-plane-lifecycle-repair-${evidence.evidenceDigest}.json`);
  const temporaryPath = `${evidencePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporaryPath, evidencePath);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId: evidence.runId,
    projectId: evidence.projectId,
    taskId: evidence.taskId,
    intentEpoch: evidence.intentEpoch,
    jobId: evidence.jobId,
    failureObservationId: evidence.failureObservationId,
    failureSignature: evidence.failureSignature,
    previousPlanRevision: evidence.previousPlanRevision,
    restoredPlanRevision: evidence.restoredPlanRevision,
    evidenceDigest: evidence.evidenceDigest,
    relativeEvidencePath: path.relative(root, evidencePath).replaceAll("\\", "/"),
  })}\n`);
} finally {
  await client.$disconnect();
}
}

function readRecord(filePath: string) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error("v1_9_control_plane_lifecycle_json_invalid");
  return parsed;
}

function requiredRelativeRunRoot(value: unknown) {
  const normalized = typeof value === "string" ? value.replaceAll("\\", "/") : "";
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) {
    throw new Error("v1_9_control_plane_lifecycle_run_root_invalid");
  }
  return normalized;
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("v1_9_control_plane_lifecycle_text_invalid");
  return value.trim();
}

function requiredInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("v1_9_control_plane_lifecycle_integer_invalid");
  return Number(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

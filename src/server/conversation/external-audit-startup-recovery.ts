import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  normalizeExternalAuditRepairHandoff,
} from "@/server/conversation/external-audit-repair-contract";
import { restoreMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import { hasValidTaskBrief, type TaskBrief } from "@/server/conversation/task-contract";
import {
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
} from "../../../scripts/lib/v1-9-e2e-contract.mjs";

type V1_9ExternalAuditRecoveryEnv = {
  V1_9_E2E_MANIFEST_PATH?: string;
  V1_9_E2E_STATE_PATH?: string;
  V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID?: string;
};

type V1_9ExternalAuditAuthorityDependencies = {
  readBytes(filePath: string): Buffer;
};

export type V1_9ExternalAuditRecoveryAuthority = {
  runId: string;
  manifestSha256: string;
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  actorUserId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  projectId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  sourcePlanRevision: number;
  committedPlanRevision: number;
  turnJobId: string;
  teacherMessageId: string;
  handoffDigest: string;
  reportDigest: string;
  observationId: string;
};

export type V1_9ExternalAuditDrainIdentity = {
  projectId: string;
  actorUserId: string;
  actorAuthMode: V1_9ExternalAuditRecoveryAuthority["actorAuthMode"];
  authSessionId: string | null;
};

export function resolveV1_9ExternalAuditRecoveryAuthority(input: {
  cwd?: string;
  env?: V1_9ExternalAuditRecoveryEnv;
  dependencies?: Partial<V1_9ExternalAuditAuthorityDependencies>;
}): V1_9ExternalAuditRecoveryAuthority | null {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaultAuthorityDependencies, ...input.dependencies };
  try {
    const pointerPath = path.join(cwd, "test-results", "v1-9-product-e2e-active.json");
    const pointer = parseBufferRecord(dependencies.readBytes(pointerPath));
    if (pointer.schemaVersion !== "v1-9-active-run.v2") return null;
    assertOnlyFields(pointer, [
      "schemaVersion", "runId", "relativeRunRoot", "manifestPath", "manifestSha256", "statePath",
    ]);
    const runId = requiredText(pointer.runId);
    const relativeRunRoot = requiredRelativeRunRoot(pointer.relativeRunRoot);
    if (path.posix.basename(relativeRunRoot) !== runId) throw invalidExternalAuditRecovery();
    const runRoot = resolveOwnedRunRoot(cwd, relativeRunRoot);
    const manifestPath = resolveOwnedRunFile(cwd, runRoot, pointer.manifestPath, "run-manifest.json");
    const statePath = resolveOwnedRunFile(cwd, runRoot, pointer.statePath, "run-state.json");
    if (path.resolve(cwd, requiredText(env.V1_9_E2E_MANIFEST_PATH)) !== manifestPath ||
        path.resolve(cwd, requiredText(env.V1_9_E2E_STATE_PATH)) !== statePath) {
      throw invalidExternalAuditRecovery();
    }

    const manifestBytes = dependencies.readBytes(manifestPath);
    const manifest = normalizeV1_9RunManifestV2(parseBufferJson(manifestBytes));
    const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
    const state = normalizeV1_9RunState(parseBufferJson(dependencies.readBytes(statePath)));
    if (sha256(manifestBytes) !== manifestSha256 || requiredDigest(pointer.manifestSha256) !== manifestSha256 ||
        manifest.runId !== runId || manifest.relativeRunRoot.replaceAll("\\", "/") !== relativeRunRoot ||
        state.runId !== runId || state.manifestSha256 !== manifestSha256) {
      throw invalidExternalAuditRecovery();
    }
    if (state.status !== "external_acceptance_repair_required") return null;

    const identity = state.identity;
    const lock = state.taskContractLock;
    const acceptance = state.packageAcceptance;
    const repair = acceptance?.currentRepair;
    const latestRound = acceptance?.rounds.at(-1);
    if (!identity.actorUserId || !identity.projectId || !identity.taskId || identity.intentEpoch === null ||
        !lock || !acceptance || !repair || !latestRound || latestRound.outcome !== "repair_required" ||
        state.ledger.currentPlanRevision === null ||
        latestRound.repairHandoffPath !== repair.repairHandoffPath ||
        latestRound.repairHandoffDigest !== repair.repairHandoffDigest ||
        latestRound.reportDigest !== repair.reportDigest ||
        !sameJson(latestRound.openP0FindingIds, repair.openP0FindingIds) ||
        !sameJson(latestRound.affectedUnits, repair.affectedUnits)) {
      throw invalidExternalAuditRecovery();
    }

    const handoffPath = resolveRunRelativeFile(runRoot, repair.repairHandoffPath);
    const handoffBytes = dependencies.readBytes(handoffPath);
    if (sha256(handoffBytes) !== repair.repairHandoffDigest) throw invalidExternalAuditRecovery();
    const handoff = normalizeExternalAuditRepairHandoff(parseBufferJson(handoffBytes));
    const binding = handoff.taskBinding;
    const responsibilityLayers = [...new Set(handoff.findings.map((finding) => finding.responsibilityLayer))].sort();
    const repairFeedback = handoff.findings.map((finding) => ({
      findingId: finding.findingId,
      responsibilityLayer: finding.responsibilityLayer,
      category: finding.category,
      design: finding.feedback.design,
      vulnerability: finding.feedback.vulnerability,
      engineering: finding.feedback.engineering,
    })).sort((left, right) => left.findingId.localeCompare(right.findingId));
    if (handoff.runId !== runId || handoff.manifestSha256 !== manifestSha256 ||
        handoff.reportDigest !== repair.reportDigest ||
        handoff.packageArtifactId !== acceptance.packageArtifactId ||
        handoff.packageArtifactVersion !== acceptance.packageArtifactVersion ||
        handoff.packageVersion !== acceptance.packageVersion || handoff.packageSha256 !== acceptance.packageSha256 ||
        binding.actorUserId !== identity.actorUserId || binding.actorAuthMode !== lock.actorAuthMode ||
        binding.projectId !== identity.projectId || binding.taskId !== identity.taskId ||
        binding.intentEpoch !== identity.intentEpoch || binding.intentEpoch !== lock.intentEpoch ||
        binding.taskBriefDigest !== lock.taskBriefDigest || binding.planRevision !== state.ledger.currentPlanRevision ||
        binding.turnJobId !== lock.turnJobId || binding.teacherMessageId !== lock.teacherMessageId ||
        acceptance.turnJobId !== lock.turnJobId || acceptance.teacherMessageId !== lock.teacherMessageId ||
        !sameJson(handoff.openFindingIds, repair.openP0FindingIds) ||
        !sameJson(handoff.affectedUnits, repair.affectedUnits) ||
        !sameJson(responsibilityLayers, repair.responsibilityLayers) ||
        !sameJson(repairFeedback, repair.feedback)) {
      throw invalidExternalAuditRecovery();
    }

    return normalizeAuthority({
      runId,
      manifestSha256,
      packageArtifactId: acceptance.packageArtifactId,
      packageArtifactVersion: acceptance.packageArtifactVersion,
      packageVersion: acceptance.packageVersion,
      packageSha256: acceptance.packageSha256,
      actorUserId: identity.actorUserId,
      actorAuthMode: lock.actorAuthMode,
      projectId: identity.projectId,
      taskId: identity.taskId,
      intentEpoch: identity.intentEpoch,
      taskBriefDigest: lock.taskBriefDigest,
      sourcePlanRevision: binding.planRevision,
      committedPlanRevision: binding.planRevision + 1,
      turnJobId: binding.turnJobId,
      teacherMessageId: binding.teacherMessageId,
      handoffDigest: handoff.handoffDigest,
      reportDigest: handoff.reportDigest,
      observationId: `external-audit:${handoff.handoffDigest}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "v1_9_external_audit_recovery_invalid") throw error;
    throw invalidExternalAuditRecovery();
  }
}

export async function recoverV1_9ExternalAuditTurn(input: {
  client: PrismaClient;
  authority: V1_9ExternalAuditRecoveryAuthority;
  drainProject(identity: V1_9ExternalAuditDrainIdentity): Promise<void>;
}): Promise<true> {
  const authority = normalizeAuthority(input.authority);
  const [project, aggregate, teacherMessage, turnJob, observation, event, snapshot, activeOtherJobs] = await Promise.all([
    input.client.project.findUnique({ where: { id: authority.projectId } }),
    input.client.taskAggregate.findUnique({
      where: { projectId_intentEpoch: { projectId: authority.projectId, intentEpoch: authority.intentEpoch } },
    }),
    input.client.conversationMessage.findFirst({
      where: { id: authority.teacherMessageId, projectId: authority.projectId, role: "teacher" },
    }),
    input.client.conversationTurnJob.findFirst({
      where: { id: authority.turnJobId, projectId: authority.projectId },
    }),
    input.client.observationRecord.findUnique({ where: { observationId: authority.observationId } }),
    input.client.agentEventRecord.findUnique({ where: { eventId: `external-audit-event:${authority.handoffDigest}` } }),
    input.client.semanticContextSnapshotRecord.findUnique({
      where: { snapshotId: `external-audit-snapshot:${authority.handoffDigest}` },
    }),
    input.client.conversationTurnJob.count({
      where: {
        projectId: authority.projectId,
        id: { not: authority.turnJobId },
        status: { in: ["queued", "running"] },
      },
    }),
  ]);

  if (!project || (project.ownerUserId !== null && project.ownerUserId !== authority.actorUserId) ||
      project.intentEpoch !== authority.intentEpoch || !aggregate || !teacherMessage || !turnJob || !observation ||
      !event || !snapshot || activeOtherJobs !== 0) {
    throw invalidExternalAuditRecovery();
  }
  if (turnJob.status !== "queued" || turnJob.teacherMessageId !== authority.teacherMessageId ||
      turnJob.actorUserId !== authority.actorUserId || turnJob.actorAuthMode !== authority.actorAuthMode ||
      turnJob.recoveryEvidenceDigest !== authority.handoffDigest) {
    throw invalidExternalAuditRecovery();
  }
  if (aggregate.taskId !== authority.taskId || aggregate.intentEpoch !== authority.intentEpoch ||
      aggregate.planRevision !== authority.committedPlanRevision || aggregate.status !== "paused_recovery") {
    throw invalidExternalAuditRecovery();
  }

  const taskBrief = parseTaskBrief(aggregate.taskBriefJson);
  const messageTaskBrief = parseMessageTaskBrief(teacherMessage.metadataJson);
  if (taskBrief.digest !== authority.taskBriefDigest || taskBrief.taskId !== authority.taskId ||
      taskBrief.projectId !== authority.projectId || taskBrief.intentEpoch !== authority.intentEpoch ||
      taskBrief.sourceMessageId !== authority.teacherMessageId || messageTaskBrief.digest !== authority.taskBriefDigest) {
    throw invalidExternalAuditRecovery();
  }

  const checkpoint = parseCheckpoint(aggregate.checkpointJson);
  if (checkpoint.task.projectId !== authority.projectId || checkpoint.task.taskId !== authority.taskId ||
      checkpoint.task.taskBriefDigest !== authority.taskBriefDigest || checkpoint.task.intentEpoch !== authority.intentEpoch ||
      checkpoint.task.planRevision !== authority.committedPlanRevision ||
      !checkpoint.externalObservations?.some((item) =>
        item.observationId === authority.observationId && item.status === "repair" &&
        item.reasonCodes.includes("external_acceptance_p0_repair_required"))) {
    throw invalidExternalAuditRecovery();
  }

  const observationPayload = parseRecord(observation.payloadJson);
  if (observation.projectId !== authority.projectId || observation.taskId !== authority.taskId ||
      observation.intentEpoch !== authority.intentEpoch || observation.status !== "repair" ||
      observationPayload.runId !== authority.runId || observationPayload.manifestSha256 !== authority.manifestSha256 ||
      observationPayload.handoffDigest !== authority.handoffDigest || observationPayload.reportDigest !== authority.reportDigest ||
      observationPayload.taskBriefDigest !== authority.taskBriefDigest ||
      observationPayload.sourcePlanRevision !== authority.sourcePlanRevision ||
      observationPayload.committedPlanRevision !== authority.committedPlanRevision ||
      observationPayload.turnJobId !== authority.turnJobId || observationPayload.teacherMessageId !== authority.teacherMessageId) {
    throw invalidExternalAuditRecovery();
  }
  if (event.projectId !== authority.projectId || event.taskId !== authority.taskId ||
      event.intentEpoch !== authority.intentEpoch || event.runId !== authority.runId ||
      snapshot.projectId !== authority.projectId || snapshot.taskId !== authority.taskId ||
      snapshot.intentEpoch !== authority.intentEpoch || snapshot.planRevision !== authority.committedPlanRevision) {
    throw invalidExternalAuditRecovery();
  }

  await input.drainProject({
    projectId: authority.projectId,
    actorUserId: authority.actorUserId,
    actorAuthMode: authority.actorAuthMode,
    authSessionId: turnJob.authSessionId,
  });
  return true;
}

function normalizeAuthority(value: V1_9ExternalAuditRecoveryAuthority): V1_9ExternalAuditRecoveryAuthority {
  const authority = value as unknown as Record<string, unknown>;
  const normalized = {
    runId: requiredText(authority.runId),
    manifestSha256: requiredDigest(authority.manifestSha256),
    packageArtifactId: requiredText(authority.packageArtifactId),
    packageArtifactVersion: requiredPositiveInteger(authority.packageArtifactVersion),
    packageVersion: requiredText(authority.packageVersion),
    packageSha256: requiredDigest(authority.packageSha256),
    actorUserId: requiredText(authority.actorUserId),
    actorAuthMode: requiredAuthMode(authority.actorAuthMode),
    projectId: requiredText(authority.projectId),
    taskId: requiredText(authority.taskId),
    intentEpoch: requiredNonNegativeInteger(authority.intentEpoch),
    taskBriefDigest: requiredDigest(authority.taskBriefDigest),
    sourcePlanRevision: requiredNonNegativeInteger(authority.sourcePlanRevision),
    committedPlanRevision: requiredNonNegativeInteger(authority.committedPlanRevision),
    turnJobId: requiredText(authority.turnJobId),
    teacherMessageId: requiredText(authority.teacherMessageId),
    handoffDigest: requiredDigest(authority.handoffDigest),
    reportDigest: requiredDigest(authority.reportDigest),
    observationId: requiredText(authority.observationId),
  };
  if (normalized.committedPlanRevision !== normalized.sourcePlanRevision + 1 ||
      normalized.observationId !== `external-audit:${normalized.handoffDigest}`) {
    throw invalidExternalAuditRecovery();
  }
  return normalized;
}

function parseTaskBrief(value: string): TaskBrief {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!hasValidTaskBrief(parsed as TaskBrief)) throw invalidExternalAuditRecovery();
    return parsed as TaskBrief;
  } catch {
    throw invalidExternalAuditRecovery();
  }
}

function parseMessageTaskBrief(value: string): TaskBrief {
  const metadata = parseRecord(value);
  if (!hasValidTaskBrief(metadata.taskBrief as TaskBrief)) throw invalidExternalAuditRecovery();
  return metadata.taskBrief as TaskBrief;
}

function parseCheckpoint(value: string) {
  try {
    return restoreMainAgentReActCheckpoint(
      JSON.parse(value) as Parameters<typeof restoreMainAgentReActCheckpoint>[0],
    );
  } catch {
    throw invalidExternalAuditRecovery();
  }
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidExternalAuditRecovery();
    return parsed as Record<string, unknown>;
  } catch {
    throw invalidExternalAuditRecovery();
  }
}

function parseBufferJson(value: Buffer): unknown {
  try {
    return JSON.parse(value.toString("utf8")) as unknown;
  } catch {
    throw invalidExternalAuditRecovery();
  }
}

function parseBufferRecord(value: Buffer): Record<string, unknown> {
  const parsed = parseBufferJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidExternalAuditRecovery();
  return parsed as Record<string, unknown>;
}

function assertOnlyFields(value: Record<string, unknown>, fields: string[]) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    throw invalidExternalAuditRecovery();
  }
}

function requiredRelativeRunRoot(value: unknown) {
  const normalized = requiredText(value).replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9][a-z0-9._-]{0,191}$/i.test(normalized) || normalized.includes("..")) {
    throw invalidExternalAuditRecovery();
  }
  return normalized;
}

function resolveOwnedRunRoot(cwd: string, relativeRunRoot: string) {
  const testResultsRoot = path.resolve(cwd, "test-results");
  const runRoot = path.resolve(cwd, ...relativeRunRoot.split("/"));
  const relative = path.relative(testResultsRoot, runRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw invalidExternalAuditRecovery();
  return runRoot;
}

function resolveOwnedRunFile(cwd: string, runRoot: string, value: unknown, fileName: string) {
  const normalized = requiredText(value).replaceAll("\\", "/");
  const filePath = path.resolve(cwd, ...normalized.split("/"));
  if (path.relative(runRoot, filePath) !== fileName) throw invalidExternalAuditRecovery();
  return filePath;
}

function resolveRunRelativeFile(runRoot: string, value: unknown) {
  const normalized = requiredText(value).replaceAll("\\", "/");
  const filePath = path.resolve(runRoot, ...normalized.split("/"));
  const relative = path.relative(runRoot, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw invalidExternalAuditRecovery();
  return filePath;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw invalidExternalAuditRecovery();
  return value.trim();
}

function requiredDigest(value: unknown) {
  const digest = requiredText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw invalidExternalAuditRecovery();
  return digest;
}

function requiredNonNegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalidExternalAuditRecovery();
  return Number(value);
}

function requiredPositiveInteger(value: unknown) {
  const number = requiredNonNegativeInteger(value);
  if (number === 0) throw invalidExternalAuditRecovery();
  return number;
}

function requiredAuthMode(value: unknown): V1_9ExternalAuditRecoveryAuthority["actorAuthMode"] {
  if (value !== "local" && value !== "password" && value !== "oauth" && value !== "sso") {
    throw invalidExternalAuditRecovery();
  }
  return value;
}

function invalidExternalAuditRecovery() {
  return new Error("v1_9_external_audit_recovery_invalid");
}

const defaultAuthorityDependencies: V1_9ExternalAuditAuthorityDependencies = {
  readBytes: (filePath) => readFileSync(filePath),
};

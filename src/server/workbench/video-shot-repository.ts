import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { isPersistedArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import type { UpsertVideoShotsInput } from "./types";

async function upsertVideoShots(client: PrismaClient, projectId: string, input: UpsertVideoShotsInput) {
  assertVideoShotPlan(input);
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const sourceArtifact = await tx.artifact.findFirst({ where: { id: input.sourceArtifactId, projectId } });
    if (!sourceArtifact) throw new Error(`Artifact not found: ${input.sourceArtifactId}`);
    await tx.videoShot.deleteMany({
      where: {
        projectId,
        sourceArtifactId: input.sourceArtifactId,
        shotId: { notIn: input.shots.map((shot) => shot.shotId) },
      },
    });

    return Promise.all(input.shots.map(async (shot) => {
      const existing = await tx.videoShot.findUnique({
        where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId: input.sourceArtifactId, shotId: shot.shotId } },
      });
      if (!existing) {
        return tx.videoShot.create({ data: { projectId, sourceArtifactId: input.sourceArtifactId, ...shot } });
      }
      const changedInput = existing.inputHash !== shot.inputHash || existing.ordinal !== shot.ordinal;
      return tx.videoShot.update({
        where: { id: existing.id },
        data: changedInput
          ? { ...shot, providerTaskId: null, selectedArtifactId: null, status: "planned", qaJson: "{}" }
          : { ordinal: shot.ordinal },
      });
    }));
  });
}

async function recordVideoShotProviderTask(
  client: PrismaClient,
  projectId: string,
  sourceArtifactId: string,
  shotId: string,
  providerTaskId: string,
) {
  const taskId = providerTaskId.trim();
  if (!taskId) throw new Error("VideoShot providerTaskId is required.");
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const shot = await tx.videoShot.findUnique({ where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId, shotId } } });
    if (!shot) throw new Error(`VideoShot not found: ${shotId}`);
    if (shot.providerTaskId && shot.providerTaskId !== taskId) throw new Error(`VideoShot providerTaskId conflict: ${shotId}`);
    if (!["planned", "submitted"].includes(shot.status)) throw new Error(`VideoShot cannot accept provider task from status: ${shot.status}`);
    return tx.videoShot.update({ where: { id: shot.id }, data: { providerTaskId: taskId, status: "submitted" } });
  });
}

async function selectVideoShotArtifact(
  client: PrismaClient,
  projectId: string,
  sourceArtifactId: string,
  shotId: string,
  artifactId: string,
  qa: Record<string, unknown> = {},
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const [shot, artifact, generationJobs] = await Promise.all([
      tx.videoShot.findUnique({ where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId, shotId } } }),
      tx.artifact.findFirst({
        where: { id: artifactId, projectId, kind: "video_segment_generate", nodeKey: "video_segment_generate" },
      }),
      tx.generationJob.findMany({
        where: { projectId, resultArtifactId: artifactId },
        include: { runInputSnapshot: true },
        take: 2,
      }),
    ]);
    if (!shot) throw new Error(`VideoShot not found: ${shotId}`);
    if (!artifact) throw new Error(`VideoShot selected artifact is invalid: ${artifactId}`);
    if (artifact.origin !== "tool_result" || !isPersistedArtifactTrustedForDownstream(artifact)
        || !hasBoundVideoShotGenerationJob(generationJobs, projectId, sourceArtifactId, shotId)
        || !hasVideoShotArtifactEvidence(artifact.structuredContentJson, sourceArtifactId, shotId)) {
      throw new Error(`VideoShot selected artifact binding is invalid: ${artifactId}`);
    }
    return tx.videoShot.update({ where: { id: shot.id }, data: { selectedArtifactId: artifact.id, status: "ready", qaJson: JSON.stringify(qa) } });
  });
}

async function updateVideoShotQa(
  client: PrismaClient,
  projectId: string,
  sourceArtifactId: string,
  shotId: string,
  status: "ready" | "needs_retake" | "failed",
  qa: Record<string, unknown>,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const shot = await tx.videoShot.findUnique({ where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId, shotId } } });
    if (!shot) throw new Error(`VideoShot not found: ${shotId}`);
    if (status === "ready" && !shot.selectedArtifactId) throw new Error(`VideoShot cannot be ready without a selected artifact: ${shotId}`);
    return tx.videoShot.update({ where: { id: shot.id }, data: { status, qaJson: JSON.stringify(qa) } });
  });
}

async function getVideoShots(client: PrismaClient, projectId: string, sourceArtifactId?: string) {
  return client.videoShot.findMany({
    where: { projectId, ...(sourceArtifactId ? { sourceArtifactId } : {}) },
    orderBy: [{ sourceArtifactId: "asc" }, { ordinal: "asc" }],
  });
}

function assertVideoShotPlan(input: UpsertVideoShotsInput) {
  if (!input.sourceArtifactId.trim() || input.shots.length < 3) throw new Error("VideoShot plan requires a source artifact and at least three shots.");
  const seen = new Set<string>();
  for (const [index, shot] of input.shots.entries()) {
    if (!/^shot_[a-z0-9_-]+$/i.test(shot.shotId) || seen.has(shot.shotId) || shot.ordinal !== index + 1 || !/^[a-f0-9]{64}$/i.test(shot.inputHash)) {
      throw new Error("VideoShot plan is invalid.");
    }
    seen.add(shot.shotId);
  }
}

type VideoShotGenerationJobCandidate = {
  projectId: string;
  kind: string;
  sourceArtifactId: string;
  unitId: string | null;
  intentEpoch: number;
  inputHash: string | null;
  status: string;
  resultArtifactId: string | null;
  runInputSnapshotId: string | null;
  runInputSnapshot: null | {
    id: string;
    projectId: string;
    intentEpoch: number;
    capabilityId: string;
    sourceArtifactIdsJson: string;
    payloadJson: string;
    inputHash: string;
  };
};

function hasBoundVideoShotGenerationJob(
  jobs: VideoShotGenerationJobCandidate[],
  projectId: string,
  sourceArtifactId: string,
  shotId: string,
) {
  if (jobs.length !== 1) return false;
  const job = jobs[0];
  const snapshot = job.runInputSnapshot;
  if (!snapshot || job.projectId !== projectId || job.kind !== "video" || job.status !== "succeeded"
      || job.sourceArtifactId !== sourceArtifactId || job.unitId !== shotId
      || job.runInputSnapshotId !== snapshot.id || job.inputHash !== snapshot.inputHash
      || job.intentEpoch !== snapshot.intentEpoch || snapshot.projectId !== projectId
      || snapshot.capabilityId !== "video_segment_generate") {
    return false;
  }
  try {
    const sourceArtifactIds: unknown = JSON.parse(snapshot.sourceArtifactIdsJson);
    const payload: unknown = JSON.parse(snapshot.payloadJson);
    if (!Array.isArray(sourceArtifactIds) || sourceArtifactIds[0] !== sourceArtifactId || !isRecord(payload)
        || !Array.isArray(payload.sourceArtifactIds) || payload.sourceArtifactIds[0] !== sourceArtifactId
        || !isRecord(payload.input) || payload.input.unitId !== shotId) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function hasVideoShotArtifactEvidence(structuredContentJson: string, sourceArtifactId: string, shotId: string) {
  try {
    const structuredContent: unknown = JSON.parse(structuredContentJson);
    if (!isRecord(structuredContent) || !isRecord(structuredContent.storage)) return false;
    const videoAsset = structuredContent.storage.videoAsset;
    if (!isRecord(videoAsset) || !isRecord(videoAsset.requestEvidence)) return false;
    const sourceArtifactIds = videoAsset.sourceArtifactIds;
    return videoAsset.sourceArtifactId === sourceArtifactId
      && Array.isArray(sourceArtifactIds)
      && sourceArtifactIds.every((value) => typeof value === "string")
      && sourceArtifactIds.includes(sourceArtifactId)
      && videoAsset.requestEvidence.shotId === shotId;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createVideoShotRepository(client: PrismaClient = prisma) {
  return {
    upsertVideoShots: upsertVideoShots.bind(null, client),
    recordVideoShotProviderTask: recordVideoShotProviderTask.bind(null, client),
    selectVideoShotArtifact: selectVideoShotArtifact.bind(null, client),
    updateVideoShotQa: updateVideoShotQa.bind(null, client),
    getVideoShots: getVideoShots.bind(null, client),
  };
}

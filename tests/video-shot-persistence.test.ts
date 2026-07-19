import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import { createVideoShotRepository } from "@/server/workbench/video-shot-repository";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "stage4-video-shot-tests");
const databasePath = path.join(stageRoot, `video-shot-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let client: PrismaClient;

type VideoShotRepository = Pick<
  ReturnType<typeof createPrismaWorkbenchRepository>,
  "getVideoShots" | "selectVideoShotArtifact" | "upsertVideoShots"
>;

function inputHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function createBoundVideoClip(input: {
  projectId: string;
  sourceArtifactId: string;
  shotId: string;
  title: string;
  origin?: "legacy" | "tool_result";
  downstreamEligible?: boolean;
}) {
  const structuredContentJson = JSON.stringify({
    ...(input.downstreamEligible === false ? {} : {
      artifactQualityState: {
        validationStatus: "passed",
        reviewStatus: "passed",
        downstreamEligibility: "eligible",
      },
    }),
    storage: {
      videoAsset: {
        sourceArtifactId: input.sourceArtifactId,
        sourceArtifactIds: [input.sourceArtifactId],
        requestEvidence: { shotId: input.shotId, durationSeconds: 10, references: [] },
      },
    },
  });
  return client.$transaction(async (tx) => {
    const hash = inputHash(`${input.sourceArtifactId}:${input.shotId}:${input.title}`);
    const snapshot = await tx.runInputSnapshot.create({
      data: {
        projectId: input.projectId,
        intentEpoch: 0,
        capabilityId: "video_segment_generate",
        sourceArtifactIdsJson: JSON.stringify([input.sourceArtifactId]),
        payloadJson: JSON.stringify({
          projectId: input.projectId,
          intentEpoch: 0,
          capabilityId: "video_segment_generate",
          kind: "video",
          sourceArtifactIds: [input.sourceArtifactId],
          input: { unitId: input.shotId },
        }),
        inputHash: hash,
      },
    });
    const artifact = await tx.artifact.create({
      data: {
        projectId: input.projectId,
        origin: input.origin ?? "tool_result",
        nodeKey: "video_segment_generate",
        kind: "video_segment_generate",
        title: input.title,
        status: "needs_review",
        summary: "clip",
        markdownContent: "# Clip",
        structuredContentJson,
        version: 1,
        isApproved: false,
      },
    });
    await tx.generationJob.create({
      data: {
        projectId: input.projectId,
        kind: "video",
        sourceArtifactId: input.sourceArtifactId,
        unitId: input.shotId,
        runInputSnapshotId: snapshot.id,
        inputHash: hash,
        status: "succeeded",
        pollState: "completed",
        resultArtifactId: artifact.id,
        finishedAt: new Date(),
      },
    });
    return artifact;
  });
}

async function rejectedMessage(operation: () => Promise<unknown>) {
  try {
    await operation();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function expectCompletePlanReconciliation(repository: VideoShotRepository) {
  const project = await client.project.create({
    data: { id: `video-reconcile-${randomUUID()}`, title: "Video reconcile", currentNodeKey: "requirement_spec" },
  });
  const otherProject = await client.project.create({
    data: { id: `video-reconcile-other-${randomUUID()}`, title: "Video reconcile other", currentNodeKey: "requirement_spec" },
  });
  const [source, siblingSource, otherProjectSource] = await Promise.all([
    client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Storyboard", status: "approved", summary: "Storyboard", markdownContent: "# Storyboard", version: 1, isApproved: true },
    }),
    client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Sibling storyboard", status: "approved", summary: "Sibling storyboard", markdownContent: "# Sibling storyboard", version: 1, isApproved: true },
    }),
    client.artifact.create({
      data: { projectId: otherProject.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Other storyboard", status: "approved", summary: "Other storyboard", markdownContent: "# Other storyboard", version: 1, isApproved: true },
    }),
  ]);
  const initialShots = ["shot_keep", "shot_remove", "shot_reorder", "shot_tail"].map((shotId, index) => ({
    shotId,
    ordinal: index + 1,
    inputHash: inputHash(`${source.id}:${shotId}`),
  }));
  const isolationShots = ["shot_keep", "shot_remove", "shot_reorder"].map((shotId, index) => ({
    shotId,
    ordinal: index + 1,
    inputHash: inputHash(`isolation:${shotId}`),
  }));

  await repository.upsertVideoShots(project.id, { sourceArtifactId: source.id, shots: initialShots });
  await repository.upsertVideoShots(project.id, { sourceArtifactId: siblingSource.id, shots: isolationShots });
  await repository.upsertVideoShots(otherProject.id, { sourceArtifactId: otherProjectSource.id, shots: isolationShots });
  await repository.upsertVideoShots(project.id, {
    sourceArtifactId: source.id,
    shots: ["shot_keep", "shot_reorder", "shot_tail"].map((shotId, index) => ({
      shotId,
      ordinal: index + 1,
      inputHash: inputHash(`${source.id}:${shotId}`),
    })),
  });

  const [reconciled, sibling, other] = await Promise.all([
    repository.getVideoShots(project.id, source.id),
    repository.getVideoShots(project.id, siblingSource.id),
    repository.getVideoShots(otherProject.id, otherProjectSource.id),
  ]);
  expect(reconciled.map((shot) => [shot.shotId, shot.ordinal])).toEqual([
    ["shot_keep", 1],
    ["shot_reorder", 2],
    ["shot_tail", 3],
  ]);
  expect(sibling.map((shot) => shot.shotId)).toEqual(["shot_keep", "shot_remove", "shot_reorder"]);
  expect(other.map((shot) => shot.shotId)).toEqual(["shot_keep", "shot_remove", "shot_reorder"]);
}

async function expectSelectedArtifactBinding(repository: VideoShotRepository) {
  const project = await client.project.create({
    data: { id: `video-binding-${randomUUID()}`, title: "Video binding", currentNodeKey: "requirement_spec" },
  });
  const [source, otherSource] = await Promise.all([
    client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Binding storyboard", status: "approved", summary: "Storyboard", markdownContent: "# Storyboard", version: 1, isApproved: true },
    }),
    client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Other binding storyboard", status: "approved", summary: "Other storyboard", markdownContent: "# Other storyboard", version: 1, isApproved: true },
    }),
  ]);
  const shots = [1, 2, 3].map((ordinal) => ({
    shotId: `shot_0${ordinal}`,
    ordinal,
    inputHash: inputHash(`${source.id}:shot_0${ordinal}`),
  }));
  await repository.upsertVideoShots(project.id, { sourceArtifactId: source.id, shots });
  await repository.upsertVideoShots(project.id, {
    sourceArtifactId: otherSource.id,
    shots: shots.map((shot) => ({ ...shot, inputHash: inputHash(`${otherSource.id}:${shot.shotId}`) })),
  });
  const crossShot = await createBoundVideoClip({
    projectId: project.id,
    sourceArtifactId: source.id,
    shotId: "shot_02",
    title: "Cross shot clip",
  });
  const crossSource = await createBoundVideoClip({
    projectId: project.id,
    sourceArtifactId: otherSource.id,
    shotId: "shot_03",
    title: "Cross source clip",
  });
  const correct = await createBoundVideoClip({
    projectId: project.id,
    sourceArtifactId: source.id,
    shotId: "shot_01",
    title: "Correct clip",
  });
  const legacy = await createBoundVideoClip({
    projectId: project.id,
    sourceArtifactId: source.id,
    shotId: "shot_02",
    title: "Legacy clip",
    origin: "legacy",
  });
  const untrusted = await createBoundVideoClip({
    projectId: project.id,
    sourceArtifactId: source.id,
    shotId: "shot_03",
    title: "Untrusted clip",
    downstreamEligible: false,
  });

  const crossShotError = await rejectedMessage(() => repository.selectVideoShotArtifact(
    project.id,
    source.id,
    "shot_01",
    crossShot.id,
  ));
  const crossSourceError = await rejectedMessage(() => repository.selectVideoShotArtifact(
    project.id,
    source.id,
    "shot_03",
    crossSource.id,
  ));
  const legacyError = await rejectedMessage(() => repository.selectVideoShotArtifact(
    project.id,
    source.id,
    "shot_02",
    legacy.id,
  ));
  const untrustedError = await rejectedMessage(() => repository.selectVideoShotArtifact(
    project.id,
    source.id,
    "shot_03",
    untrusted.id,
  ));
  expect([crossShotError, crossSourceError, legacyError, untrustedError]).toEqual([
    expect.stringContaining("binding is invalid"),
    expect.stringContaining("binding is invalid"),
    expect.stringContaining("binding is invalid"),
    expect.stringContaining("binding is invalid"),
  ]);
  await expect(repository.selectVideoShotArtifact(project.id, source.id, "shot_01", correct.id))
    .resolves.toMatchObject({ selectedArtifactId: correct.id, status: "ready" });
}

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout || "VideoShot test database initialization failed.");
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  rmSync(databasePath, { force: true });
});

describe("V1 Stage 4B VideoShot persistence", () => {
  it("reconciles a complete plan through the public workbench repository", async () => {
    await expectCompletePlanReconciliation(createPrismaWorkbenchRepository(client));
  });

  it("reconciles a complete plan within the extracted video-shot repository", async () => {
    await expectCompletePlanReconciliation(createVideoShotRepository(client));
  });

  it("rejects cross-shot and cross-source clips through the public workbench repository", async () => {
    await expectSelectedArtifactBinding(createPrismaWorkbenchRepository(client));
  });

  it("rejects cross-shot and cross-source clips within the extracted video-shot repository", async () => {
    await expectSelectedArtifactBinding(createVideoShotRepository(client));
  });

  it("keeps three selected clips independent and resets only a changed shot", async () => {
    const project = await client.project.create({ data: { id: `video-project-${randomUUID()}`, title: "Video Shot", currentNodeKey: "requirement_spec" } });
    const source = await client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Storyboard", status: "approved", summary: "Storyboard", markdownContent: "# Storyboard", version: 1, isApproved: true },
    });
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client));
    const shots = [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, inputHash: inputHash(`shot-${ordinal}`) }));
    const clips = [];
    for (const [index, shot] of shots.entries()) {
      clips.push(await createBoundVideoClip({
        projectId: project.id,
        sourceArtifactId: source.id,
        shotId: shot.shotId,
        title: `Clip ${index + 1}`,
      }));
    }

    await service.upsertVideoShots(project.id, { sourceArtifactId: source.id, shots });
    for (const [index, shot] of shots.entries()) {
      await service.recordVideoShotProviderTask(project.id, source.id, shot.shotId, `provider-${index + 1}`);
      await service.selectVideoShotArtifact(project.id, source.id, shot.shotId, clips[index].id, { ffprobe: "passed" });
    }

    const initial = await service.getVideoShots(project.id, source.id);
    expect(initial.map((shot) => [shot.shotId, shot.status, shot.selectedArtifactId])).toEqual([
      ["shot_01", "ready", clips[0].id],
      ["shot_02", "ready", clips[1].id],
      ["shot_03", "ready", clips[2].id],
    ]);

    await service.upsertVideoShots(project.id, {
      sourceArtifactId: source.id,
      shots: shots.map((shot) => shot.shotId === "shot_02" ? { ...shot, inputHash: inputHash("shot-2-repair") } : shot),
    });

    const repaired = await service.getVideoShots(project.id, source.id);
    expect(repaired.map((shot) => [shot.shotId, shot.status, shot.selectedArtifactId, shot.providerTaskId])).toEqual([
      ["shot_01", "ready", clips[0].id, "provider-1"],
      ["shot_02", "planned", null, null],
      ["shot_03", "ready", clips[2].id, "provider-3"],
    ]);
  });

  it("rejects malformed plans and cross-project selected clips", async () => {
    const project = await client.project.create({ data: { id: `video-invalid-${randomUUID()}`, title: "Video invalid", currentNodeKey: "requirement_spec" } });
    const source = await client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Storyboard", status: "approved", summary: "Storyboard", markdownContent: "# Storyboard", version: 1, isApproved: true },
    });
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client));
    await expect(service.upsertVideoShots(project.id, { sourceArtifactId: source.id, shots: [] })).rejects.toThrow("VideoShot plan");
    await service.upsertVideoShots(project.id, {
      sourceArtifactId: source.id,
      shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_${ordinal}`, ordinal, inputHash: "a".repeat(64) })),
    });
    const other = await client.project.create({ data: { id: `other-${randomUUID()}`, title: "Other", currentNodeKey: "requirement_spec" } });
    const foreignClip = await client.artifact.create({
      data: { projectId: other.id, nodeKey: "video_segment_generate", kind: "video_segment_generate", title: "Foreign", status: "needs_review", summary: "clip", markdownContent: "# Clip", version: 1, isApproved: false },
    });
    await expect(service.selectVideoShotArtifact(project.id, source.id, "shot_1", foreignClip.id)).rejects.toThrow("selected artifact is invalid");
  });
});

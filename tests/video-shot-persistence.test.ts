import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "stage4-video-shot-tests");
const databasePath = path.join(stageRoot, `video-shot-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let client: PrismaClient;

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
  it("keeps three selected clips independent and resets only a changed shot", async () => {
    const project = await client.project.create({ data: { id: `video-project-${randomUUID()}`, title: "Video Shot", currentNodeKey: "requirement_spec" } });
    const source = await client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "Storyboard", status: "approved", summary: "Storyboard", markdownContent: "# Storyboard", version: 1, isApproved: true },
    });
    const clips = await Promise.all([1, 2, 3].map((ordinal) => client.artifact.create({
      data: { projectId: project.id, nodeKey: "video_segment_generate", kind: "video_segment_generate", title: `Clip ${ordinal}`, status: "needs_review", summary: "clip", markdownContent: "# Clip", version: ordinal, isApproved: false },
    })));
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client));
    const inputHash = (value: string) => createHash("sha256").update(value).digest("hex");
    const shots = [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, inputHash: inputHash(`shot-${ordinal}`) }));

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

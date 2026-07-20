import { describe, expect, it, vi } from "vitest";
import { GET as getGenerationJobsRoute } from "@/app/api/workbench/projects/[projectId]/generation-jobs/route";
import { POST as postImageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { prisma } from "@/server/db/client";
import { generateImageFromArtifact } from "@/server/image-generation/image-generation-run";
import { createWorkbenchService } from "../service";

vi.mock("@/server/image-generation/image-generation-run", () => ({
  generateImageFromArtifact: vi.fn(),
}));

const actorA = createWorkbenchActor({
  userId: "local-stage30-user-a",
  displayName: "本地教师 A",
  authMode: "local",
});

const actorB = createWorkbenchActor({
  userId: "local-stage30-user-b",
  displayName: "本地教师 B",
  authMode: "local",
});

describe("Local Real MVP M30 generation job queue", () => {
  it("keeps video generation idempotency independent for each shot unit", async () => {
    const service = createWorkbenchService(undefined, actorA);
    const project = await service.createProject({ title: "镜头任务" });
    const source = await service.saveArtifact(project.id, {
      nodeKey: "video_segment_plan", kind: "video_segment_plan", title: "分镜计划", status: "approved", summary: "已确认", markdownContent: "# 分镜", structuredContent: {},
    });
    const first = await service.createGenerationJob(project.id, { kind: "video", sourceArtifactId: source.id, capabilityId: "video_segment_generate", unitId: "shot_01" });
    const second = await service.createGenerationJob(project.id, { kind: "video", sourceArtifactId: source.id, capabilityId: "video_segment_generate", unitId: "shot_02" });

    expect(first.id).not.toBe(second.id);
    expect(first.unitId).toBe("shot_01");
    expect(second.unitId).toBe("shot_02");
  });

  it("persists generation job state transitions and restores them in snapshots", async () => {
    const service = createWorkbenchService(undefined, actorA);
    const project = await service.createProject({ title: "M30 generation job state" });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "用于创建任务。",
      markdownContent: "第 1 页：百分数导入。",
    });

    const queued = await service.createGenerationJob(project.id, {
      kind: "image",
      sourceArtifactId: sourceArtifact.id,
      maxAttempts: 2,
    });
    expect(queued).toMatchObject({
      projectId: project.id,
      sourceArtifactId: sourceArtifact.id,
      kind: "image",
      status: "queued",
      attempts: 0,
      maxAttempts: 2,
      resultArtifactId: null,
      errorMessage: null,
    });

    const running = await service.startGenerationJob(project.id, queued.id);
    expect(running.status).toBe("running");
    expect(running.attempts).toBe(1);
    expect(running.startedAt).not.toBeNull();

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.generationJobs).toHaveLength(1);
    expect(snapshot.generationJobs[0]).toMatchObject({
      id: queued.id,
      status: "running",
      resultArtifactId: null,
    });
  });

  it("records failed jobs and prevents another actor from reading project jobs", async () => {
    const serviceA = createWorkbenchService(undefined, actorA);
    const serviceB = createWorkbenchService(undefined, actorB);
    const project = await serviceA.createProject({ title: "M30 failed job state" });
    const sourceArtifact = await serviceA.saveArtifact(project.id, {
      nodeKey: "intro_video_plan",
      kind: "intro_video_plan",
      title: "导入视频方案",
      status: "needs_review",
      summary: "用于创建失败任务。",
      markdownContent: "导入视频方案正文。",
    });

    const queued = await serviceA.createGenerationJob(project.id, {
      kind: "video",
      sourceArtifactId: sourceArtifact.id,
      maxAttempts: 3,
    });
    await serviceA.startGenerationJob(project.id, queued.id);
    const failed = await serviceA.failGenerationJob(project.id, queued.id, {
      errorMessage: "provider timeout",
    });

    expect(failed).toMatchObject({
      status: "failed",
      attempts: 1,
      errorMessage: "provider timeout",
    });
    await expect(serviceB.getGenerationJobs(project.id)).rejects.toThrow(/Project not found|access denied/i);
  });

  it("returns job state from real-generation routes and recovery route", async () => {
    vi.mocked(generateImageFromArtifact).mockResolvedValueOnce({
      fileName: "percentage-intro.png",
      localOutput: ".tmp/image-artifacts/percentage-intro.png",
      bytes: 1024,
      sha256: "d".repeat(64),
      imageValid: true,
      mime: "image/png",
      provider: "model_gateway",
      model: "image-2",
      width: 1920,
      height: 1080,
      promptDigest: "f".repeat(64),
      rawAsset: {
        fileName: "percentage-intro-raw.png",
        localOutput: ".tmp/image-artifacts/percentage-intro-raw.png",
        bytes: 1024,
        sha256: "a".repeat(64),
        mime: "image/png",
      },
      normalizedAsset: {
        fileName: "percentage-intro.png",
        localOutput: ".tmp/image-artifacts/percentage-intro.png",
        bytes: 1024,
        sha256: "d".repeat(64),
        mime: "image/png",
        width: 1920,
        height: 1080,
      },
    });

    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M30 route success job" });
    await activateRouteTask(project, `message:${project.id}:route-success`);
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "用于生成图片。",
      markdownContent: "第 1 页：百分数导入。",
    });
    await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({ projectId: project.id, capabilityId: "image_asset", messageId: sourceArtifact.id });

    const response = await postImageRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify({ confirmedActionId }) }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.artifact.title).toContain("真实课堂视觉图");
    expect(body.job).toMatchObject({
      projectId: project.id,
      sourceArtifactId: sourceArtifact.id,
      kind: "image",
      status: "succeeded",
      resultArtifactId: body.artifact.id,
    });

    const jobsResponse = await getGenerationJobsRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const jobsBody = await jobsResponse.json();
    expect(jobsResponse.status).toBe(200);
    expect(jobsBody.generationJobs.map((job: { id: string }) => job.id)).toContain(body.job.id);
  });

  it("keeps failed generation job state when provider execution fails", async () => {
    vi.mocked(generateImageFromArtifact).mockRejectedValueOnce(new Error("provider exploded with private details"));

    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M30 route failed job" });
    await activateRouteTask(project, `message:${project.id}:route-failure`);
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "用于生成失败图片。",
      markdownContent: "第 1 页：百分数导入。",
    });
    await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({ projectId: project.id, capabilityId: "image_asset", messageId: sourceArtifact.id });

    const response = await postImageRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify({ confirmedActionId }) }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    const body = await response.json();
    const jobs = await service.getGenerationJobs(project.id);

    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).not.toContain("provider exploded");
    expect(jobs.at(-1)).toMatchObject({
      kind: "image",
      sourceArtifactId: sourceArtifact.id,
      status: "failed",
      attempts: 1,
    });
    expect(jobs.at(-1)?.errorMessage).toBe("课堂视觉图生成服务暂时没有完成这一步，可以稍后重试。");
  });
});

async function activateRouteTask(
  project: Awaited<ReturnType<ReturnType<typeof createWorkbenchService>["createProject"]>>,
  sourceMessageId: string,
) {
  const taskBrief = createTaskBrief({
    taskId: `task:${project.id}`,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: "根据已确认大纲生成课堂视觉图",
    requestedOutputs: ["image"],
    constraints: ["offline_fixture_only"],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "offline-fixture.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 1,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await createControlPlaneStore().upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${project.id}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  await prisma.conversationTurnJob.create({
    data: {
      projectId: project.id,
      teacherMessageId: taskBrief.sourceMessageId,
      status: "running",
      actorUserId: "local-test-user",
      actorAuthMode: "local",
    },
  });
}

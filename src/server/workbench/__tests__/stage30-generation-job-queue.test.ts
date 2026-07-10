import { describe, expect, it, vi } from "vitest";
import { GET as getGenerationJobsRoute } from "@/app/api/workbench/projects/[projectId]/generation-jobs/route";
import { POST as postImageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createHumanGateActionId } from "@/server/guards/human-gate";
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

    const resultArtifact = await service.saveArtifact(project.id, {
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "真实课堂视觉图",
      status: "needs_review",
      summary: "已生成图片。",
      markdownContent: "# 已生成图片",
    });
    const succeeded = await service.finishGenerationJob(project.id, queued.id, {
      resultArtifactId: resultArtifact.id,
    });
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.resultArtifactId).toBe(resultArtifact.id);
    expect(succeeded.finishedAt).not.toBeNull();

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.generationJobs).toHaveLength(1);
    expect(snapshot.generationJobs[0]).toMatchObject({
      id: queued.id,
      status: "succeeded",
      resultArtifactId: resultArtifact.id,
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
      sha256: "fake-image-sha256",
      imageValid: true,
      mime: "image/png",
    });

    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M30 route success job" });
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

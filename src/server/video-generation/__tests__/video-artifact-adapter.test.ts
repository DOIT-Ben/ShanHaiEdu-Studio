import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postVideoRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route";
import { createWorkbenchService } from "@/server/workbench/service";

vi.mock("@/server/video-generation/video-generation-run", async () => {
  const actual = await vi.importActual<typeof import("@/server/video-generation/video-generation-run")>("@/server/video-generation/video-generation-run");
  return {
    ...actual,
    generateVideoFromArtifact: vi.fn(),
  };
});

import { generateVideoFromArtifact } from "@/server/video-generation/video-generation-run";

describe("Local Real MVP M21 video artifact adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a generated video segment artifact only after storyboard and asset-image preconditions", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "M21 video artifact adapter",
      grade: "六年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      title: "分镜视频片段计划",
      status: "needs_review",
      summary: "用于生成真实分镜视频片段的计划。",
      markdownContent: "S1：超市折扣中的百分数悬念，目标 8 秒，参考图 1-3。",
      structuredContent: { 课程锚点: "百分数" },
    });
    const storyboard = await service.saveArtifact(project.id, {
      nodeKey: "storyboard_generate",
      kind: "storyboard_generate",
      title: "视频分镜",
      status: "needs_review",
      summary: "已拆分分镜。",
      markdownContent: "S1 分镜：冷启动钩子。",
    });
    const assetImages = await service.saveArtifact(project.id, {
      nodeKey: "asset_image_generate",
      kind: "asset_image_generate",
      title: "视频资产图",
      status: "needs_review",
      summary: "已生成资产图。",
      markdownContent: "参考图：scene-1.png。",
    });
    await service.approveArtifact(project.id, sourceArtifact.id);
    await service.approveArtifact(project.id, storyboard.id);
    await service.approveArtifact(project.id, assetImages.id);

    vi.mocked(generateVideoFromArtifact).mockResolvedValueOnce({
      fileName: "percentage-intro.mp4",
      localOutput: ".tmp/video-artifacts/percentage-intro.mp4",
      bytes: 2048,
      sha256: "fake-video-sha256",
      videoValid: true,
      mime: "video/mp4",
    });

    const response = await postVideoRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.title).toContain("真实分镜视频片段");
    expect(body.artifact.structuredContent.storage.videoAsset.localOutput).toBe(".tmp/video-artifacts/percentage-intro.mp4");
    expect(body.artifact.structuredContent.storage.videoAsset.mime).toBe("video/mp4");
    expect(body.artifact.structuredContent.storage.videoAsset.generationMode).toBe("video_generated");
    expect(body.artifact.structuredContent.storage.videoAsset.sourceArtifactId).toBe(sourceArtifact.id);
    expect(JSON.stringify(body)).not.toContain("Bearer ");
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/.+/i);
    expect(JSON.stringify(body)).not.toMatch(/task[_-]?id/i);
  });

  it("refuses to generate video without a video segment plan and upstream artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M21 non video guard" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "公开课教案",
      status: "needs_review",
      summary: "不能直接生成导入视频。",
      markdownContent: "教案正文。",
    });

    const response = await postVideoRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
    expect(generateVideoFromArtifact).not.toHaveBeenCalled();
  });

  it("refuses to generate video until the source segment plan is approved", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M60 approved source plan guard" });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      title: "分镜视频片段计划",
      status: "needs_review",
      summary: "尚未确认的片段计划。",
      markdownContent: "S1：未确认计划。",
    });
    const storyboard = await service.saveArtifact(project.id, {
      nodeKey: "storyboard_generate",
      kind: "storyboard_generate",
      title: "视频分镜",
      status: "needs_review",
      summary: "已拆分分镜。",
      markdownContent: "S1 分镜：冷启动钩子。",
    });
    const assetImages = await service.saveArtifact(project.id, {
      nodeKey: "asset_image_generate",
      kind: "asset_image_generate",
      title: "视频资产图",
      status: "needs_review",
      summary: "已生成资产图。",
      markdownContent: "参考图：scene-1.png。",
    });
    await service.approveArtifact(project.id, storyboard.id);
    await service.approveArtifact(project.id, assetImages.id);

    const response = await postVideoRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    expect(response.status).toBe(400);
    expect(generateVideoFromArtifact).not.toHaveBeenCalled();
  });
});

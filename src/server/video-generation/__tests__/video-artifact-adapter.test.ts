import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postVideoRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route";
import { createWorkbenchService } from "@/server/workbench/service";

vi.mock("@/server/video-generation/video-generation-run", () => ({
  generateVideoFromArtifact: vi.fn(),
}));

import { generateVideoFromArtifact } from "@/server/video-generation/video-generation-run";

describe("Local Real MVP M21 video artifact adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a generated intro video artifact for an intro video plan", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "M21 video artifact adapter",
      grade: "六年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "intro_video_plan",
      kind: "intro_video_plan",
      title: "导入视频方案",
      status: "needs_review",
      summary: "用于生成真实导入视频的方案。",
      markdownContent: "独立短片主题：超市折扣中的百分数悬念。",
      structuredContent: { 课程锚点: "百分数" },
    });

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
    expect(body.artifact.title).toContain("真实导入视频");
    expect(body.artifact.structuredContent.storage.videoAsset.localOutput).toBe(".tmp/video-artifacts/percentage-intro.mp4");
    expect(body.artifact.structuredContent.storage.videoAsset.mime).toBe("video/mp4");
    expect(body.artifact.structuredContent.storage.videoAsset.generationMode).toBe("video_generated");
    expect(body.artifact.structuredContent.storage.videoAsset.sourceArtifactId).toBe(sourceArtifact.id);
    expect(JSON.stringify(body)).not.toContain("Bearer ");
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/.+/i);
    expect(JSON.stringify(body)).not.toMatch(/task[_-]?id/i);
  });

  it("refuses to generate an intro video for non-video-plan artifacts", async () => {
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
});

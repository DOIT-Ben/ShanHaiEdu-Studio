import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postImageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { createWorkbenchService } from "@/server/workbench/service";

vi.mock("@/server/image-generation/image-generation-run", () => ({
  generateImageFromArtifact: vi.fn(),
}));

import { generateImageFromArtifact } from "@/server/image-generation/image-generation-run";

describe("Local Real MVP M19 image artifact adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a generated classroom image artifact for a PPT draft", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "M19 image artifact adapter",
      grade: "六年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲与逐页脚本",
      status: "needs_review",
      summary: "用于生成课堂视觉图的大纲。",
      markdownContent: "第 1 页：百分数导入。",
      structuredContent: { 页面结构: "1 页" },
    });

    vi.mocked(generateImageFromArtifact).mockResolvedValueOnce({
      fileName: "percentage-intro.png",
      localOutput: ".tmp/image-artifacts/percentage-intro.png",
      bytes: 1024,
      sha256: "fake-image-sha256",
      imageValid: true,
      mime: "image/png",
    });

    const response = await postImageRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.title).toContain("真实课堂视觉图");
    expect(body.artifact.structuredContent.storage.imageAsset.localOutput).toBe(".tmp/image-artifacts/percentage-intro.png");
    expect(body.artifact.structuredContent.storage.imageAsset.mime).toBe("image/png");
    expect(body.artifact.structuredContent.storage.imageAsset.sourceArtifactId).toBe(sourceArtifact.id);
    expect(JSON.stringify(body)).not.toContain("Bearer ");
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/.+/i);
  });

  it("refuses to generate a classroom image for non-PPT artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M19 non PPT guard" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "公开课教案",
      status: "needs_review",
      summary: "不能直接生成课堂视觉图。",
      markdownContent: "教案正文。",
    });

    const response = await postImageRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
    expect(generateImageFromArtifact).not.toHaveBeenCalled();
  });
});

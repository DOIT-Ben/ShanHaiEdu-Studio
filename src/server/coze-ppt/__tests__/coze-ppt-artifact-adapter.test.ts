import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPptxRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/pptx/route";
import { POST as postCozePptRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route";
import { createWorkbenchService } from "@/server/workbench/service";

vi.mock("@/server/coze-ppt/coze-ppt-run", async () => {
  const actual = await vi.importActual<typeof import("@/server/coze-ppt/coze-ppt-run")>("@/server/coze-ppt/coze-ppt-run");
  return {
    ...actual,
    generateCozePptFromArtifact: vi.fn(),
  };
});

import { generateCozePptFromArtifact } from "@/server/coze-ppt/coze-ppt-run";

describe("Local Real MVP M17 Coze PPT artifact adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a Coze-generated PPTX artifact and downloads the stored PPTX", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({
      title: "M17 Coze PPT artifact adapter",
      grade: "六年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲与逐页脚本",
      status: "needs_review",
      summary: "用于生成真实 Coze PPTX 的大纲。",
      markdownContent: "第 1 页：百分数导入。",
      structuredContent: { 页面结构: "1 页" },
    });
    const pptxBuffer = await buildTinyPptx();
    const outputPath = writeFixturePptx(pptxBuffer);

    vi.mocked(generateCozePptFromArtifact).mockResolvedValueOnce({
      fileName: "coze-real.pptx",
      localOutput: outputPath,
      bytes: pptxBuffer.length,
      sha256: "fake-sha256",
      pptxValid: true,
      hasPresentationXml: true,
    });

    const response = await postCozePptRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.title).toContain("真实 PPTX");
    expect(body.artifact.structuredContent.storage.cozePptx.localOutput).toBe(outputPath);
    expect(JSON.stringify(body)).not.toContain("Bearer ");
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/.+pptx/i);

    const downloadResponse = await getPptxRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: body.artifact.id }),
    });
    expect(downloadResponse.status).toBe(200);
    const downloaded = Buffer.from(await downloadResponse.arrayBuffer());
    expect(downloaded.equals(pptxBuffer)).toBe(true);
  });

  it("refuses to generate Coze PPTX for non-PPT artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M17 non PPT guard" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "公开课教案",
      status: "needs_review",
      summary: "不能直接生成 Coze PPT。",
      markdownContent: "教案正文。",
    });

    const response = await postCozePptRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
    expect(generateCozePptFromArtifact).not.toHaveBeenCalled();
  });
});

async function buildTinyPptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types />");
  zip.file("ppt/presentation.xml", "<presentation />");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function writeFixturePptx(buffer: Buffer) {
  const dir = path.join(process.cwd(), ".tmp", "m17-test");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "coze-real.pptx");
  writeFileSync(filePath, buffer);
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

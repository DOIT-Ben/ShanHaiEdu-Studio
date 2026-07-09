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

import { extractCozePptResult, generateCozePptFromArtifact, resolvePptDesignPageCount, validatePptxBuffer } from "@/server/coze-ppt/coze-ppt-run";

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
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "逐页四层 PPT 设计稿",
      status: "needs_review",
      summary: "用于生成真实 Coze PPTX 的逐页四层设计稿。",
      markdownContent: "第 1 页：底图：纯白课堂场景；元素：问题气泡；文字：百分数导入；排版：左文右图。",
      structuredContent: { 页面结构: "1 页", 四层设计: "底图、元素、文字、排版" },
    });
    const pptxBuffer = await buildTinyPptx();
    const outputPath = writeFixturePptx(pptxBuffer);

    vi.mocked(generateCozePptFromArtifact).mockResolvedValueOnce({
      fileName: "coze-real.pptx",
      localOutput: outputPath,
      bytes: pptxBuffer.length,
      sha256: "fake-sha256",
      requestedPageCount: 1,
      slideCount: 1,
      pptxValid: true,
      hasPresentationXml: true,
    });

    const response = await postCozePptRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.title).toContain("真实 1 页 PPTX");
    expect(body.artifact.structuredContent.实际页数).toBe("1 页");
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

  it("extracts the answer message before OpenAPI follow-up suggestions", () => {
    const result = extractCozePptResult({
      data: [
        {
          role: "assistant",
          type: "answer",
          content: JSON.stringify({ status: "completed", pptx_url: "https://example.test/result.pptx", file_name: "ten-pages.pptx" }),
        },
        { role: "assistant", type: "verbose", content: JSON.stringify({ msg_type: "generate_answer_finish" }) },
        { role: "assistant", type: "follow_up", content: "要不要继续修改？" },
      ],
    });

    expect(result.fileName).toBe("ten-pages.pptx");
    expect(result.pptxUrl).toBe("https://example.test/result.pptx");
  });

  it("reads requested page count from page ranges and validates actual slide count", async () => {
    const markdown = [
      "## 页面清单",
      "- 第 1 页：课题与生活情境开场。",
      "- 第 2-3 页：观察问题与学生猜想。",
      "- 第 4-8 页：概念探究、例题拆解、板书同步。",
      "- 第 9-12 页：练习巩固、课堂总结、迁移延伸。",
      "",
      "## 第 1 页四层设计",
      "## 第 2 页四层设计",
    ].join("\n");

    expect(resolvePptDesignPageCount(markdown)).toBe(12);

    const pptxBuffer = await buildTinyPptx(2);
    const validation = await validatePptxBuffer(pptxBuffer);

    expect(validation.valid).toBe(true);
    expect(validation.slideCount).toBe(2);
  });
});

async function buildTinyPptx(slideCount = 1) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types />");
  zip.file("ppt/presentation.xml", "<presentation />");
  for (let index = 1; index <= slideCount; index += 1) {
    zip.file(`ppt/slides/slide${index}.xml`, `<slide>${index}</slide>`);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

function writeFixturePptx(buffer: Buffer) {
  const dir = path.join(process.cwd(), ".tmp", "m17-test");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "coze-real.pptx");
  writeFileSync(filePath, buffer);
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

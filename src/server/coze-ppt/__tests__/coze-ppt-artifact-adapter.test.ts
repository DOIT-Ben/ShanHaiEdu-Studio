import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPptxRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/pptx/route";
import { POST as postCozePptRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route";
import { createWorkbenchService } from "@/server/workbench/service";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { withPassedValidationReport } from "../../../../tests/support/validation-report";

vi.mock("@/server/tools/tool-router", () => ({
  routeToolCall: vi.fn(),
}));

vi.mock("@/server/coze-ppt/coze-ppt-run", async () => {
  const actual = await vi.importActual<typeof import("@/server/coze-ppt/coze-ppt-run")>("@/server/coze-ppt/coze-ppt-run");
  return {
    ...actual,
    generateCozePptFromArtifact: vi.fn(),
  };
});

import { extractCozePptResult, generateCozePptFromArtifact, resolvePptDesignPageCount, validatePptxBuffer } from "@/server/coze-ppt/coze-ppt-run";
import { routeToolCall } from "@/server/tools/tool-router";

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
    await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "coze_ppt",
      messageId: sourceArtifact.id,
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
    vi.mocked(routeToolCall).mockImplementationOnce(async (input) => withPassedValidationReport(input, {
      status: "succeeded",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactTruth: {
        created: true,
        persisted: true,
        placeholder: false,
        producedArtifactKind: "pptx_artifact",
      },
      qualityGate: {
        passed: true,
        gates: ["pptx_valid", "slide_count_matches"],
      },
      artifactDraft: {
        nodeKey: "pptx_artifact",
        kind: "pptx_artifact",
        title: "真实 1 页 PPTX 文件",
        summary: "已生成可下载的真实 1 页 PPTX 文件，请下载后核对页面内容。",
        markdownContent: "# 真实 1 页 PPTX 文件",
        structuredContent: {
          storage: {
            cozePptx: {
              localOutput: outputPath,
              fileName: "coze-real.pptx",
              bytes: pptxBuffer.length,
              sha256: "fake-sha256",
              slideCount: 1,
              requestedPageCount: 1,
              generationMode: "coze_generated",
              sourceArtifactId: sourceArtifact.id,
            },
          },
          实际页数: "1 页",
          目标页数: "1 页",
        },
      },
      assistantSummary: "真实 PPTX 已生成并通过基础校验：1 页。",
      budgetEvent: {
        capabilityId: "coze_ppt",
        actionKey: "generate_pptx_from_design:pptx_artifact",
        status: "succeeded",
        kind: "tool_succeeded",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    }, { stage: "coze_ppt", domain: "ppt", toolId: "generate_pptx_from_design" }));

    const response = await postCozePptRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(routeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "coze_ppt",
      projectId: project.id,
      project: expect.objectContaining({ id: project.id }),
      artifactRefs: [expect.objectContaining({
        kind: "ppt_design_draft",
        artifactId: sourceArtifact.id,
      })],
    }));
    expect(generateCozePptFromArtifact).not.toHaveBeenCalled();
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

  it.each([
    {
      label: "artifact truth and quality gate are missing",
      proof: {},
    },
    {
      label: "quality gate reports failure",
      proof: {
        artifactTruth: {
          created: true,
          persisted: true,
          placeholder: false,
          producedArtifactKind: "pptx_artifact",
        },
        qualityGate: {
          passed: false,
          gates: ["slide_count_matches"],
        },
      },
    },
  ])("does not save a PPTX artifact when provider success proof is invalid: $label", async ({ proof }) => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "PPTX provider truth gate" });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "逐页四层 PPT 设计稿",
      status: "needs_review",
      summary: "用于验证 PPTX provider 成功证明门禁。",
      markdownContent: "第 1 页：底图、元素、文字、排版。",
    });
    await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "coze_ppt",
      messageId: sourceArtifact.id,
    });
    vi.mocked(routeToolCall).mockResolvedValueOnce({
      status: "succeeded",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactDraft: {
        nodeKey: "pptx_artifact",
        kind: "pptx_artifact",
        title: "不应保存的 PPTX",
        summary: "provider 声称成功，但成功证明不完整。",
        markdownContent: "# 不应保存的 PPTX",
        structuredContent: {},
      },
      assistantSummary: "provider 声称 PPTX 已生成。",
      budgetEvent: {
        capabilityId: "coze_ppt",
        actionKey: "generate_pptx_from_design:pptx_artifact",
        status: "succeeded",
        kind: "tool_succeeded",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      ...proof,
    });

    const response = await postCozePptRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "pptx_artifact" }),
    ]));
    expect(snapshot.generationJobs).toEqual([
      expect.objectContaining({
        kind: "pptx",
        sourceArtifactId: sourceArtifact.id,
        status: "failed",
        resultArtifactId: null,
      }),
    ]);
    expect(response.status).not.toBe(200);
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

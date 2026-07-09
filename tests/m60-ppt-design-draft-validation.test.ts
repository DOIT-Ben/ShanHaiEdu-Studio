import { describe, expect, it } from "vitest";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { generateCozePptFromArtifact, validatePptDesignDraftForCoze } from "@/server/coze-ppt/coze-ppt-run";

function pageDesign(page: number) {
  return [
    `## 第 ${page} 页四层设计`,
    "- 底图：纯白课堂课件底色，保留教师讲解空间。",
    "- 元素：问题气泡、数量关系线、学生回答框。",
    "- 文字：一个主问题和两条可替换提示语。",
    "- 排版：左侧问题，右侧材料，下方保留学生操作区。",
  ].join("\n");
}

describe("M60 PPT 设计稿逐页门禁", () => {
  it.each([
    "第 4-8 页：概念探究、例题拆解、板书同步。",
    "第 9-12 页：练习巩固、课堂总结、迁移延伸。",
    "第 3-12 页四层延展规则",
  ])("拒绝范围合并页：%s", (rangeLine) => {
    const result = validatePptDesignDraftForCoze([
      "# 逐页四层 PPT 设计稿",
      "页数：12 页",
      rangeLine,
      pageDesign(1),
      pageDesign(2),
    ].join("\n\n"));

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("expected merged page ranges to be rejected");
    expect(result.reason).toBe("range_merged_pages");
    expect(result.message).toContain("PPT 设计稿未逐页完整");
    expect(result.mergedPageReferences).toContain(rangeLine.match(/第\s*\d+\s*[-—~至到]\s*\d+\s*页/)?.[0]);
  });

  it("接受逐页四层完整设计稿", () => {
    const markdown = [
      "# 逐页四层 PPT 设计稿",
      "页数：12 页",
      ...Array.from({ length: 12 }, (_, index) => pageDesign(index + 1)),
    ].join("\n\n");

    const result = validatePptDesignDraftForCoze(markdown);

    expect(result).toMatchObject({ valid: true, pageCount: 12 });
  });

  it("deterministic runtime 生成的 PPT 设计稿通过逐页四层门禁", async () => {
    const result = await new DeterministicRuntime().run({
      projectId: "project-m60-ppt-design",
      runId: "run-m60-ppt-design",
      task: "ppt_design",
      userMessage: "生成 12 页逐页 PPT 设计稿",
      projectContext: {
        grade: "六年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["PPT"],
      },
      approvedArtifacts: [],
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;

    const validation = validatePptDesignDraftForCoze(result.artifactDraft.markdown);
    expect(validation).toMatchObject({ valid: true, pageCount: 12 });
  });

  it("Coze PPTX 生成前先阻断范围合并页设计稿", async () => {
    const project = {
      id: "project-m60-coze-gate",
      title: "M60 Coze gate",
      status: "active",
      currentNodeKey: "ppt_design_draft",
      grade: "六年级",
      subject: "数学",
      textbookVersion: null,
      lessonTopic: "百分数",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const;
    const artifact = {
      id: "artifact-merged-pages",
      projectId: project.id,
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "合并页 PPT 设计稿",
      status: "needs_review",
      summary: "包含范围合并页",
      markdownContent: [
        "# 逐页四层 PPT 设计稿",
        "页数：12 页",
        "第 4-8 页：概念探究、例题拆解、板书同步。",
        pageDesign(1),
        pageDesign(2),
      ].join("\n\n"),
      structuredContent: {},
      version: 1,
      isApproved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const;

    await expect(generateCozePptFromArtifact({ project, artifact })).rejects.toThrow("PPT 设计稿未逐页完整");
  });
});

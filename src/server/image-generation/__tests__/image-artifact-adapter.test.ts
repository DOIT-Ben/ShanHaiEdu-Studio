import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postImageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { createWorkbenchService } from "@/server/workbench/service";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { withPassedValidationReport } from "../../../../tests/support/validation-report";

vi.mock("@/server/tools/tool-router", () => ({
  routeToolCall: vi.fn(),
}));

import { routeToolCall } from "@/server/tools/tool-router";

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
    const approvedSourceArtifact = await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "image_asset",
      messageId: sourceArtifact.id,
    });

    vi.mocked(routeToolCall).mockImplementationOnce(async (input) => withPassedValidationReport(input, {
      status: "succeeded",
      toolId: "generate_classroom_image",
      capabilityId: "image_asset",
      provider: "image_asset",
      artifactTruth: {
        created: true,
        persisted: true,
        placeholder: false,
        producedArtifactKind: "image_prompts",
      },
      qualityGate: {
        passed: true,
        gates: ["image_valid", "supported_image_mime"],
      },
      artifactDraft: {
        nodeKey: "image_prompts",
        kind: "image_prompts",
        title: "真实课堂视觉图",
        summary: "已生成一张可用于课件导入页的本地课堂视觉图。",
        markdownContent: "# 真实课堂视觉图",
        structuredContent: {
          storage: {
            imageAsset: {
              localOutput: ".tmp/image-artifacts/percentage-intro.png",
              fileName: "percentage-intro.png",
              bytes: 1024,
              sha256: "fake-image-sha256",
              mime: "image/png",
              generationMode: "image_generated",
              sourceArtifactId: sourceArtifact.id,
            },
          },
        },
      },
      assistantSummary: "课堂视觉图已生成。",
      budgetEvent: {
        capabilityId: "image_asset",
        actionKey: "generate_classroom_image:image_prompts",
        status: "succeeded",
        kind: "tool_succeeded",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    }, { stage: "image_asset", domain: "ppt", toolId: "generate_classroom_image" }));

    const response = await postImageRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(routeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: "image_asset",
      projectId: project.id,
      project,
      artifactRefs: [{
        kind: "ppt_draft",
        artifactId: approvedSourceArtifact.id,
        title: approvedSourceArtifact.title,
        summary: approvedSourceArtifact.summary,
        markdownContent: approvedSourceArtifact.markdownContent,
        structuredContent: approvedSourceArtifact.structuredContent,
      }],
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.title).toContain("真实课堂视觉图");
    expect(body.artifact.structuredContent.storage.imageAsset.localOutput).toBe(".tmp/image-artifacts/percentage-intro.png");
    expect(body.artifact.structuredContent.storage.imageAsset.mime).toBe("image/png");
    expect(body.artifact.structuredContent.storage.imageAsset.sourceArtifactId).toBe(sourceArtifact.id);
    expect(body.job).toMatchObject({
      status: "succeeded",
      sourceArtifactId: sourceArtifact.id,
      resultArtifactId: body.artifact.id,
    });
    expect(JSON.stringify(body)).not.toContain("Bearer ");
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/.+/i);
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
          producedArtifactKind: "image_prompts",
        },
        qualityGate: {
          passed: false,
          gates: ["image_valid"],
        },
      },
    },
  ])("does not save an image artifact when provider success proof is invalid: $label", async ({ proof }) => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Image provider truth gate" });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲与逐页脚本",
      status: "needs_review",
      summary: "用于验证图片 provider 成功证明门禁。",
      markdownContent: "第 1 页：百分数导入。",
    });
    await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "image_asset",
      messageId: sourceArtifact.id,
    });
    vi.mocked(routeToolCall).mockResolvedValueOnce({
      status: "succeeded",
      toolId: "generate_classroom_image",
      capabilityId: "image_asset",
      artifactDraft: {
        nodeKey: "image_prompts",
        kind: "image_prompts",
        title: "不应保存的课堂视觉图",
        summary: "provider 声称成功，但成功证明不完整。",
        markdownContent: "# 不应保存的课堂视觉图",
        structuredContent: {},
      },
      assistantSummary: "provider 声称课堂视觉图已生成。",
      budgetEvent: {
        capabilityId: "image_asset",
        actionKey: "generate_classroom_image:image_prompts",
        status: "succeeded",
        kind: "tool_succeeded",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      ...proof,
    });

    const response = await postImageRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "image_prompts" }),
    ]));
    expect(snapshot.generationJobs).toEqual([
      expect.objectContaining({
        kind: "image",
        sourceArtifactId: sourceArtifact.id,
        status: "failed",
        resultArtifactId: null,
      }),
    ]);
    expect(response.status).not.toBe(200);
  });

  it("does not save an image artifact and fails the job when ToolRouter fails", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M64-R image ToolRouter failure" });
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲与逐页脚本",
      status: "needs_review",
      summary: "用于生成课堂视觉图的大纲。",
      markdownContent: "第 1 页：百分数导入。",
    });
    await service.approveArtifact(project.id, sourceArtifact.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "image_asset",
      messageId: sourceArtifact.id,
    });
    vi.mocked(routeToolCall).mockResolvedValueOnce({
      status: "failed",
      toolId: "generate_classroom_image",
      capabilityId: "image_asset",
      artifactCreated: false,
      errorCategory: "provider_unavailable",
      observation: {
        observationId: "image-observation",
        projectId: project.id,
        capabilityId: "image_asset",
        expectedArtifactKind: "image_prompts",
        kind: "provider_unavailable",
        status: "active",
        teacherSafeSummary: "课堂视觉图暂时没有生成成功，请稍后再试。",
        internalReasonSanitized: "Image provider unavailable.",
        retryPolicy: { retryable: true, nextAction: "wait_for_provider" },
        artifactCreated: false,
        dedupeKey: `${project.id}:image_asset:provider_unavailable:image_prompts`,
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      budgetEvent: {
        capabilityId: "image_asset",
        actionKey: "generate_classroom_image:image_prompts",
        status: "failed",
        kind: "provider_unavailable",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    });

    const response = await postImageRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    expect(response.status).toBe(400);
    expect(routeToolCall).toHaveBeenCalledTimes(1);
    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "image_prompts" }),
    ]));
    expect(snapshot.generationJobs).toEqual([
      expect.objectContaining({
        kind: "image",
        sourceArtifactId: sourceArtifact.id,
        status: "failed",
        resultArtifactId: null,
      }),
    ]);
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
    expect(routeToolCall).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postVideoRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route";
import { createWorkbenchService } from "@/server/workbench/service";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { seedArtifactRouteTask } from "../../../../tests/support/artifact-route-task-fixture";
import { withPassedValidationReport } from "../../../../tests/support/validation-report";

vi.mock("@/server/tools/tool-router", () => ({
  routeToolCall: vi.fn(),
}));

import { routeToolCall } from "@/server/tools/tool-router";

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
    const { taskBrief } = await seedArtifactRouteTask(project, ["video_shot"]);
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
    const approvedSourceArtifact = await service.approveArtifact(project.id, sourceArtifact.id);
    const approvedStoryboard = await service.approveArtifact(project.id, storyboard.id);
    const approvedAssetImages = await service.approveArtifact(project.id, assetImages.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "video_segment_generate",
      messageId: sourceArtifact.id,
    });

    vi.mocked(routeToolCall).mockImplementationOnce(async (input) => withPassedValidationReport(input, {
      status: "succeeded",
      toolId: "generate_video_segment",
      capabilityId: "video_segment_generate",
      provider: "video_segment_generate",
      artifactTruth: {
        created: true,
        persisted: true,
        placeholder: false,
        producedArtifactKind: "video_segment_generate",
      },
      qualityGate: {
        passed: true,
        gates: ["video_valid", "mp4_structure_valid"],
      },
      artifactDraft: {
        nodeKey: "video_segment_generate",
        kind: "video_segment_generate",
        title: "真实分镜视频片段",
        summary: "已生成一段本地分镜视频。",
        markdownContent: "# 真实分镜视频片段",
        structuredContent: {
          storage: {
            videoAsset: {
              localOutput: ".tmp/video-artifacts/percentage-intro.mp4",
              fileName: "percentage-intro.mp4",
              bytes: 2048,
              sha256: "fake-video-sha256",
              mime: "video/mp4",
              generationMode: "video_generated",
              sourceArtifactId: sourceArtifact.id,
            },
          },
        },
      },
      assistantSummary: "分镜视频片段已生成。",
      budgetEvent: {
        capabilityId: "video_segment_generate",
        actionKey: "generate_video_segment:video_segment_generate",
        status: "succeeded",
        kind: "tool_succeeded",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    }, { stage: "video_segment_generate", domain: "video", toolId: "generate_video_segment" }));

    const response = await postVideoRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    expect(routeToolCall).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "generate_video_segment",
      projectId: project.id,
      project: expect.objectContaining({ id: project.id }),
      executionEnvelope: expect.objectContaining({
        projectId: project.id,
        taskId: taskBrief.taskId,
        taskBriefDigest: taskBrief.digest,
      }),
      toolInput: expect.objectContaining({
        sourceArtifactId: sourceArtifact.id,
        taskBrief: expect.objectContaining({ taskId: taskBrief.taskId, digest: taskBrief.digest }),
      }),
      artifactRefs: [approvedSourceArtifact, approvedStoryboard, approvedAssetImages].map((artifact) => ({
        kind: artifact.kind,
        artifactId: artifact.id,
        title: artifact.title,
        summary: artifact.summary,
        markdownContent: artifact.markdownContent,
        structuredContent: artifact.structuredContent,
      })),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifact.title).toContain("真实分镜视频片段");
    expect(body.artifact.structuredContent.storage.videoAsset.localOutput).toBe(".tmp/video-artifacts/percentage-intro.mp4");
    expect(body.artifact.structuredContent.storage.videoAsset.mime).toBe("video/mp4");
    expect(body.artifact.structuredContent.storage.videoAsset.generationMode).toBe("video_generated");
    expect(body.artifact.structuredContent.storage.videoAsset.sourceArtifactId).toBe(sourceArtifact.id);
    expect(body.job).toMatchObject({
      status: "succeeded",
      sourceArtifactId: sourceArtifact.id,
      resultArtifactId: body.artifact.id,
    });
    expect(JSON.stringify(body)).not.toContain("Bearer ");
    expect(JSON.stringify(body)).not.toMatch(/https:\/\/.+/i);
    expect(JSON.stringify(body)).not.toMatch(/task[_-]?id/i);

    const repeatedResponse = await postVideoRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });
    const repeatedBody = await repeatedResponse.json();
    expect(repeatedResponse.status).toBe(200);
    expect(repeatedBody).toMatchObject({ reused: true, artifact: { id: body.artifact.id }, job: { id: body.job.id } });
    expect(routeToolCall).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(repeatedBody)).not.toMatch(/task[_-]?id/i);
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
          producedArtifactKind: "video_segment_generate",
        },
        qualityGate: {
          passed: false,
          gates: ["video_valid"],
        },
      },
    },
  ])("does not save a video artifact when provider success proof is invalid: $label", async ({ proof }) => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Video provider truth gate" });
    await seedArtifactRouteTask(project, ["video_shot"]);
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      title: "分镜视频片段计划",
      status: "needs_review",
      summary: "用于验证视频 provider 成功证明门禁。",
      markdownContent: "S1：百分数导入，目标 8 秒。",
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
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "video_segment_generate",
      messageId: sourceArtifact.id,
    });
    vi.mocked(routeToolCall).mockResolvedValueOnce({
      status: "succeeded",
      toolId: "generate_video_segment",
      capabilityId: "video_segment_generate",
      artifactDraft: {
        nodeKey: "video_segment_generate",
        kind: "video_segment_generate",
        title: "不应保存的分镜视频片段",
        summary: "provider 声称成功，但成功证明不完整。",
        markdownContent: "# 不应保存的分镜视频片段",
        structuredContent: {},
      },
      assistantSummary: "provider 声称分镜视频片段已生成。",
      budgetEvent: {
        capabilityId: "video_segment_generate",
        actionKey: "generate_video_segment:video_segment_generate",
        status: "succeeded",
        kind: "tool_succeeded",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      ...proof,
    });

    const response = await postVideoRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.artifacts).toHaveLength(3);
    expect(snapshot.artifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "video_segment_generate" }),
    ]));
    expect(snapshot.generationJobs).toEqual([
      expect.objectContaining({
        kind: "video",
        sourceArtifactId: sourceArtifact.id,
        status: "failed",
        resultArtifactId: null,
      }),
    ]);
    expect(response.status).not.toBe(200);
  });

  it("does not save a video artifact and fails the job when ToolRouter fails", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M64-R video ToolRouter failure" });
    await seedArtifactRouteTask(project, ["video_shot"]);
    const sourceArtifact = await service.saveArtifact(project.id, {
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      title: "分镜视频片段计划",
      status: "needs_review",
      summary: "用于生成真实分镜视频片段的计划。",
      markdownContent: "S1：百分数导入，目标 8 秒。",
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
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "video_segment_generate",
      messageId: sourceArtifact.id,
    });
    vi.mocked(routeToolCall).mockResolvedValueOnce({
      status: "failed",
      toolId: "generate_video_segment",
      capabilityId: "video_segment_generate",
      artifactCreated: false,
      errorCategory: "provider_unavailable",
      observation: {
        observationId: "video-observation",
        projectId: project.id,
        capabilityId: "video_segment_generate",
        expectedArtifactKind: "video_segment_generate",
        kind: "provider_unavailable",
        status: "active",
        teacherSafeSummary: "导入视频暂时没有生成成功，请稍后再试。",
        internalReasonSanitized: "Video provider unavailable.",
        retryPolicy: { retryable: true, nextAction: "wait_for_provider" },
        artifactCreated: false,
        dedupeKey: `${project.id}:video_segment_generate:provider_unavailable:video_segment_generate`,
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      budgetEvent: {
        capabilityId: "video_segment_generate",
        actionKey: "generate_video_segment:video_segment_generate",
        status: "failed",
        kind: "provider_unavailable",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
    });

    const response = await postVideoRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    expect(response.status).toBe(400);
    expect(routeToolCall).toHaveBeenCalledTimes(1);
    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.artifacts).toHaveLength(3);
    expect(snapshot.artifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "video_segment_generate" }),
    ]));
    expect(snapshot.generationJobs).toEqual([
      expect.objectContaining({
        kind: "video",
        sourceArtifactId: sourceArtifact.id,
        status: "failed",
        resultArtifactId: null,
      }),
    ]);
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
    expect(routeToolCall).not.toHaveBeenCalled();
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
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "video_segment_generate",
      messageId: sourceArtifact.id,
    });

    const response = await postVideoRoute(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ confirmedActionId }),
    }), {
      params: Promise.resolve({ projectId: project.id, artifactId: sourceArtifact.id }),
    });

    expect(response.status).toBe(400);
    expect(routeToolCall).not.toHaveBeenCalled();
  });
});

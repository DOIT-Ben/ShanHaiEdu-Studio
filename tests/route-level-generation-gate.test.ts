import { describe, expect, it } from "vitest";
import { POST as postCozePpt } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route";
import { POST as postImage } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { POST as postVideo } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import {
  assertRouteLevelGenerationConfirmation,
  readConfirmedActionId,
  RouteLevelGenerationConfirmationError,
} from "@/server/guards/route-level-generation-gate";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";

describe("route-level generation gate", () => {
  it("allows a matching server-derived action id for an approved source artifact", () => {
    const confirmedActionId = createHumanGateActionId({
      projectId: "project-1",
      capabilityId: "coze_ppt",
      messageId: "artifact-1",
    });
    const sourceArtifact = artifact({
      id: "artifact-1",
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      status: "approved",
      isApproved: true,
      structuredContent: routeActions("coze_ppt", confirmedActionId),
    });

    expect(
      assertRouteLevelGenerationConfirmation({
        projectId: "project-1",
        capabilityId: "coze_ppt",
        sourceArtifact,
        confirmedActionId,
      }),
    ).toEqual({ expectedActionId: confirmedActionId });
  });

  it("rejects missing confirmation before a route can create jobs or save artifacts", () => {
    const expectedActionId = createHumanGateActionId({ projectId: "project-1", capabilityId: "coze_ppt", messageId: "artifact-2" });
    const sourceArtifact = artifact({
      id: "artifact-2",
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      status: "approved",
      isApproved: true,
      structuredContent: routeActions("coze_ppt", expectedActionId),
    });

    expect(() =>
      assertRouteLevelGenerationConfirmation({
        projectId: "project-1",
        capabilityId: "coze_ppt",
        sourceArtifact,
      }),
    ).toThrowError(RouteLevelGenerationConfirmationError);
    try {
      assertRouteLevelGenerationConfirmation({ projectId: "project-1", capabilityId: "coze_ppt", sourceArtifact });
    } catch (error) {
      expect(error).toMatchObject({ status: 403 });
    }
  });

  it("rejects unapproved source artifacts even when a caller guesses the deterministic id", () => {
    const sourceArtifact = artifact({ id: "artifact-3", nodeKey: "ppt_design_draft", kind: "ppt_design_draft", status: "needs_review", isApproved: false });
    const confirmedActionId = createHumanGateActionId({
      projectId: "project-1",
      capabilityId: "coze_ppt",
      messageId: sourceArtifact.id,
    });

    try {
      assertRouteLevelGenerationConfirmation({
        projectId: "project-1",
        capabilityId: "coze_ppt",
        sourceArtifact,
        confirmedActionId,
      });
    } catch (error) {
      expect(error).toMatchObject({ status: 400, message: "approved_source_artifact_required" });
    }
  });

  it("rejects approved source artifacts when the route action was never issued server-side", () => {
    const sourceArtifact = artifact({ id: "artifact-4", nodeKey: "ppt_design_draft", kind: "ppt_design_draft", status: "approved", isApproved: true });
    const confirmedActionId = createHumanGateActionId({
      projectId: "project-1",
      capabilityId: "coze_ppt",
      messageId: sourceArtifact.id,
    });

    try {
      assertRouteLevelGenerationConfirmation({
        projectId: "project-1",
        capabilityId: "coze_ppt",
        sourceArtifact,
        confirmedActionId,
      });
    } catch (error) {
      expect(error).toMatchObject({ status: 403, message: "route_generation_action_not_issued" });
    }
  });

  it("accepts actionId as an alias for confirmedActionId", () => {
    expect(readConfirmedActionId({ actionId: " human:project-1:coze_ppt:artifact-1 " })).toBe("human:project-1:coze_ppt:artifact-1");
    expect(readConfirmedActionId({ confirmedActionId: "human:project-1:image_asset:artifact-2" })).toBe("human:project-1:image_asset:artifact-2");
  });

  it("blocks direct Coze PPTX POST without confirmation before saving jobs or artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "route gate coze" });
    const source = await service.saveArtifact(project.id, {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "PPT 设计稿",
      status: "needs_review",
      summary: "PPT 设计稿",
      markdownContent: "# PPT 设计稿",
    });
    await service.approveArtifact(project.id, source.id);

    const response = await postCozePpt(routePostRequest(), routeContext(project.id, source.id));
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(response.status).toBe(403);
    expect(snapshot.generationJobs).toHaveLength(0);
    expect(snapshot.artifacts).toHaveLength(1);
  });

  it("blocks direct image POST without confirmation before saving jobs or artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "route gate image" });
    const source = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "PPT 大纲",
      markdownContent: "# PPT 大纲",
    });
    await service.approveArtifact(project.id, source.id);

    const response = await postImage(routePostRequest(), routeContext(project.id, source.id));
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(response.status).toBe(403);
    expect(snapshot.generationJobs).toHaveLength(0);
    expect(snapshot.artifacts).toHaveLength(1);
  });

  it("blocks direct video POST without confirmation before saving jobs or artifacts", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "route gate video" });
    const storyboard = await service.saveArtifact(project.id, {
      nodeKey: "storyboard_generate",
      kind: "storyboard_generate",
      title: "视频分镜",
      status: "needs_review",
      summary: "视频分镜",
      markdownContent: "# 视频分镜",
    });
    const assetImages = await service.saveArtifact(project.id, {
      nodeKey: "asset_image_generate",
      kind: "asset_image_generate",
      title: "资产图",
      status: "needs_review",
      summary: "资产图",
      markdownContent: "# 资产图",
    });
    const source = await service.saveArtifact(project.id, {
      nodeKey: "video_segment_plan",
      kind: "video_segment_plan",
      title: "分镜视频计划",
      status: "needs_review",
      summary: "分镜视频计划",
      markdownContent: "# 分镜视频计划",
    });
    await service.approveArtifact(project.id, storyboard.id);
    await service.approveArtifact(project.id, assetImages.id);
    await service.approveArtifact(project.id, source.id);

    const response = await postVideo(routePostRequest(), routeContext(project.id, source.id));
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(response.status).toBe(403);
    expect(snapshot.generationJobs).toHaveLength(0);
    expect(snapshot.artifacts).toHaveLength(3);
  });

  it("saves direct image generation output as image prompts without overwriting the source PPT draft", async () => {
    const originalEnv = {
      IMAGEGEN_MYSELF_PRIMARY_API_KEY: process.env.IMAGEGEN_MYSELF_PRIMARY_API_KEY,
      IMAGEGEN_MYSELF_PRIMARY_BASE_URL: process.env.IMAGEGEN_MYSELF_PRIMARY_BASE_URL,
      IMAGEGEN_MYSELF_MODEL: process.env.IMAGEGEN_MYSELF_MODEL,
    };
    const originalFetch = globalThis.fetch;
    process.env.IMAGEGEN_MYSELF_PRIMARY_API_KEY = "test-image-key";
    process.env.IMAGEGEN_MYSELF_PRIMARY_BASE_URL = "https://image.test/v1";
    process.env.IMAGEGEN_MYSELF_MODEL = "test-image-model";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [{ b64_json: validPngBase64() }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    try {
      const service = createWorkbenchService();
      const project = await service.createProject({ title: "route gate image success" });
      const source = await service.saveArtifact(project.id, {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "PPT 大纲",
        status: "needs_review",
        summary: "PPT 大纲",
        markdownContent: "# PPT 大纲",
      });
      await service.approveArtifact(project.id, source.id);
      const confirmedActionId = createHumanGateActionId({ projectId: project.id, capabilityId: "image_asset", messageId: source.id });

      const response = await postImage(routePostRequest({ confirmedActionId }), routeContext(project.id, source.id));
      const snapshot = await service.getProjectSnapshot(project.id);
      const generated = snapshot.artifacts.find((artifact) => artifact.id !== source.id);
      const sourceAfter = snapshot.artifacts.find((artifact) => artifact.id === source.id);

      expect(response.status).toBe(200);
      expect(snapshot.generationJobs).toHaveLength(1);
      expect(sourceAfter).toMatchObject({ nodeKey: "ppt_draft", kind: "ppt_draft", status: "approved", isApproved: true });
      expect(generated).toMatchObject({ nodeKey: "image_prompts", kind: "image_prompts", status: "needs_review", isApproved: false });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("IMAGEGEN_MYSELF_PRIMARY_API_KEY", originalEnv.IMAGEGEN_MYSELF_PRIMARY_API_KEY);
      restoreEnv("IMAGEGEN_MYSELF_PRIMARY_BASE_URL", originalEnv.IMAGEGEN_MYSELF_PRIMARY_BASE_URL);
      restoreEnv("IMAGEGEN_MYSELF_MODEL", originalEnv.IMAGEGEN_MYSELF_MODEL);
    }
  });
});

function routePostRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/workbench/projects/project/artifacts/artifact/generate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function routeContext(projectId: string, artifactId: string) {
  return { params: Promise.resolve({ projectId, artifactId }) };
}

function routeActions(capabilityId: string, actionId: string) {
  return {
    routeGenerationActions: {
      [capabilityId]: { actionId },
    },
  };
}

function artifact(input: Pick<ArtifactRecord, "id" | "nodeKey" | "kind" | "status" | "isApproved"> & { structuredContent?: Record<string, unknown> }): ArtifactRecord {
  return {
    id: input.id,
    projectId: "project-1",
    nodeKey: input.nodeKey,
    kind: input.kind,
    status: input.status,
    title: "source",
    summary: "source",
    markdownContent: "# source",
    structuredContent: input.structuredContent ?? {},
    version: 1,
    isApproved: input.isApproved,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function validPngBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mP8z8BQDwAFgwJ/luzjmgAAAABJRU5ErkJggg==";
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

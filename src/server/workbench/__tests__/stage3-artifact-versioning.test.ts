import { describe, expect, it } from "vitest";
import { GET as getArtifactRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/route";
import { POST as postRegenerateRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate/route";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 3 artifact versioning", () => {
  it("regenerates a new version without overwriting the approved old version", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3 版本项目" });
    const v1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "旧版本摘要",
      markdownContent: "# v1",
    });

    await service.approveArtifact(project.id, v1.id);
    const v2 = await service.regenerateArtifact(project.id, v1.id, {
      title: "需求规格重做版",
      summary: "新版本摘要",
      markdownContent: "# v2",
      structuredContent: { marker: "v2" },
    });
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(snapshot.artifacts.map((artifact) => artifact.version)).toEqual([1, 2]);
    expect(snapshot.artifacts.find((artifact) => artifact.id === v1.id)).toMatchObject({
      markdownContent: "# v1",
      isApproved: true,
    });
    expect(v2).toMatchObject({
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      version: 2,
      isApproved: false,
      status: "needs_review",
      markdownContent: "# v2",
    });
  });

  it("switches the approved pointer when approving a regenerated version", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3 确认切换项目" });
    const v1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "旧确认",
      markdownContent: "# old approved",
    });

    await service.approveArtifact(project.id, v1.id);
    const v2 = await service.regenerateArtifact(project.id, v1.id, {
      title: "需求规格重做版",
      summary: "新确认",
      markdownContent: "# new approved",
    });
    await service.approveArtifact(project.id, v2.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const oldArtifact = snapshot.artifacts.find((artifact) => artifact.id === v1.id);
    const newArtifact = snapshot.artifacts.find((artifact) => artifact.id === v2.id);

    expect(oldArtifact?.isApproved).toBe(false);
    expect(newArtifact?.isApproved).toBe(true);
    expect(snapshot).not.toHaveProperty("nodes");
  });

  it("rejects cross-project artifact reads and regeneration", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 3 项目 A" });
    const projectB = await service.createProject({ title: "Stage 3 项目 B" });
    const artifactA = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A 专属",
      markdownContent: "# A",
    });

    await expect(service.getArtifact(projectB.id, artifactA.id)).rejects.toThrow("Artifact not found");
    await expect(
      service.regenerateArtifact(projectB.id, artifactA.id, {
        title: "错误重做",
        summary: "不应出现",
        markdownContent: "# bad",
      }),
    ).rejects.toThrow("Artifact not found");

    const snapshotB = await service.getProjectSnapshot(projectB.id);
    expect(snapshotB.artifacts).toEqual([]);
  });

  it("returns stable route envelopes for artifact detail and regeneration", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 3 route 项目" });
    const v1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "route v1",
      markdownContent: "# route v1",
    });

    const detailResponse = await getArtifactRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: v1.id }),
    });
    const detailBody = await detailResponse.json();
    const regenerateResponse = await postRegenerateRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          title: "需求规格重做",
          summary: "route v2",
          markdownContent: "# route v2",
          structuredContent: {
            teacherNote: "保留教师修改说明",
            generationMode: "model_generated",
            providerStatus: "real",
            runtimeKind: "openai",
          },
        }),
      }),
      { params: Promise.resolve({ projectId: project.id, artifactId: v1.id }) },
    );
    const regenerateBody = await regenerateResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailBody.artifact).toMatchObject({ id: v1.id, version: 1 });
    expect(regenerateResponse.status).toBe(201);
    expect(regenerateBody.artifact).toMatchObject({
      nodeKey: "requirement_spec",
      version: 2,
      isApproved: false,
      status: "needs_review",
      summary: "route v2",
      structuredContent: { teacherNote: "保留教师修改说明" },
    });
    expect(regenerateBody.artifact.structuredContent).not.toHaveProperty("generationMode");
    expect(regenerateBody.artifact.structuredContent).not.toHaveProperty("providerStatus");
    expect(regenerateBody.artifact.structuredContent).not.toHaveProperty("runtimeKind");
  });

  it("returns route-level 404 for cross-project artifact detail and regeneration", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 3 route A" });
    const projectB = await service.createProject({ title: "Stage 3 route B" });
    const artifactA = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A route",
      markdownContent: "# A route",
    });

    const detailResponse = await getArtifactRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: projectB.id, artifactId: artifactA.id }),
    });
    const regenerateResponse = await postRegenerateRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ title: "错误重做", summary: "bad", markdownContent: "# bad" }),
      }),
      { params: Promise.resolve({ projectId: projectB.id, artifactId: artifactA.id }) },
    );

    expect(detailResponse.status).toBe(404);
    await expect(detailResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("Artifact not found") });
    expect(regenerateResponse.status).toBe(404);
    await expect(regenerateResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("Artifact not found") });
  });
});

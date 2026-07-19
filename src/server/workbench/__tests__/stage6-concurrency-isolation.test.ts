import { describe, expect, it } from "vitest";
import { POST as postRegenerateRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate/route";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 6 concurrency and isolation", () => {
  it("rejects stale regenerate requests with an expected latest version", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 6 stale regenerate 项目" });
    const v1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "v1",
      markdownContent: "# v1",
    });
    await service.regenerateArtifact(project.id, v1.id, {
      expectedLatestVersion: 1,
      title: "需求规格 v2",
      summary: "v2",
      markdownContent: "# v2",
    });

    await expect(
      service.regenerateArtifact(project.id, v1.id, {
        expectedLatestVersion: 1,
        title: "过期重做",
        summary: "stale",
        markdownContent: "# stale",
      }),
    ).rejects.toThrow("Artifact version conflict");

    const regenerateResponse = await postRegenerateRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          expectedLatestVersion: 1,
          title: "过期 route 重做",
          summary: "stale route",
          markdownContent: "# stale route",
        }),
      }),
      { params: Promise.resolve({ projectId: project.id, artifactId: v1.id }) },
    );
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(regenerateResponse.status).toBe(409);
    await expect(regenerateResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("Artifact version conflict"),
    });
    expect(snapshot.artifacts.map((artifact) => artifact.version)).toEqual([1, 2]);
  });

  it("keeps artifact version counters isolated by project", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 6 version A" });
    const projectB = await service.createProject({ title: "Stage 6 version B" });
    const artifactA = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A v1",
      markdownContent: "# A v1",
    });
    await service.regenerateArtifact(projectA.id, artifactA.id, {
      expectedLatestVersion: 1,
      title: "A 需求规格 v2",
      summary: "A v2",
      markdownContent: "# A v2",
    });
    await service.saveArtifact(projectB.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "B 需求规格",
      status: "needs_review",
      summary: "B v1",
      markdownContent: "# B v1",
    });

    const snapshotA = await service.getProjectSnapshot(projectA.id);
    const snapshotB = await service.getProjectSnapshot(projectB.id);

    expect(snapshotA.artifacts.map((artifact) => artifact.version)).toEqual([1, 2]);
    expect(snapshotB.artifacts.map((artifact) => artifact.version)).toEqual([1]);
  });
});

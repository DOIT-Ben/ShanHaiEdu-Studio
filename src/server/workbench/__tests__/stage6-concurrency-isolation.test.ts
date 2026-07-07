import { describe, expect, it } from "vitest";
import { POST as postStartRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/route";
import { POST as postFinishRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/[runId]/finish/route";
import { POST as postRegenerateRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate/route";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 6 concurrency and isolation", () => {
  it("rejects finishing the same agent run twice", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 6 重复 finish 项目" });
    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    await service.finishAgentRun(project.id, run.id, {
      status: "failed",
      errorMessage: "第一次失败",
    });

    await expect(
      service.finishAgentRun(project.id, run.id, {
        status: "succeeded",
      }),
    ).rejects.toThrow("AgentRun already finished");

    const snapshot = await service.getProjectSnapshot(project.id);
    const persistedRun = snapshot.agentRuns.find((entry) => entry.id === run.id);

    expect(persistedRun).toMatchObject({
      status: "failed",
      errorMessage: "第一次失败",
    });
  });

  it("does not let an older failed run overwrite a newer running node", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 6 迟到 run 项目" });
    const olderRun = await service.startAgentRun(project.id, {
      nodeKey: "ppt_draft",
      runtime: "deterministic",
    });
    const newerRun = await service.startAgentRun(project.id, {
      nodeKey: "ppt_draft",
      runtime: "deterministic",
    });

    await service.finishAgentRun(project.id, olderRun.id, {
      status: "failed",
      errorMessage: "旧运行迟到失败",
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "ppt_draft");
    const oldPersisted = snapshot.agentRuns.find((entry) => entry.id === olderRun.id);
    const newPersisted = snapshot.agentRuns.find((entry) => entry.id === newerRun.id);

    expect(oldPersisted?.status).toBe("failed");
    expect(newPersisted?.status).toBe("running");
    expect(node?.status).toBe("in_progress");
  });

  it("returns route-level 409 when finishing an already finished run", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 6 route finish 冲突项目" });

    const startResponse = await postStartRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ nodeKey: "lesson_plan", runtime: "deterministic" }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const startBody = await startResponse.json();

    await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "第一次失败" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: startBody.run.id }) },
    );

    const duplicateFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "第二次失败" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: startBody.run.id }) },
    );

    expect(duplicateFinishResponse.status).toBe(409);
    await expect(duplicateFinishResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("AgentRun already finished"),
    });
  });

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

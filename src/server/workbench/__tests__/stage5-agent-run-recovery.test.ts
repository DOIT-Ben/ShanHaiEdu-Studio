import { describe, expect, it } from "vitest";
import { POST as postStartRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/route";
import { POST as postFinishRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/[runId]/finish/route";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 5 AgentRun recovery", () => {
  it("starts an agent run and marks the node in progress", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 运行项目" });

    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "lesson_plan");

    expect(run).toMatchObject({
      projectId: project.id,
      nodeKey: "lesson_plan",
      status: "running",
      runtime: "deterministic",
      finishedAt: null,
    });
    expect(node?.status).toBe("in_progress");
  });

  it("records failure and keeps the old approved artifact recoverable", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 失败恢复项目" });
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "旧教案",
      markdownContent: "# old lesson",
    });
    await service.approveArtifact(project.id, lesson.id);
    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const failed = await service.finishAgentRun(project.id, run.id, {
      status: "failed",
      errorMessage: "生成未完成，请稍后重试。",
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "lesson_plan");
    const retained = snapshot.artifacts.find((artifact) => artifact.id === lesson.id);

    expect(failed).toMatchObject({
      id: run.id,
      status: "failed",
      errorMessage: "生成未完成，请稍后重试。",
    });
    expect(failed.finishedAt).not.toBeNull();
    expect(node).toMatchObject({
      status: "failed",
      approvedArtifactId: lesson.id,
    });
    expect(retained).toMatchObject({
      markdownContent: "# old lesson",
      isApproved: true,
    });
  });

  it("does not approve a node automatically when a run succeeds", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 成功运行项目" });
    const run = await service.startAgentRun(project.id, {
      nodeKey: "ppt_draft",
      runtime: "deterministic",
    });

    const succeeded = await service.finishAgentRun(project.id, run.id, {
      status: "succeeded",
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "ppt_draft");

    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.finishedAt).not.toBeNull();
    expect(node?.status).not.toBe("approved");
  });

  it("rejects finishing another project's run", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 5 项目 A" });
    const projectB = await service.createProject({ title: "Stage 5 项目 B" });
    const runA = await service.startAgentRun(projectA.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    await expect(
      service.finishAgentRun(projectB.id, runA.id, {
        status: "failed",
        errorMessage: "不应写入",
      }),
    ).rejects.toThrow("AgentRun not found");

    const snapshotB = await service.getProjectSnapshot(projectB.id);
    expect(snapshotB.agentRuns).toEqual([]);
  });

  it("returns stable route envelopes for start and failed finish", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 route 项目" });

    const startResponse = await postStartRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ nodeKey: "lesson_plan", runtime: "deterministic" }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const startBody = await startResponse.json();
    const finishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "route 失败" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: startBody.run.id }) },
    );
    const finishBody = await finishResponse.json();

    expect(startResponse.status).toBe(201);
    expect(startBody.run).toMatchObject({ status: "running", nodeKey: "lesson_plan" });
    expect(finishResponse.status).toBe(200);
    expect(finishBody.run).toMatchObject({ status: "failed", errorMessage: "route 失败" });
  });

  it("returns route-level errors for invalid node keys and cross-project run finish", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 5 route A" });
    const projectB = await service.createProject({ title: "Stage 5 route B" });
    const runA = await service.startAgentRun(projectA.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const invalidStartResponse = await postStartRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ nodeKey: "bad_node", runtime: "deterministic" }),
      }),
      { params: Promise.resolve({ projectId: projectB.id }) },
    );
    const crossProjectFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "不应写入" }),
      }),
      { params: Promise.resolve({ projectId: projectB.id, runId: runA.id }) },
    );

    expect(invalidStartResponse.status).toBe(400);
    await expect(invalidStartResponse.json()).resolves.toMatchObject({ error: "Invalid nodeKey" });
    expect(crossProjectFinishResponse.status).toBe(404);
    await expect(crossProjectFinishResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("AgentRun not found") });
  });

  it("returns route-level 400 for invalid finish status", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 5 invalid finish 项目" });
    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const invalidFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "done" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: run.id }) },
    );
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "lesson_plan");
    const persistedRun = snapshot.agentRuns.find((entry) => entry.id === run.id);

    expect(invalidFinishResponse.status).toBe(400);
    await expect(invalidFinishResponse.json()).resolves.toMatchObject({ error: "Invalid run status" });
    expect(node?.status).toBe("in_progress");
    expect(persistedRun?.status).toBe("running");
  });
});
